const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const { createConfigStore } = require("./lib/config-store.cjs");
const { dispatchOpenClawGatewayStream, probeOpenClawGateway } = require("./lib/openclaw-gateway-stream.cjs");
const { resolveGateway } = require("./lib/openclaw-gateway-ws.cjs");
const { generateConversationTitle } = require("./lib/llm-chat-title.cjs");
const {
  runGatewayBootstrapReadiness,
  invalidateGatewaySession,
  acquireGatewaySession,
  hydrateGatewayChatPrep,
  prewarmStudioGatewaySessions,
} = require("./lib/openclaw-gateway-session.cjs");
const { syncOpenClawAgentFromStudioConfig } = require("./lib/sync-openclaw-agent-from-studio.cjs");

const isDev = process.env.NODE_ENV === "development";
const requireFromApp = createRequire(__dirname);

/* Windows: Fluent/overlay scrollbars often ignore ::-webkit-scrollbar — disable so rail CSS applies. */
if (process.platform === "win32") {
  app.commandLine.appendSwitch(
    "disable-features",
    ["FluentOverlayScrollbars", "WindowsFluentScrollbar", "FluentScrollbars"].join(","),
  );
}

const CHAT_STREAM_CHAN = "studio:chatStream";
const BOOTSTRAP_PROGRESS_CHAN = "studio:bootstrapProgress";
/** Overall budget for first-run gateway hydration (`tools.effective` can match first-chat prep cost). */
const BOOTSTRAP_BUDGET_MS = 900_000;
/** Background `#studio:` session prewarm (sequential RPCs; can be long with many threads). */
const STUDIO_PREWARM_BUDGET_MS = 900_000;
/** Best-effort replay for explicit `warmGatewayChatPrep` IPC only (not chained before every `chat.send`). */
const CHAT_HYDRATE_THROTTLE_MS = 90_000;
/** Must cover worst-case `tools.catalog` + multi-minute `sessions.create` / `tools.effective` under Windows + gateway lock contention. */
const CHAT_HYDRATE_BUDGET_MS = 600_000;

const gatewayWarmState = {
  lastChatHydrateMs: 0,
  reset() {
    this.lastChatHydrateMs = 0;
  },
};

/** @param {unknown} cfg */
async function maybeHydrateGatewayForChat(cfg) {
  const url = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
  if (!url) return { skipped: "no_gateway" };
  const now = Date.now();
  if (now - gatewayWarmState.lastChatHydrateMs < CHAT_HYDRATE_THROTTLE_MS) {
    return { skipped: "throttled" };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CHAT_HYDRATE_BUDGET_MS);
  try {
    const resolved = resolveGateway(cfg);
    const client = await acquireGatewaySession(resolved, ac.signal);
    await hydrateGatewayChatPrep(client, cfg, ac.signal);
    gatewayWarmState.lastChatHydrateMs = Date.now();
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.warn("[open-studio] gateway chat hydrate:", msg);
    return { ok: false, message: msg };
  } finally {
    clearTimeout(timer);
  }
}

function studioInvalidateGatewaySession() {
  invalidateGatewaySession();
  gatewayWarmState.reset();
}

/** @type {ReturnType<typeof createConfigStore> | null} */
let userConfigStore = null;

/** @type {Map<string, AbortController>} */
const chatStreamAbortControllers = new Map();

/** Serialize `studio:bootstrapGateway` — React Strict Mode can fire the effect twice in dev. */
let bootstrapGatewayInFlight = /** @type {Promise<{ ok: boolean; message?: string; skipped?: string }> | null} */ (null);

/** Fingerprint of fields that affect on-disk OpenClaw sync; avoids rewriting every chat turn. */
let lastOpenClawSyncFingerprint = "";

/** @param {unknown} cfg */
function computeOpenClawSyncFingerprint(cfg) {
  if (!cfg || typeof cfg !== "object") return "";
  try {
    return JSON.stringify({
      openclaw: /** @type {any} */ (cfg).openclaw,
      modelProfiles: /** @type {any} */ (cfg).modelProfiles,
      activeModelProfileId: /** @type {any} */ (cfg).activeModelProfileId,
      credentials: /** @type {any} */ (cfg).credentials,
    });
  } catch {
    return "";
  }
}

/**
 * @param {"startup" | "bootstrap" | "settings" | "probe" | "chat" | "warm"} reason
 */
function runOpenClawAgentSyncFromStudio(reason) {
  if (!userConfigStore) return;
  const cfg = userConfigStore.readRaw();
  const fp = computeOpenClawSyncFingerprint(cfg);
  const skipReasons =
    reason === "chat" ||
    reason === "probe" ||
    reason === "settings" ||
    reason === "bootstrap" ||
    reason === "warm";
  if (skipReasons && fp === lastOpenClawSyncFingerprint) {
    if (isDev) console.log(`[openclaw-sync:${reason}] skipped (config unchanged)`);
    return;
  }
  try {
    const r = syncOpenClawAgentFromStudioConfig(cfg);
    if (isDev && r && !r.skipped && r.ok) {
      console.log(
        `[openclaw-sync:${reason}] agent=${r.agentId} dir=${r.stateDir} authUpdated=${r.authChanged} model=`,
        r.modelPatch,
        r.warning ?? "",
      );
    }
    if (isDev && r?.warning) console.warn("[openclaw-sync]", r.warning);
    if (isDev && r?.modelPatch?.ok === false) {
      console.warn("[openclaw-sync] model line not updated:", r.modelPatch.reason);
    }
    if (
      isDev &&
      r?.modelPatch?.changed &&
      process.env.OPENCLAW_SYNC_SILENT_MODEL_RESTART_HINT !== "1"
    ) {
      console.warn(
        "[openclaw-sync] openclaw.json model updated — restart the gateway process if it was already running so it picks up the new default model.",
      );
    }
    lastOpenClawSyncFingerprint = computeOpenClawSyncFingerprint(userConfigStore.readRaw());
  } catch (err) {
    console.warn("[openclaw-sync] failed:", err?.message ?? err);
  }
}

/**
 * @param {unknown} patch
 * @returns {boolean}
 */
function patchTouchesGatewayWorkspace(patch) {
  const p = patch && typeof patch === "object" ? patch : {};
  return (
    "openclaw" in p ||
    "modelProfiles" in p ||
    "activeModelProfileId" in p ||
    "credentials" in p
  );
}

function getOpenClawPackageMeta() {
  try {
    const pkgPath = requireFromApp.resolve("openclaw/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const root = path.dirname(pkgPath);
    const cliEntry = path.join(root, pkg.bin.openclaw.replace(/^\.\//, ""));
    return { version: pkg.version, root, cliEntry };
  } catch {
    return null;
  }
}

async function getOpenClawLibrarySurface() {
  try {
    const oc = await import("openclaw");
    const keys = Object.keys(oc).sort();
    return { exportCount: keys.length, exports: keys };
  } catch (err) {
    return { error: String(err?.message ?? err), exportCount: 0, exports: [] };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: "#eef1f6",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu?.();

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  userConfigStore = createConfigStore(app.getPath("userData"));
  runOpenClawAgentSyncFromStudio("startup");

  ipcMain.handle("openclaw:getRuntime", async () => {
    const meta = getOpenClawPackageMeta();
    const lib = await getOpenClawLibrarySurface();
    return { meta, lib, processVersions: process.versions };
  });

  ipcMain.handle("studio:getUserConfig", () => {
    return userConfigStore.getSanitized();
  });

  ipcMain.handle("studio:setUserConfig", (_event, patch) => {
    const fpBefore = computeOpenClawSyncFingerprint(userConfigStore.readRaw());
    const sanitized = userConfigStore.applyPatch(patch ?? {});
    runOpenClawAgentSyncFromStudio("settings");
    const fpAfter = computeOpenClawSyncFingerprint(userConfigStore.readRaw());
    if (patchTouchesGatewayWorkspace(patch) && fpAfter !== fpBefore) {
      studioInvalidateGatewaySession();
    }
    return sanitized;
  });

  ipcMain.handle("studio:getPaths", () => ({
    userData: app.getPath("userData"),
  }));

  ipcMain.handle("studio:probeGateway", async () => {
    try {
      runOpenClawAgentSyncFromStudio("probe");
      const cfg = userConfigStore.readRaw();
      await probeOpenClawGateway(cfg);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:warmGatewayChatPrep", async () => {
    try {
      runOpenClawAgentSyncFromStudio("warm");
      const cfg = userConfigStore.readRaw();
      return await maybeHydrateGatewayForChat(cfg);
    } catch (e) {
      return { ok: false, message: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:prewarmStudioGatewaySessions", async (_event, payload) => {
    const raw = Array.isArray(payload?.conversationIds) ? payload.conversationIds : [];
    const max = Math.min(Math.max(Number(payload?.max) || 12, 1), 24);
    /** @type {string[]} */
    const ids = [];
    const seen = new Set();
    for (const x of raw) {
      if (typeof x !== "string" || !x.trim()) continue;
      const t = x.trim();
      if (seen.has(t)) continue;
      seen.add(t);
      ids.push(t);
      if (ids.length >= max) break;
    }
    if (ids.length === 0) return { ok: true, skipped: "empty" };
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    try {
      const cfg = userConfigStore.readRaw();
      const url = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
      if (!url) return { ok: true, skipped: "no_gateway" };
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), STUDIO_PREWARM_BUDGET_MS);
      try {
        const urgentFirst = Boolean(payload?.urgentFirst);
        await prewarmStudioGatewaySessions(cfg, ids, ac.signal, { urgentFirst });
        return { ok: true, warmed: ids.length };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (isDev) console.warn("[open-studio] prewarmStudioGatewaySessions:", e?.message ?? e);
      return { ok: false, message: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:bootstrapGateway", async (event) => {
    if (bootstrapGatewayInFlight) return bootstrapGatewayInFlight;

    const wc = event.sender;
    /** @param {Record<string, unknown>} payload */
    const emit = (payload) => {
      if (!wc.isDestroyed()) wc.send(BOOTSTRAP_PROGRESS_CHAN, payload);
    };

    bootstrapGatewayInFlight = (async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), BOOTSTRAP_BUDGET_MS);
      try {
        runOpenClawAgentSyncFromStudio("bootstrap");
        emit({ phase: "config_synced" });

        const cfg = userConfigStore.readRaw();
        const url = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
        if (!url) {
          emit({ phase: "skipped_no_gateway" });
          emit({ phase: "complete", skipped: "no_gateway_url" });
          return { ok: true, skipped: "no_gateway_url" };
        }

        await runGatewayBootstrapReadiness(cfg, ac.signal, emit);
        gatewayWarmState.lastChatHydrateMs = Date.now();
        /* `hydrateGatewayChatPrep` marks the configured base sessionKey; no redundant prep on first `chat.send` without `#studio:` */
        emit({ phase: "complete" });
        return { ok: true };
      } catch (e) {
        studioInvalidateGatewaySession();
        const message = String(e?.message ?? e);
        emit({ phase: "error", message });
        return { ok: false, message };
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      bootstrapGatewayInFlight = null;
    });

    return bootstrapGatewayInFlight;
  });

  ipcMain.handle("studio:startChatStream", async (event, payload) => {
    const streamId = payload?.streamId;
    const messages = payload?.messages;
    const conversationId =
      typeof payload?.conversationId === "string" ? payload.conversationId.trim() : "";
    if (typeof streamId !== "string" || !streamId.trim() || !Array.isArray(messages)) {
      throw new Error("invalid_chat_payload");
    }
    const ac = new AbortController();
    chatStreamAbortControllers.set(streamId, ac);
      const wc = event.sender;
      const composerSkill = payload?.composerSkill;
      try {
        runOpenClawAgentSyncFromStudio("chat");
        const cfg = userConfigStore.readRaw();
        await dispatchOpenClawGatewayStream(
          cfg,
          messages,
          ac.signal,
          (evt) => {
            if (!wc.isDestroyed()) wc.send(CHAT_STREAM_CHAN, { streamId, ...evt });
          },
          conversationId ? { conversationId, composerSkill } : { composerSkill },
        );
    } catch (e) {
      if (!wc.isDestroyed()) {
        if (ac.signal.aborted || e?.name === "AbortError") {
          wc.send(CHAT_STREAM_CHAN, { streamId, type: "aborted" });
        } else {
          wc.send(CHAT_STREAM_CHAN, { streamId, type: "error", message: String(e?.message ?? e) });
        }
      }
    } finally {
      chatStreamAbortControllers.delete(streamId);
      if (!wc.isDestroyed()) {
        const sid = streamId;
        setImmediate(() => {
          if (!wc.isDestroyed()) wc.send(CHAT_STREAM_CHAN, { streamId: sid, type: "done" });
        });
      }
    }
    return { ok: true };
  });

  ipcMain.handle("studio:abortChatStream", (_event, streamId) => {
    if (typeof streamId !== "string" || !chatStreamAbortControllers.has(streamId)) return { ok: false };
    chatStreamAbortControllers.get(streamId)?.abort();
    return { ok: true };
  });

  ipcMain.handle("studio:generateChatTitle", async (_event, payload) => {
    const text = typeof payload?.userText === "string" ? payload.userText.trim() : "";
    if (!text) return { ok: false, error: "empty_user_text" };
    try {
      const cfg = userConfigStore.readRaw();
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 28_000);
      try {
        const title = await generateConversationTitle(cfg, text, ac.signal);
        return { ok: true, title };
      } finally {
        clearTimeout(tid);
      }
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, error: "aborted" };
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("shell:windowMinimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("shell:windowToggleMaximize", (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return false;
    if (w.isMaximized()) {
      w.unmaximize();
      return false;
    }
    w.maximize();
    return true;
  });

  ipcMain.handle("shell:windowClose", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("shell:isWindowMaximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
