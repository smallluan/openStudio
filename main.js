const { app, BrowserWindow, ipcMain, Menu, Tray, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { createConfigStore } = require("./lib/config-store.cjs");
const { dispatchOpenClawGatewayStream, probeOpenClawGateway } = require("./lib/openclaw-gateway-stream.cjs");
const {
  probeWechatCapability,
  startWechatQrAuth,
  getWechatAuthStatus,
  disconnectWechatAuth,
  pullWechatInbound,
  sendWechatOutbound,
} = require("./lib/openclaw-gateway-wechat.cjs");
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
const { readWorkspacePreviewFile, resolveWorkspacePreviewTarget } = require("./lib/chatlab-read-workspace-preview.cjs");
const { initStudioLogger, getStudioLog } = require("./lib/studio-logger.cjs");
const { enableBundledPythonRuntime } = require("./lib/bundled-python-runtime.cjs");
const {
  ensureLocalGatewayRunning,
  waitForGatewayWarmupIfNeeded,
  attachGatewayQuitHandlers,
  resolveBundledOpenClawPackageMetaSync,
} = require("./lib/openclaw-gateway-supervisor.cjs");
const {
  resolveBundledSkillDirectorySync,
  resolveUserSkillDirectorySync,
  getSkillEnvironmentCached,
} = require("./lib/skill-runtime.cjs");

/** Sidebar cannot embed Office; open these locally in the OS default viewer instead. */
const OPEN_EXTERNALLY_SIDE_PREVIEW_EXT = new Set([".pptx", ".ppt", ".xlsx", ".xls"]);

const isDev = process.env.NODE_ENV === "development";

/* Windows: Fluent/overlay scrollbars often ignore ::-webkit-scrollbar — disable so rail CSS applies. */
if (process.platform === "win32") {
  app.commandLine.appendSwitch(
    "disable-features",
    ["FluentOverlayScrollbars", "WindowsFluentScrollbar", "FluentScrollbars"].join(","),
  );
}

const CHAT_STREAM_CHAN = "studio:chatStream";
const BOOTSTRAP_PROGRESS_CHAN = "studio:bootstrapProgress";
const WECHAT_STATUS_CHAN = "studio:wechatStatus";
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
    getStudioLog().warn("[open-studio] gateway chat hydrate:", msg);
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
/** @type {Map<string, Promise<{ ok: boolean }>>} */
const inFlightChatSends = new Map();
/** @type {Map<string, Promise<{ ok: boolean }>>} */
const inFlightWechatSends = new Map();
/** @type {Set<string>} */
const wechatInboundSeen = new Set();
/** @type {Map<string, string>} */
const wechatPeerConversationMap = new Map();
/** Recent Studio→WeChat outbound echoes to ignore when polling getUpdates. */
/** @type {Map<string, Array<{ text: string; ts: number; messageId?: string }>>} */
const wechatRecentOutbound = new Map();
let wechatPollTimer = /** @type {ReturnType<typeof setInterval> | null} */ (null);

/**
 * @param {string} peerId
 * @param {string} text
 * @param {string} [messageId]
 */
function trackWechatOutboundEcho(peerId, text, messageId) {
  const pid = String(peerId ?? "").trim();
  const body = String(text ?? "").trim();
  if (!pid || !body) return;
  const list = wechatRecentOutbound.get(pid) ?? [];
  list.push({ text: body, ts: Date.now(), messageId: messageId ? String(messageId).trim() : undefined });
  wechatRecentOutbound.set(pid, list.slice(-24));
}

/**
 * @param {string} peerId
 * @param {string} text
 * @param {string} messageId
 */
function isWechatOutboundEcho(peerId, text, messageId) {
  const list = wechatRecentOutbound.get(peerId);
  if (!list?.length) return false;
  const now = Date.now();
  const body = String(text ?? "").trim();
  const mid = String(messageId ?? "").trim();
  for (const row of list) {
    if (now - row.ts > 120_000) continue;
    if (mid && row.messageId && mid === row.messageId) return true;
    if (row.text === body) return true;
  }
  return false;
}

function pruneBoundedSet(set, max = 3000) {
  while (set.size > max) {
    const [first] = set;
    if (!first) break;
    set.delete(first);
  }
}

function toWechatConversationId(peerId) {
  const safe = String(peerId ?? "").trim().replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 96);
  return safe ? `wechat:${safe}` : `wechat:unknown`;
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} payload
 */
function emitWechatStatus(wc, payload) {
  if (!wc || wc.isDestroyed()) return;
  wc.send(WECHAT_STATUS_CHAN, payload);
}

/**
 * @param {unknown} cfg
 */
function isWechatChannelEnabled(cfg) {
  void cfg;
  return true;
}

/**
 * @param {unknown} cfg
 * @param {AbortSignal} signal
 */
async function acquireWechatGatewaySession(cfg, signal) {
  const resolved = resolveGateway(cfg);
  return acquireGatewaySession(resolved, signal);
}

/**
 * @param {import("electron").WebContents} wc
 * @param {unknown | (() => unknown)} getCfg
 */
function ensureWechatPoller(wc, getCfg) {
  const readCfg = () => (typeof getCfg === "function" ? getCfg() : getCfg);
  if (!isWechatChannelEnabled(readCfg())) return;
  if (wechatPollTimer) return;
  wechatPollTimer = setInterval(async () => {
    if (!wc || wc.isDestroyed()) return;
    const cfg = readCfg();
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 12_000);
      try {
        const client = await acquireWechatGatewaySession(cfg, ac.signal);
        const status = await getWechatAuthStatus(client, cfg);
        emitWechatStatus(wc, {
          type: "auth_status",
          source: "poll",
          ...status,
        });
        if (!status.connected) return;
        const pull = await pullWechatInbound(client, { limit: 8 }, cfg);
        const rows = Array.isArray(pull.messages) ? pull.messages : [];
        for (const msg of rows) {
          const messageId = String(msg?.messageId ?? "").trim();
          const peerId = String(msg?.peerId ?? "").trim();
          const text = String(msg?.text ?? "").trim();
          if (!messageId || !peerId || !text) continue;
          if (wechatInboundSeen.has(messageId)) continue;
          if (isWechatOutboundEcho(peerId, text, messageId)) {
            wechatInboundSeen.add(messageId);
            pruneBoundedSet(wechatInboundSeen);
            continue;
          }
          wechatInboundSeen.add(messageId);
          pruneBoundedSet(wechatInboundSeen);
          const conversationId = wechatPeerConversationMap.get(peerId) || toWechatConversationId(peerId);
          wechatPeerConversationMap.set(peerId, conversationId);
          emitWechatStatus(wc, {
            type: "inbound",
            channel: "wechat",
            conversationId,
            peerId,
            messageId,
            text,
            ts: typeof msg.ts === "number" ? msg.ts : Date.now(),
          });
        }
      } finally {
        clearTimeout(tid);
      }
    } catch (err) {
      const msg = String(err?.message ?? err);
      getStudioLog().warn("[wechat] poll failed:", msg);
      emitWechatStatus(wc, { type: "poll_error", message: msg });
    }
  }, 3_500);
}

function stopWechatPoller() {
  if (!wechatPollTimer) return;
  clearInterval(wechatPollTimer);
  wechatPollTimer = null;
}

/** Serialize `studio:bootstrapGateway` — React Strict Mode can fire the effect twice in dev. */
let bootstrapGatewayInFlight = /** @type {Promise<{ ok: boolean; message?: string; skipped?: string }> | null} */ (null);

/** Fingerprint of fields that affect on-disk OpenClaw sync; avoids rewriting every chat turn. */
let lastOpenClawSyncFingerprint = "";
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let appTray = null;
let isQuitting = false;

/** @param {unknown} cfg */
function computeOpenClawSyncFingerprint(cfg) {
  if (!cfg || typeof cfg !== "object") return "";
  try {
    return JSON.stringify({
      openclaw: /** @type {any} */ (cfg).openclaw,
      modelProfiles: /** @type {any} */ (cfg).modelProfiles,
      enabledModelProfileIds: /** @type {any} */ (cfg).enabledModelProfileIds,
      activeModelProfileId: /** @type {any} */ (cfg).activeModelProfileId,
      credentials: /** @type {any} */ (cfg).credentials,
    });
  } catch {
    return "";
  }
}

/**
 * @param {"startup" | "bootstrap" | "settings" | "probe" | "chat" | "warm" | "wechat"} reason
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
    reason === "warm" ||
    reason === "wechat";
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
    "enabledModelProfileIds" in p ||
    "activeModelProfileId" in p ||
    "credentials" in p
  );
}

function getOpenClawPackageMeta() {
  try {
    return resolveBundledOpenClawPackageMetaSync();
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

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

  win.on("close", (event) => {
    // Keep background runtime alive on Windows; expose explicit Quit in tray menu.
    if (process.platform === "win32" && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on("did-finish-load", () => {
    try {
      if (userConfigStore) ensureWechatPoller(win.webContents, () => userConfigStore.readRaw());
    } catch {
      /* ignore */
    }
  });

  mainWindow = win;
  return win;
}

function getTrayIconPath() {
  if (process.platform === "win32" && !isDev) return process.execPath;
  return path.join(__dirname, "src", "assets", "images", "hero-avatar-light.png");
}

function createTray() {
  if (process.platform !== "win32") return;
  if (appTray && !appTray.isDestroyed?.()) return;

  try {
    appTray = new Tray(getTrayIconPath());
  } catch (e) {
    getStudioLog().warn("[tray] failed to create tray icon:", /** @type {any} */ (e)?.message ?? e);
    return;
  }

  appTray.setToolTip("Open Studio");
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Studio",
        click: () => {
          createWindow();
        },
      },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  appTray.on("click", () => {
    createWindow();
  });
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    createWindow();
  });

  initStudioLogger(app, { isDev });
  try {
    const py = enableBundledPythonRuntime({ app, log: getStudioLog() });
    if (!py.ok) {
      getStudioLog().warn("[startup] bundled python init failed", py);
    }
  } catch (e) {
    getStudioLog().warn("[startup] bundled python init threw", String(e?.message ?? e));
  }
  attachGatewayQuitHandlers(app);

  Menu.setApplicationMenu(null);

  userConfigStore = createConfigStore(app.getPath("userData"));
  runOpenClawAgentSyncFromStudio("startup");
  getSkillEnvironmentCached().catch((e) => {
    getStudioLog().warn("[skills] env probe failed:", /** @type {any} */ (e)?.message ?? e);
  });

  if (!isDev) {
    try {
      getStudioLog().info("[startup] supervised gateway begin");
      const sup = await ensureLocalGatewayRunning(() => userConfigStore.readRaw(), {
        log: getStudioLog(),
        probeOpenClawGateway,
      });
      getStudioLog().info("[startup] supervised gateway:", sup);
    } catch (e) {
      getStudioLog().error("[startup] supervised gateway threw:", /** @type {any} */ (e)?.message ?? e);
    }
  }

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
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, "openclaw")) {
      const wechatEnabledPatch = patch?.openclaw && Object.prototype.hasOwnProperty.call(patch.openclaw, "wechatEnabled");
      if (wechatEnabledPatch) {
        const enabled = Boolean(patch.openclaw.wechatEnabled);
        if (!enabled) stopWechatPoller();
      }
    }
    return sanitized;
  });

  ipcMain.handle("studio:getPaths", () => ({
    userData: app.getPath("userData"),
    logs: app.getPath("logs"),
  }));

  ipcMain.handle("studio:openLogsDirectory", async () => {
    const logsDir = app.getPath("logs");
    const errMsg = await shell.openPath(logsDir);
    if (String(errMsg ?? "").trim()) {
      getStudioLog().warn("[logs] shell.openPath failed:", errMsg);
      return { ok: false, path: logsDir, message: String(errMsg) };
    }
    return { ok: true, path: logsDir };
  });

  ipcMain.handle("studio:getSkillEnvironment", async () => {
    return getSkillEnvironmentCached();
  });

  ipcMain.handle("studio:openSkillDirectory", async (_event, payload) => {
    const kind = payload?.kind === "user" ? "user" : "bundled";
    let dir = "";
    if (kind === "user") {
      dir = resolveUserSkillDirectorySync(payload?.localPath);
    } else {
      dir = resolveBundledSkillDirectorySync(payload?.skillId);
    }
    if (!dir) {
      return { ok: false, message: "path_not_found" };
    }
    const errMsg = await shell.openPath(dir);
    if (String(errMsg ?? "").trim()) {
      getStudioLog().warn("[skills] shell.openPath failed:", errMsg, dir);
      return { ok: false, path: dir, message: String(errMsg) };
    }
    return { ok: true, path: dir };
  });

  ipcMain.handle("studio:logRendererMessage", (_e, payload) => {
    const levelRaw = typeof payload?.level === "string" ? payload.level.toLowerCase() : "info";
    const message =
      typeof payload?.message === "string" ? payload.message : String(payload?.message ?? payload ?? "");
    const log = getStudioLog();
    if (levelRaw === "error") log.error("[renderer]", message);
    else if (levelRaw === "warn") log.warn("[renderer]", message);
    else if (levelRaw === "verbose" || levelRaw === "debug") log.verbose?.("[renderer]", message);
    else log.info("[renderer]", message);
    return { ok: true };
  });

  ipcMain.handle("studio:readWorkspacePreviewFile", (_event, rawPath) => {
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    return readWorkspacePreviewFile(cfg, rawPath);
  });

  /**
   * @returns {{ ok: boolean; opened: boolean; message?: string }}
   */
  ipcMain.handle("studio:maybeOpenWorkspaceOfficeFileExternally", async (_event, rawPath) => {
    if (!userConfigStore) return { ok: false, opened: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    const r = resolveWorkspacePreviewTarget(cfg, rawPath);
    if (!r.ok) return { ok: false, opened: false, message: r.message ?? "resolve_failed" };
    const ext = String(r.ext ?? "").toLowerCase();
    if (!OPEN_EXTERNALLY_SIDE_PREVIEW_EXT.has(ext)) return { ok: true, opened: false };
    const openErr = await shell.openPath(r.filePath);
    if (String(openErr ?? "").trim()) return { ok: false, opened: false, message: openErr };
    return { ok: true, opened: true, filePath: r.filePath };
  });

  ipcMain.handle("studio:probeGateway", async () => {
    try {
      runOpenClawAgentSyncFromStudio("wechat");
      const cfg = userConfigStore.readRaw();
      await probeOpenClawGateway(cfg);
      getStudioLog().info("[gateway] probe ok");
      return { ok: true };
    } catch (e) {
      const msg = String(e?.message ?? e);
      getStudioLog().warn("[gateway] probe failed:", msg);
      return { ok: false, message: msg };
    }
  });

  ipcMain.handle("studio:wechatCapability", async (event) => {
    try {
      runOpenClawAgentSyncFromStudio("wechat");
      const cfg = userConfigStore.readRaw();
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 12_000);
      try {
        const client = await acquireWechatGatewaySession(cfg, ac.signal);
        const cap = await probeWechatCapability(client);
        ensureWechatPoller(event.sender, () => userConfigStore.readRaw());
        return { ok: true, enabled: true, ...cap };
      } finally {
        clearTimeout(tid);
      }
    } catch (err) {
      return { ok: false, message: String(err?.message ?? err) };
    }
  });

  ipcMain.handle("studio:wechatAuthStart", async (event) => {
    try {
      runOpenClawAgentSyncFromStudio("wechat");
      const cfg = userConfigStore.readRaw();
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 20_000);
      try {
        const client = await acquireWechatGatewaySession(cfg, ac.signal);
        const status = await startWechatQrAuth(client, cfg);
        ensureWechatPoller(event.sender, () => userConfigStore.readRaw());
        emitWechatStatus(event.sender, { type: "auth_started", ...status });
        return status;
      } finally {
        clearTimeout(tid);
      }
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg === "wechat_plugin_not_loaded") {
        return { ok: false, message: "wechat_plugin_not_loaded: gateway未加载微信插件，请在OpenClaw插件配置中启用wechat后重启。" };
      }
      return { ok: false, message: msg };
    }
  });

  ipcMain.handle("studio:wechatAuthStatus", async (event) => {
    try {
      runOpenClawAgentSyncFromStudio("wechat");
      const cfg = userConfigStore.readRaw();
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 12_000);
      try {
        const client = await acquireWechatGatewaySession(cfg, ac.signal);
        const status = await getWechatAuthStatus(client, cfg);
        ensureWechatPoller(event.sender, () => userConfigStore.readRaw());
        emitWechatStatus(event.sender, { type: "auth_status", source: "manual", ...status });
        return {
          ok: true,
          enabled: true,
          ...status,
          qrText: String(status.qrText ?? status.raw?.qrText ?? status.raw?.qr ?? status.raw?.qrcode ?? ""),
          qrImageDataUrl: String(
            status.qrImageDataUrl ?? status.raw?.qrImageDataUrl ?? status.raw?.qrDataUrl ?? "",
          ),
        };
      } finally {
        clearTimeout(tid);
      }
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg === "wechat_plugin_not_loaded") {
        return { ok: false, message: "wechat_plugin_not_loaded: gateway未加载微信插件，请在OpenClaw插件配置中启用wechat后重启。" };
      }
      return { ok: false, message: msg };
    }
  });

  ipcMain.handle("studio:wechatAuthDisconnect", async (event) => {
    try {
      runOpenClawAgentSyncFromStudio("probe");
      const cfg = userConfigStore.readRaw();
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 12_000);
      try {
        const client = await acquireWechatGatewaySession(cfg, ac.signal);
        const res = await disconnectWechatAuth(client, cfg);
        emitWechatStatus(event.sender, { type: "auth_disconnected", ...res });
        return { ok: true, ...res };
      } finally {
        clearTimeout(tid);
      }
    } catch (err) {
      return { ok: false, message: String(err?.message ?? err) };
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
      getStudioLog().warn("[open-studio] prewarmStudioGatewaySessions:", /** @type {any} */ (e)?.message ?? e);
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
        emit({ phase: "complete" });
        return { ok: true };
      } catch (e) {
        studioInvalidateGatewaySession();
        const message = String(e?.message ?? e);
        getStudioLog().error("[bootstrap] failed:", message);
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
    const channel = payload?.channel === "wechat" ? "wechat" : "internal";
    const wechatPeerId = typeof payload?.wechatPeerId === "string" ? payload.wechatPeerId.trim() : "";
    if (typeof streamId !== "string" || !streamId.trim() || !Array.isArray(messages)) {
      throw new Error("invalid_chat_payload");
    }

    const pending = inFlightChatSends.get(streamId);
    if (pending) {
      getStudioLog().info("[chat.send.perf] host.dedupe.wait", { streamId });
      return pending;
    }

    const run = (async () => {
      const startedAt = Date.now();
      const ac = new AbortController();
      chatStreamAbortControllers.set(streamId, ac);
      const wc = event.sender;
      const composerSkill = payload?.composerSkill;
      try {
        getStudioLog().info("[chat.send.perf] host.start", { streamId, conversationId });
        runOpenClawAgentSyncFromStudio("chat");
        const cfg = userConfigStore.readRaw();
        await waitForGatewayWarmupIfNeeded(() => userConfigStore.readRaw(), { probeOpenClawGateway });
        await dispatchOpenClawGatewayStream(
          cfg,
          messages,
          ac.signal,
          (evt) => {
            if (!wc.isDestroyed()) wc.send(CHAT_STREAM_CHAN, { streamId, ...evt });
          },
          conversationId
            ? { conversationId, composerSkill, channel, wechatPeerId }
            : { composerSkill, channel, wechatPeerId },
        );
        if (channel === "wechat" && wechatPeerId && conversationId) {
          wechatPeerConversationMap.set(wechatPeerId, conversationId);
        }
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
        getStudioLog().info("[chat.send.perf] host.done", {
          streamId,
          elapsedMs: Date.now() - startedAt,
        });
      }
      return { ok: true };
    })();

    inFlightChatSends.set(streamId, run);
    try {
      return await run;
    } finally {
      inFlightChatSends.delete(streamId);
    }
  });

  ipcMain.handle("studio:abortChatStream", (_event, streamId) => {
    if (typeof streamId !== "string" || !chatStreamAbortControllers.has(streamId)) return { ok: false };
    chatStreamAbortControllers.get(streamId)?.abort();
    return { ok: true };
  });

  ipcMain.handle("studio:wechatSendMessage", async (event, payload) => {
    try {
      runOpenClawAgentSyncFromStudio("chat");
      const cfg = userConfigStore.readRaw();
      const peerId = String(payload?.peerId ?? "").trim();
      const text = String(payload?.text ?? "").trim();
      const conversationId = String(payload?.conversationId ?? "").trim();
      const localMessageId = String(payload?.localMessageId ?? "").trim();
      const requestId = String(payload?.requestId ?? `${conversationId}:${peerId}:${text.slice(0, 16)}`).trim();
      if (!peerId || !text) return { ok: false, message: "wechat_invalid_outbound" };
      const inFlight = inFlightWechatSends.get(requestId);
      if (inFlight) return inFlight;
      const run = (async () => {
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(), 20_000);
        try {
          const client = await acquireWechatGatewaySession(cfg, ac.signal);
          const sent = await sendWechatOutbound(
            client,
            {
              peerId,
              text,
              conversationId,
              idempotencyKey: requestId,
            },
            cfg,
          );
          emitWechatStatus(event.sender, {
            type: "outbound_sent",
            channel: "wechat",
            conversationId,
            peerId,
            messageId: sent.messageId,
            localMessageId: localMessageId || undefined,
          });
          trackWechatOutboundEcho(peerId, text, sent.messageId);
          if (sent.messageId) {
            wechatInboundSeen.add(String(sent.messageId));
            pruneBoundedSet(wechatInboundSeen);
          }
          return { ok: true, ...sent };
        } finally {
          clearTimeout(tid);
        }
      })().finally(() => {
        inFlightWechatSends.delete(requestId);
      });
      inFlightWechatSends.set(requestId, run);
      return await run;
    } catch (err) {
      return { ok: false, message: String(err?.message ?? err) };
    }
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
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    app.quit();
  }
});
