const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("url");
const { createConfigStore } = require("./lib/config-store.cjs");
const {
  dispatchOpenClawGatewayStream,
  probeOpenClawGateway,
  measureOutboundMessageParts,
} = require("./lib/openclaw-gateway-stream.cjs");
const {
  probeWechatCapability,
  startWechatQrAuth,
  getWechatAuthStatus,
  disconnectWechatAuth,
  pullWechatInbound,
  sendWechatOutbound,
  sendWechatMedia,
  sendWechatTyping,
} = require("./lib/openclaw-gateway-wechat.cjs");
const { resolveGateway } = require("./lib/openclaw-gateway-ws.cjs");
const { generateConversationTitle } = require("./lib/llm-chat-title.cjs");
const { createTokenUsageStore } = require("./lib/token-usage-store.cjs");
const { createChatSessionsStore } = require("./lib/chat-sessions-store.cjs");
const {
  runGatewayBootstrapReadiness,
  invalidateGatewaySession,
  acquireGatewaySession,
  hydrateGatewayChatPrep,
  prewarmStudioGatewaySessions,
  prewarmGatewaySessionKeys,
} = require("./lib/openclaw-gateway-session.cjs");
const {
  syncOpenClawAgentFromStudioConfig,
  parseAgentIdFromSessionKey,
} = require("./lib/sync-openclaw-agent-from-studio.cjs");
const {
  provisionOpenClawAgent,
  removeOpenClawAgent,
  readAgentSoulMd,
  readAgentIdentityMd,
  readAgentBootstrapForChat,
  defaultGatewayAgentIdFromConfig,
} = require("./lib/openclaw-agent-crud.cjs");
const {
  isWechatNewChatCommand,
  toWechatConversationId,
  newWechatChannelSessionId,
  WECHAT_NEW_CHAT_ACK_TEXT,
} = require("./lib/wechat-session-commands.cjs");
const { readWorkspacePreviewFile, resolveWorkspacePreviewTarget, listWorkspacePreviewDirectory } = require("./lib/chatlab-read-workspace-preview.cjs");
const {
  getWorkspaceContext,
  searchWorkspaceFiles,
  checkoutGitBranch,
  resolveWorkspaceRoot,
  describeWorkspaceProject,
} = require("./lib/chatlab-workspace-context.cjs");
const { initStudioLogger, getStudioLog } = require("./lib/studio-logger.cjs");
const { enableBundledPythonRuntime } = require("./lib/bundled-python-runtime.cjs");
const {
  ensureLocalGatewayRunning,
  waitForGatewayWarmupIfNeeded,
  attachGatewayQuitHandlers,
  restartOwnedGateway,
  resolveBundledOpenClawPackageMetaSync,
} = require("./lib/openclaw-gateway-supervisor.cjs");
const { repairWindowsOpenClawUnpackedLayout, repairWindowsBundledExtensionsFromMirror } = require("./lib/win-bundled-resources.cjs");
const {
  registerRendererSchemePrivileges,
  registerRendererProtocol,
  getProductionRendererUrl,
} = require("./lib/renderer-protocol.cjs");
const { OrchestrationService } = require("./lib/orchestration-service.cjs");
const {
  resolveBundledSkillDirectorySync,
  resolveUserSkillDirectorySync,
  getSkillEnvironmentCached,
} = require("./lib/skill-runtime.cjs");

/** Sidebar cannot embed Office; open these locally in the OS default viewer instead. */
const OPEN_EXTERNALLY_SIDE_PREVIEW_EXT = new Set([".pptx", ".ppt", ".xlsx", ".xls"]);

const isDev = process.env.NODE_ENV === "development";

registerRendererSchemePrivileges();

/* Windows: Fluent/overlay scrollbars often ignore ::-webkit-scrollbar — disable so rail CSS applies. */
if (process.platform === "win32") {
  app.commandLine.appendSwitch(
    "disable-features",
    ["FluentOverlayScrollbars", "WindowsFluentScrollbar", "FluentScrollbars"].join(","),
  );
  // CSSBackdropFilter + UseSkiaRenderer = 稳定高斯模糊所需的组合
  // CanvasOopRasterization 确保合成层正确光栅化
  app.commandLine.appendSwitch(
    "enable-features",
    "CSSBackdropFilter,UseSkiaRenderer,CanvasOopRasterization",
  );
  if (!isDev) {
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
    app.commandLine.appendSwitch("enable-accelerated-2d-canvas");
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    // 注意: enable-zero-copy 在 Windows 上与 Intel/AMD GPU 驱动存在兼容性问题,
    // 会导致 backdrop-filter / 高斯模糊渲染失效, 因此移除此 flag。
  }
}

const CHAT_STREAM_CHAN = "studio:chatStream";
const BOOTSTRAP_PROGRESS_CHAN = "studio:bootstrapProgress";
const WECHAT_STATUS_CHAN = "studio:wechatStatus";
const PREVIEW_URL_CHAN = "studio:openPreviewUrl";
/** Overall budget for first-run gateway hydration (`tools.effective` can match first-chat prep cost). */
const BOOTSTRAP_BUDGET_MS = 900_000;
/** Background `#studio:` session prewarm (sequential RPCs; can be long with many threads). */
const STUDIO_PREWARM_BUDGET_MS = 900_000;
/** Best-effort replay for explicit `warmGatewayChatPrep` IPC only (not chained before every `chat.send`). */
const CHAT_HYDRATE_THROTTLE_MS = 90_000;
/** Must cover worst-case `tools.catalog` + multi-minute `sessions.create` / `tools.effective` under Windows + gateway lock contention. */
const CHAT_HYDRATE_BUDGET_MS = 600_000;
/** Cap simultaneous `chat.send` streams (group @everyone + orchestration DAG). */
const MAX_CONCURRENT_CHAT_STREAMS = Math.max(
  1,
  Math.min(8, Number(process.env.OPEN_STUDIO_CHAT_STREAM_CONCURRENCY) || 4),
);

let activeChatStreamSlots = 0;
/** @type {Array<() => void>} */
const chatStreamSlotWaiters = [];

function acquireChatStreamSlot(streamId) {
  if (activeChatStreamSlots < MAX_CONCURRENT_CHAT_STREAMS) {
    activeChatStreamSlots += 1;
    return Promise.resolve();
  }
  getStudioLog().info("[chat.send.perf] host.slot.wait", {
    streamId,
    active: activeChatStreamSlots,
    max: MAX_CONCURRENT_CHAT_STREAMS,
  });
  return new Promise((resolve) => {
    chatStreamSlotWaiters.push(() => {
      activeChatStreamSlots += 1;
      resolve();
    });
  });
}

function releaseChatStreamSlot() {
  activeChatStreamSlots = Math.max(0, activeChatStreamSlots - 1);
  const next = chatStreamSlotWaiters.shift();
  if (next) next();
}

function attachProcessDiagnostics() {
  const log = getStudioLog();

  process.on("uncaughtException", (err) => {
    log.error("[process] uncaughtException", {
      message: /** @type {any} */ (err)?.message ?? String(err),
      stack: /** @type {any} */ (err)?.stack,
    });
  });

  process.on("unhandledRejection", (reason) => {
    log.error("[process] unhandledRejection", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    log.error("[electron] render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents?.getURL?.() ?? "",
    });
  });

  app.on("child-process-gone", (_event, details) => {
    log.error("[electron] child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
  });
}

/**
 * @param {import("electron").WebContents} webContents
 */
function attachWebContentsDiagnostics(webContents) {
  const log = getStudioLog();
  webContents.on("render-process-gone", (_event, details) => {
    log.error("[electron] webContents.render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents.getURL(),
    });
  });
  webContents.on("unresponsive", () => {
    log.warn("[electron] webContents.unresponsive", { url: webContents.getURL() });
  });
  webContents.on("responsive", () => {
    log.info("[electron] webContents.responsive", { url: webContents.getURL() });
  });
  webContents.on("did-fail-load", (_event, code, desc, url) => {
    log.error("[electron] webContents.did-fail-load", { code, desc, url });
  });
}

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

/** @param {import("./lib/config-store.cjs").UserConfig} cfg */
function resolveActiveModelMeta(cfg) {
  const profiles = Array.isArray(cfg?.modelProfiles) ? cfg.modelProfiles : [];
  const activeId =
    (typeof cfg?.activeModelProfileId === "string" && cfg.activeModelProfileId.trim()) ||
    (Array.isArray(cfg?.enabledModelProfileIds) && cfg.enabledModelProfileIds[0]) ||
    profiles[0]?.id ||
    "";
  const profile = profiles.find((p) => p && p.id === activeId) ?? profiles[0];
  if (!profile) return null;
  return {
    modelProfileId: profile.id,
    modelLabel: profile.label || profile.modelId || profile.id,
    provider: profile.provider,
    modelId: profile.modelId,
  };
}

/** @param {unknown} payload @param {ReturnType<typeof resolveActiveModelMeta>} modelMeta */
function buildStreamUsageContext(payload, modelMeta) {
  const meta = payload?.usageMeta && typeof payload.usageMeta === "object" ? payload.usageMeta : {};
  return {
    conversationId: typeof payload?.conversationId === "string" ? payload.conversationId.trim() : "",
    conversationTitle:
      typeof meta.conversationTitle === "string" ? meta.conversationTitle.trim().slice(0, 160) : "",
    assistantMessageId:
      typeof meta.assistantMessageId === "string" ? meta.assistantMessageId.trim() : "",
    userMessageId: typeof meta.userMessageId === "string" ? meta.userMessageId.trim() : "",
    userContentPreview:
      typeof meta.userContentPreview === "string" ? meta.userContentPreview.trim().slice(0, 240) : "",
    agentId: typeof meta.agentId === "string" ? meta.agentId.trim() : "",
    gatewayAgentId: typeof payload?.gatewayAgentId === "string" ? payload.gatewayAgentId.trim() : "",
    channel: payload?.channel === "wechat" ? "wechat" : "internal",
    source: "gateway",
    ...(modelMeta ?? {}),
  };
}

/** @type {ReturnType<typeof createConfigStore> | null} */
let userConfigStore = null;
/** @type {ReturnType<typeof createTokenUsageStore> | null} */
let tokenUsageStore = null;
/** @type {ReturnType<typeof createChatSessionsStore> | null} */
let chatSessionsStore = null;

/** @type {Map<string, AbortController>} */
const chatStreamAbortControllers = new Map();
/** @type {Map<string, Promise<{ ok: boolean }>>} */
const inFlightChatSends = new Map();
/** UI conversation id → active stream id (abort stale WeChat / edit resends). */
/** @type {Map<string, string>} */
const chatStreamByConversationId = new Map();
/** UI conversation id → concurrent multi-agent stream ids. */
/** @type {Map<string, Set<string>>} */
const chatStreamsByConversationId = new Map();
/** @type {Map<string, Promise<{ ok: boolean }>>} */
const inFlightWechatSends = new Map();
/** @type {Set<string>} */
const wechatInboundSeen = new Set();
/** @type {Map<string, string>} */
const wechatPeerConversationMap = new Map();
/** Peers waiting for the next inbound to open a fresh `wechat:thread:*` row. */
/** @type {Set<string>} */
const wechatPeerPendingNewChat = new Set();
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
          if (isWechatNewChatCommand(text)) {
            wechatPeerPendingNewChat.add(peerId);
            try {
              const sent = await sendWechatOutbound(
                client,
                {
                  peerId,
                  text: WECHAT_NEW_CHAT_ACK_TEXT,
                  idempotencyKey: `new-chat-ack:${messageId}`,
                },
                cfg,
              );
              trackWechatOutboundEcho(peerId, WECHAT_NEW_CHAT_ACK_TEXT, sent.messageId);
              if (sent.messageId) {
                wechatInboundSeen.add(String(sent.messageId));
                pruneBoundedSet(wechatInboundSeen);
              }
            } catch (err) {
              getStudioLog().warn("[wechat] new_chat ack failed:", String(err?.message ?? err));
            }
            continue;
          }
          const startedNewThread = wechatPeerPendingNewChat.delete(peerId);
          const conversationId = startedNewThread
            ? newWechatChannelSessionId()
            : wechatPeerConversationMap.get(peerId) || toWechatConversationId(peerId);
          wechatPeerConversationMap.set(peerId, conversationId);
          emitWechatStatus(wc, {
            type: "inbound",
            channel: "wechat",
            conversationId,
            peerId,
            messageId,
            text,
            ts: typeof msg.ts === "number" ? msg.ts : Date.now(),
            ...(startedNewThread ? { startedNewThread: true } : {}),
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
      chatLabLinkOpenMode: /** @type {any} */ (cfg).chatLabLinkOpenMode,
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
    if (isDev && r?.browserHeadlessPatched) {
      console.warn(
        "[openclaw-sync] openclaw.json browser settings updated for link open mode — restart the OpenClaw gateway so the browser plugin allowlist takes effect.",
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

  const appIconPath = resolveAppIconPath();

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: "#eef1f6",
    show: true,
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const target = String(url ?? "").trim();
    if (/^https?:\/\//i.test(target) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(PREVIEW_URL_CHAN, { url: target });
    }
    return { action: "deny" };
  });

  win.removeMenu?.();

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadURL(getProductionRendererUrl());
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

  attachWebContentsDiagnostics(win.webContents);

  win.webContents.on("did-attach-webview", (_event, guestContents) => {
    attachWebContentsDiagnostics(guestContents);
    guestContents.setWindowOpenHandler(({ url }) => {
      const target = String(url ?? "").trim();
      if (/^https?:\/\//i.test(target) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(PREVIEW_URL_CHAN, { url: target });
      }
      return { action: "deny" };
    });
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

function resolveAppIconPath() {
  /** @type {string[]} */
  const candidates = [
    path.join(process.resourcesPath, "app-icon.png"),
    path.join(__dirname, "build", "app-icon.ico"),
    path.join(__dirname, "build", "app-icon.png"),
    path.join(__dirname, "src", "assets", "images", "hero-avatar-light.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function loadTrayIcon() {
  const iconPath = resolveAppIconPath();
  if (!iconPath || !fs.existsSync(iconPath)) return null;

  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return null;

  // Windows notification area expects a small bitmap; .exe icons do not work reliably.
  if (process.platform === "win32") {
    image = image.resize({ width: 16, height: 16 });
  }
  return image;
}

function createTray() {
  if (process.platform !== "win32") return;
  if (appTray && !appTray.isDestroyed?.()) return;

  const trayIcon = loadTrayIcon();
  if (!trayIcon) {
    getStudioLog().warn("[tray] tray icon missing or unreadable:", resolveAppIconPath() || "(none)");
    return;
  }

  try {
    appTray = new Tray(trayIcon);
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
  // In dev mode, skip single-instance lock so `pnpm dev` can run alongside a packaged .exe.
  // Also give dev its own userData directory (suffixed `-dev`) to avoid SQLite/config file locks
  // with the production app.
  if (!isDev) {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on("second-instance", () => {
      createWindow();
    });
  } else {
    // Dev: isolate userData so dev + packaged .exe can coexist without file-lock contention.
    const devUserData = app.getPath("userData") + "-dev";
    try {
      if (!fs.existsSync(devUserData)) fs.mkdirSync(devUserData, { recursive: true });
      app.setPath("userData", devUserData);
    } catch (e) {
      console.warn("[dev] failed to set dev userData:", e?.message ?? e);
    }
  }

  initStudioLogger(app, { isDev });
  attachProcessDiagnostics();

  if (!isDev) {
    try {
      registerRendererProtocol(__dirname);
      getStudioLog().info("[startup] renderer protocol registered", { url: getProductionRendererUrl() });
    } catch (e) {
      getStudioLog().error("[startup] renderer protocol failed:", /** @type {any} */ (e)?.message ?? e);
    }
  }

  if (process.platform === "win32") {
    // Use a distinct AppUserModelId for dev so it doesn't collide with the packaged .exe
    // in the Windows taskbar / notification area / single-instance semantics.
    app.setAppUserModelId(isDev ? "dev.openstudio.app.dev" : "dev.openstudio.app");
  }
  attachGatewayQuitHandlers(app);

  Menu.setApplicationMenu(null);

  userConfigStore = createConfigStore(app.getPath("userData"));
  tokenUsageStore = createTokenUsageStore(app.getPath("userData"));
  chatSessionsStore = createChatSessionsStore(app.getPath("userData"));
  createWindow();
  createTray();

  // Keep first paint fast: heavyweight startup sync runs in background.
  setTimeout(() => {
    try {
      runOpenClawAgentSyncFromStudio("startup");
    } catch (e) {
      getStudioLog().warn("[startup] openclaw sync threw", String(e?.message ?? e));
    }
  }, 0);
  setTimeout(() => {
    try {
      const py = enableBundledPythonRuntime({ app, log: getStudioLog() });
      if (!py.ok) {
        getStudioLog().warn("[startup] bundled python init failed", py);
      }
    } catch (e) {
      getStudioLog().warn("[startup] bundled python init threw", String(e?.message ?? e));
    }
  }, 0);

  /** @type {import("./lib/orchestration-service.cjs").OrchestrationService} */
  const orchestrationService = new OrchestrationService({
    readConfig: () => userConfigStore.readRaw(),
    syncAgentFromStudio: (reason) => runOpenClawAgentSyncFromStudio(reason),
    acquireChatStreamSlot,
    releaseChatStreamSlot,
  });

  getSkillEnvironmentCached().catch((e) => {
    getStudioLog().warn("[skills] env probe failed:", /** @type {any} */ (e)?.message ?? e);
  });

  if (!isDev) {
    try {
      if (
        typeof process.resourcesPath === "string" &&
        repairWindowsOpenClawUnpackedLayout(process.resourcesPath)
      ) {
        getStudioLog().info("[startup] repaired openclaw.asar.unpacked layout");
      }
      if (typeof process.resourcesPath === "string") {
        const restored = repairWindowsBundledExtensionsFromMirror(process.resourcesPath);
        if (restored > 0) {
          getStudioLog().info("[startup] restored bundled extension files from mirror", { restored });
        }
      }
      getStudioLog().info("[startup] supervised gateway begin (background)");
      void ensureLocalGatewayRunning(() => userConfigStore.readRaw(), {
        log: getStudioLog(),
        probeOpenClawGateway,
      })
        .then((sup) => {
          getStudioLog().info("[startup] supervised gateway:", sup);
        })
        .catch((e) => {
          getStudioLog().error("[startup] supervised gateway threw:", /** @type {any} */ (e)?.message ?? e);
        });
    } catch (e) {
      getStudioLog().error("[startup] supervised gateway init threw:", /** @type {any} */ (e)?.message ?? e);
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

  ipcMain.handle("studio:openExternalUrl", async (_event, rawUrl, opts) => {
    const url = String(rawUrl ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "invalid_url" };
    }
    const forceExternal =
      opts && typeof opts === "object" && !Array.isArray(opts) && opts.forceExternal === true;
    if (!forceExternal && userConfigStore) {
      const cfg = userConfigStore.readRaw();
      const mode = cfg?.chatLabLinkOpenMode === "external" ? "external" : "sidebar";
      if (mode === "sidebar" && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(PREVIEW_URL_CHAN, { url });
        return { ok: true, opened: "sidebar" };
      }
    }
    try {
      await shell.openExternal(url);
      return { ok: true, opened: "external" };
    } catch (e) {
      return { ok: false, error: String(/** @type {any} */ (e)?.message ?? e) };
    }
  });

  ipcMain.handle("studio:revealLocalPath", async (_event, rawPath) => {
    const raw = String(rawPath ?? "").trim();
    if (!raw) return { ok: false, error: "empty_path" };

    let filePath = raw;
    if (/^file:\/\//i.test(raw)) {
      try {
        filePath = fileURLToPath(raw);
      } catch {
        return { ok: false, error: "invalid_path" };
      }
    } else if (raw === "~") {
      filePath = app.getPath("home");
    } else if (raw.startsWith("~/") || raw.startsWith("~\\")) {
      filePath = path.join(app.getPath("home"), raw.slice(2));
    }

    try {
      const st = fs.statSync(filePath);
      if (st.isDirectory()) {
        const openErr = await shell.openPath(filePath);
        if (String(openErr ?? "").trim()) return { ok: false, error: openErr };
        return { ok: true };
      }
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(/** @type {any} */ (e)?.message ?? e) };
    }
  });

  ipcMain.handle("studio:saveImageFromUrl", async (_event, payload) => {
    const url = String(payload?.url ?? "").trim();
    if (!url) return { ok: false, error: "no_url" };

    const suggestedRaw = String(payload?.suggestedName ?? "image").trim() || "image";
    const suggested = suggestedRaw.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").slice(0, 120);

    /** @type {Buffer | undefined} */
    let buffer;
    let ext = "png";
    try {
      if (url.startsWith("file://")) {
        const filePath = fileURLToPath(url);
        buffer = fs.readFileSync(filePath);
        const dotExt = path.extname(filePath).slice(1);
        if (dotExt) ext = dotExt;
      } else if (url.startsWith("data:")) {
        const match = url.match(/^data:image\/(\w+);base64,(.+)$/i);
        if (match) {
          ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
          buffer = Buffer.from(match[2], "base64");
        } else {
          const res = await fetch(url);
          if (!res.ok) return { ok: false, error: `fetch_${res.status}` };
          buffer = Buffer.from(await res.arrayBuffer());
        }
      } else {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `fetch_${res.status}` };
        buffer = Buffer.from(await res.arrayBuffer());
        const ct = String(res.headers.get("content-type") ?? "").toLowerCase();
        if (ct.includes("jpeg")) ext = "jpg";
        else if (ct.includes("png")) ext = "png";
        else if (ct.includes("webp")) ext = "webp";
        else if (ct.includes("gif")) ext = "gif";
        else if (ct.includes("svg")) ext = "svg";
      }
    } catch (e) {
      return { ok: false, error: String(/** @type {any} */ (e)?.message ?? e) };
    }

    if (!buffer?.length) return { ok: false, error: "empty_image" };

    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const defaultName = /\.[a-z0-9]{2,5}$/i.test(suggested) ? suggested : `${suggested}.${ext}`;
    const { filePath, canceled } = await dialog.showSaveDialog(win ?? undefined, {
      defaultPath: defaultName,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"],
        },
      ],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      fs.writeFileSync(filePath, buffer);
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: String(/** @type {any} */ (e)?.message ?? e) };
    }
  });

  ipcMain.handle("studio:openLogsDirectory", async () => {
    const logsDir = app.getPath("logs");
    const errMsg = await shell.openPath(logsDir);
    if (String(errMsg ?? "").trim()) {
      getStudioLog().warn("[logs] shell.openPath failed:", errMsg);
      return { ok: false, path: logsDir, message: String(errMsg) };
    }
    return { ok: true, path: logsDir };
  });

  ipcMain.handle("studio:showSystemNotification", async (_event, payload) => {
    try {
      const title = String(payload?.title ?? "Open Studio").trim() || "Open Studio";
      const body = String(payload?.body ?? "").trim();
      if (!body) {
        return { ok: false, error: "empty_body" };
      }
      const notification = new Notification({
        title,
        body,
        silent: payload?.silent === true,
      });
      notification.show();
      return { ok: true };
    } catch (e) {
      getStudioLog().error("[notification] Failed to show notification:", e);
      return { ok: false, error: String(e?.message ?? e) };
    }
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

  ipcMain.handle("studio:listWorkspacePreviewDirectory", (_event, rawPath, opts) => {
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    return listWorkspacePreviewDirectory(cfg, rawPath, opts && typeof opts === "object" ? opts : {});
  });

  ipcMain.handle("studio:getWorkspaceContext", (_event, payload) => {
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    const userRoot = typeof payload?.root === "string" ? payload.root : "";
    const ctx = getWorkspaceContext(cfg, userRoot);
    if (!ctx.ok) return ctx;
    return { ok: true, root: ctx.root, label: ctx.label, git: ctx.git };
  });

  ipcMain.handle("studio:searchWorkspaceFiles", (_event, payload) => {
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    const userRoot = typeof payload?.root === "string" ? payload.root : "";
    const query = typeof payload?.query === "string" ? payload.query : "";
    const root = resolveWorkspaceRoot(cfg, userRoot);
    return searchWorkspaceFiles(root, query);
  });

  ipcMain.handle("studio:checkoutGitBranch", (_event, payload) => {
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    const userRoot = typeof payload?.root === "string" ? payload.root : "";
    const branch = typeof payload?.branch === "string" ? payload.branch : "";
    const root = resolveWorkspaceRoot(cfg, userRoot);
    const result = checkoutGitBranch(root, branch);
    if (!result.ok) return result;
    const ctx = getWorkspaceContext(cfg, root);
    if (!ctx.ok) return ctx;
    return { ok: true, root: ctx.root, label: ctx.label, git: ctx.git };
  });

  ipcMain.handle("studio:describeWorkspaceProject", (_event, payload) => {
    const userRoot = typeof payload?.root === "string" ? payload.root : "";
    if (!userRoot.trim()) return { ok: false, message: "empty_path" };
    return describeWorkspaceProject(userRoot);
  });

  ipcMain.handle("studio:pickWorkspaceFolder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
    return { ok: true, path: filePaths[0] };
  });

  ipcMain.handle("studio:statLocalPath", (_event, rawPath) => {
    const p = typeof rawPath === "string" ? rawPath.trim() : "";
    if (!p) return { ok: false, exists: false };
    try {
      const st = fs.statSync(p);
      return { ok: true, exists: true, isFile: st.isFile(), isDirectory: st.isDirectory() };
    } catch {
      return { ok: true, exists: false };
    }
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

  ipcMain.handle("studio:getDefaultGatewayAgentId", () => {
    const cfg = userConfigStore.readRaw();
    return { ok: true, gatewayAgentId: defaultGatewayAgentIdFromConfig(cfg) };
  });

  ipcMain.handle("studio:provisionAgent", async (_event, payload) => {
    try {
      const cfg = userConfigStore.readRaw();
      const result = provisionOpenClawAgent(payload, cfg);
      if (result.ok) {
        runOpenClawAgentSyncFromStudio("agent-provision");
        await restartOwnedGateway(() => userConfigStore.readRaw(), { probeOpenClawGateway });
        await waitForGatewayWarmupIfNeeded(() => userConfigStore.readRaw(), { probeOpenClawGateway });
      }
      return result;
    } catch (e) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:deleteGatewayAgent", async (_event, payload) => {
    try {
      const cfg = userConfigStore.readRaw();
      const result = removeOpenClawAgent(payload, cfg);
      if (result.ok && result.removed) {
        await restartOwnedGateway(() => userConfigStore.readRaw(), { probeOpenClawGateway });
        await waitForGatewayWarmupIfNeeded(() => userConfigStore.readRaw(), { probeOpenClawGateway });
      }
      return result;
    } catch (e) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:readAgentSoul", async (_event, payload) => {
    try {
      const cfg = userConfigStore.readRaw();
      return readAgentSoulMd(payload, cfg);
    } catch (e) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:readAgentIdentity", async (_event, payload) => {
    try {
      const cfg = userConfigStore.readRaw();
      return readAgentIdentityMd(payload, cfg);
    } catch (e) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
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
    const agentKeysRaw = Array.isArray(payload?.agentSessionKeys) ? payload.agentSessionKeys : [];
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
    /** @type {string[]} */
    const agentSessionKeys = [];
    const seenKeys = new Set();
    for (const x of agentKeysRaw) {
      if (typeof x !== "string" || !x.trim()) continue;
      const t = x.trim();
      if (seenKeys.has(t)) continue;
      seenKeys.add(t);
      agentSessionKeys.push(t);
      if (agentSessionKeys.length >= 32) break;
    }
    if (ids.length === 0 && agentSessionKeys.length === 0) return { ok: true, skipped: "empty" };
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    try {
      const cfg = userConfigStore.readRaw();
      const url = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
      if (!url) return { ok: true, skipped: "no_gateway" };
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), STUDIO_PREWARM_BUDGET_MS);
      try {
        const urgentFirst = Boolean(payload?.urgentFirst);
        const urgent = Boolean(payload?.urgent);
        if (ids.length) {
          await prewarmStudioGatewaySessions(cfg, ids, ac.signal, { urgentFirst });
        }
        if (agentSessionKeys.length) {
          await prewarmGatewaySessionKeys(cfg, agentSessionKeys, ac.signal, { urgent: urgent || urgentFirst });
        }
        return { ok: true, warmed: ids.length, agentSessions: agentSessionKeys.length };
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
    const gatewayConversationId =
      typeof payload?.gatewayConversationId === "string" && payload.gatewayConversationId.trim()
        ? payload.gatewayConversationId.trim()
        : conversationId;
    const channel = payload?.channel === "wechat" ? "wechat" : "internal";
    const wechatPeerId = typeof payload?.wechatPeerId === "string" ? payload.wechatPeerId.trim() : "";
    const agentSessionKey =
      typeof payload?.agentSessionKey === "string" ? payload.agentSessionKey.trim() : "";
    const gatewayAgentId =
      typeof payload?.gatewayAgentId === "string" ? payload.gatewayAgentId.trim() : "";
    if (typeof streamId !== "string" || !streamId.trim() || !Array.isArray(messages)) {
      throw new Error("invalid_chat_payload");
    }

    /** @param {unknown[]} rows @param {string} soul */
    const withAgentSoulSystem = (rows, soul) => {
      const rest = rows.filter((m) => !(m && typeof m === "object" && m.role === "system"));
      const studioSystem = rows.find((m) => m && typeof m === "object" && m.role === "system");
      const studioBody =
        studioSystem && typeof studioSystem.content === "string" ? studioSystem.content.trim() : "";
      // Renderer builds system rows with group-chat attribution rules; do not replace with disk bootstrap.
      if (studioBody) return [{ role: "system", content: studioBody }, ...rest];
      const body = String(soul ?? "").trim();
      if (!body) return rows;
      return [{ role: "system", content: body }, ...rest];
    };

    const pending = inFlightChatSends.get(streamId);
    if (pending) {
      getStudioLog().info("[chat.send.perf] host.dedupe.wait", { streamId });
      return pending;
    }

    const run = (async () => {
      const startedAt = Date.now();
      await acquireChatStreamSlot(streamId);
      const ac = new AbortController();
      chatStreamAbortControllers.set(streamId, ac);
      const wc = event.sender;
      const composerSkill = payload?.composerSkill;
      let allowConcurrent = payload?.concurrent === true;
      if (conversationId && !allowConcurrent) {
        const existing = chatStreamsByConversationId.get(conversationId);
        if (existing && existing.size > 0) allowConcurrent = true;
      }
      let terminalSent = false;
      let streamEventCount = 0;
      const streamOptsBase = {
        composerSkill,
        channel,
        wechatPeerId,
        contextEmbedMode:
          typeof payload?.contextEmbedMode === "string" ? payload.contextEmbedMode.trim() : "full",
        ...(typeof payload?.threadSummaryPrefix === "string" && payload.threadSummaryPrefix
          ? { threadSummaryPrefix: payload.threadSummaryPrefix }
          : {}),
        ...(agentSessionKey ? { agentSessionKey } : {}),
      };
      if (tokenUsageStore) {
        const cfgForUsage = userConfigStore.readRaw();
        const routedAgentIdForEstimate =
          gatewayAgentId || (agentSessionKey ? parseAgentIdFromSessionKey(agentSessionKey) : "");
        const bootstrapForEstimate = routedAgentIdForEstimate
          ? readAgentBootstrapForChat(routedAgentIdForEstimate, cfgForUsage)
          : "";
        const estimateMessages = withAgentSoulSystem(messages, bootstrapForEstimate);
        const outboundEstimate = measureOutboundMessageParts(estimateMessages, composerSkill, streamOptsBase);
        tokenUsageStore.beginStream(streamId, {
          ...buildStreamUsageContext(payload, resolveActiveModelMeta(cfgForUsage)),
          usageBreakdown: outboundEstimate,
        });
      }
      const trackStreamEvent = (evt) => {
        streamEventCount += 1;
        if (evt?.type === "usage" && evt.usage && tokenUsageStore) {
          if (evt.authoritative) tokenUsageStore.replaceStreamUsage(streamId, evt.usage);
          else tokenUsageStore.noteStreamUsage(streamId, evt.usage);
          if (evt.usageBreakdown && typeof evt.usageBreakdown === "object") {
            tokenUsageStore.patchStreamBreakdown(streamId, evt.usageBreakdown);
          }
        }
        if (evt?.type === "tool_trace" && tokenUsageStore) {
          const toolCallId = typeof evt.toolCallId === "string" ? evt.toolCallId.trim() : "";
          if (toolCallId) tokenUsageStore.noteStreamToolCall(streamId, toolCallId);
        }
        if (!wc.isDestroyed()) wc.send(CHAT_STREAM_CHAN, { streamId, ...evt });
      };
      try {
        if (conversationId) {
          if (allowConcurrent) {
            let set = chatStreamsByConversationId.get(conversationId);
            if (!set) {
              set = new Set();
              chatStreamsByConversationId.set(conversationId, set);
            }
            set.add(streamId);
          } else {
            const prevStreamId = chatStreamByConversationId.get(conversationId);
            if (prevStreamId && prevStreamId !== streamId) {
              chatStreamAbortControllers.get(prevStreamId)?.abort();
            }
            const concurrentSet = chatStreamsByConversationId.get(conversationId);
            if (concurrentSet) {
              for (const sid of concurrentSet) {
                if (sid !== streamId) chatStreamAbortControllers.get(sid)?.abort();
              }
              chatStreamsByConversationId.delete(conversationId);
            }
            chatStreamByConversationId.set(conversationId, streamId);
          }
        }
        getStudioLog().info("[chat.send.perf] host.start", {
          streamId,
          conversationId,
          gatewayConversationId:
            gatewayConversationId !== conversationId ? gatewayConversationId : undefined,
        });
        runOpenClawAgentSyncFromStudio("chat");
        const cfg = userConfigStore.readRaw();
        await waitForGatewayWarmupIfNeeded(() => userConfigStore.readRaw(), { probeOpenClawGateway });
        const routedAgentId =
          gatewayAgentId || (agentSessionKey ? parseAgentIdFromSessionKey(agentSessionKey) : "");
        const bootstrapFromDisk = routedAgentId ? readAgentBootstrapForChat(routedAgentId, cfg) : "";
        const outboundMessages = withAgentSoulSystem(messages, bootstrapFromDisk);
        await dispatchOpenClawGatewayStream(
          cfg,
          outboundMessages,
          ac.signal,
          trackStreamEvent,
          gatewayConversationId
            ? {
                conversationId: gatewayConversationId,
                uiConversationId: conversationId,
                ...streamOptsBase,
              }
            : streamOptsBase,
        );
        if (channel === "wechat" && wechatPeerId && conversationId) {
          wechatPeerConversationMap.set(wechatPeerId, conversationId);
        }
      } catch (e) {
        if (!wc.isDestroyed()) {
          if (ac.signal.aborted || e?.name === "AbortError") {
            wc.send(CHAT_STREAM_CHAN, { streamId, type: "aborted" });
            terminalSent = true;
          } else {
            wc.send(CHAT_STREAM_CHAN, { streamId, type: "error", message: String(e?.message ?? e) });
            terminalSent = true;
          }
        }
      } finally {
        releaseChatStreamSlot();
        chatStreamAbortControllers.delete(streamId);
        if (tokenUsageStore) tokenUsageStore.finalizeStream(streamId);
        if (conversationId) {
          if (allowConcurrent) {
            const set = chatStreamsByConversationId.get(conversationId);
            set?.delete(streamId);
            if (set && set.size === 0) chatStreamsByConversationId.delete(conversationId);
          } else if (chatStreamByConversationId.get(conversationId) === streamId) {
            chatStreamByConversationId.delete(conversationId);
          }
        }
        if (!terminalSent && !wc.isDestroyed()) {
          const elapsedMs = Date.now() - startedAt;
          const sid = streamId;
          if (streamEventCount === 0 && elapsedMs < 500) {
            getStudioLog().warn("[chat.send.perf] host.empty_early", {
              streamId,
              conversationId,
              elapsedMs,
              concurrent: allowConcurrent,
              aborted: ac.signal.aborted,
            });
            wc.send(CHAT_STREAM_CHAN, {
              streamId: sid,
              type: "error",
              message: ac.signal.aborted
                ? "stream_aborted_before_reply"
                : "stream_empty_before_gateway_reply",
            });
            terminalSent = true;
          } else {
            setImmediate(() => {
              if (!wc.isDestroyed()) wc.send(CHAT_STREAM_CHAN, { streamId: sid, type: "done" });
            });
          }
        }
        getStudioLog().info("[chat.send.perf] host.done", {
          streamId,
          elapsedMs: Date.now() - startedAt,
          events: streamEventCount,
          concurrent: allowConcurrent,
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

  ipcMain.handle("studio:orchestrationCommand", async (event, payload) => {
    try {
      await orchestrationService.handleCommand(event.sender, payload && typeof payload === "object" ? payload : {});
      return { ok: true };
    } catch (e) {
      getStudioLog().warn("[orchestration] command failed", { message: String(e?.message ?? e) });
      return { ok: false, message: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:wechatSendTyping", async (_event, payload) => {
    try {
      const cfg = userConfigStore.readRaw();
      const peerId = String(payload?.peerId ?? "").trim();
      const status = payload?.status === 2 ? 2 : 1;
      if (!peerId) return { ok: false, message: "wechat_invalid_typing_peer" };
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 10_000);
      try {
        const client = await acquireWechatGatewaySession(cfg, ac.signal);
        const res = await sendWechatTyping(client, { peerId, status }, cfg);
        return { ok: Boolean(res?.ok), ...res };
      } finally {
        clearTimeout(tid);
      }
    } catch (err) {
      return { ok: false, message: String(err?.message ?? err) };
    }
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

  ipcMain.handle("studio:resolveWechatMediaPath", (_event, rawPath) => {
    if (!userConfigStore) return { ok: false, message: "config_unready" };
    const cfg = userConfigStore.readRaw();
    const resolved = resolveWorkspacePreviewTarget(cfg, rawPath);
    if (!resolved.ok) return resolved;
    return { ok: true, filePath: resolved.filePath, ext: resolved.ext, mime: resolved.mime };
  });

  ipcMain.handle("studio:wechatSendMedia", async (event, payload) => {
    try {
      runOpenClawAgentSyncFromStudio("chat");
      const cfg = userConfigStore.readRaw();
      const peerId = String(payload?.peerId ?? "").trim();
      const rawMediaPath = String(payload?.mediaPath ?? "").trim();
      const text = String(payload?.text ?? "").trim();
      const conversationId = String(payload?.conversationId ?? "").trim();
      const localMessageId = String(payload?.localMessageId ?? "").trim();
      const requestId = String(
        payload?.requestId ?? `${conversationId}:${peerId}:media:${rawMediaPath.slice(-48)}`,
      ).trim();
      if (!peerId || !rawMediaPath) return { ok: false, message: "wechat_invalid_media_outbound" };

      /** @type {string} */
      let mediaPath = rawMediaPath;
      if (!/^https?:\/\//i.test(rawMediaPath)) {
        const resolved = resolveWorkspacePreviewTarget(cfg, rawMediaPath);
        if (!resolved.ok) return { ok: false, message: resolved.message ?? "resolve_failed" };
        mediaPath = resolved.filePath;
      }

      const inFlight = inFlightWechatSends.get(requestId);
      if (inFlight) return inFlight;
      const run = (async () => {
        const ac = new AbortController();
        const tid = setTimeout(() => ac.abort(), 120_000);
        try {
          const client = await acquireWechatGatewaySession(cfg, ac.signal);
          const sent = await sendWechatMedia(
            client,
            {
              peerId,
              mediaPath,
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
            mediaPath,
          });
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

  ipcMain.handle("studio:getTokenUsageStats", (_event, opts) => {
    if (!tokenUsageStore) return { ok: false, error: "store_unavailable" };
    const range = opts?.range === "7d" || opts?.range === "30d" ? opts.range : "all";
    return { ok: true, stats: tokenUsageStore.queryStats({ range }) };
  });

  ipcMain.handle("studio:getTokenUsageRecords", (_event, opts) => {
    if (!tokenUsageStore) return { ok: false, error: "store_unavailable" };
    const conversationId =
      typeof opts?.conversationId === "string" ? opts.conversationId.trim() : undefined;
    const limit = typeof opts?.limit === "number" ? opts.limit : undefined;
    const offset = typeof opts?.offset === "number" ? opts.offset : undefined;
    return {
      ok: true,
      ...tokenUsageStore.queryRecords({ conversationId, limit, offset }),
    };
  });

  ipcMain.handle("studio:resetTokenUsageStats", () => {
    if (!tokenUsageStore) return { ok: false, error: "store_unavailable" };
    tokenUsageStore.resetAll();
    return { ok: true };
  });

  ipcMain.handle("studio:chatSessionsLoadAll", () => {
    if (!chatSessionsStore) return { ok: false, error: "store_unavailable", sessions: [] };
    try {
      return { ok: true, sessions: chatSessionsStore.loadAll() };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e), sessions: [] };
    }
  });

  ipcMain.handle("studio:chatSessionsUpsert", (_event, session) => {
    if (!chatSessionsStore) return { ok: false, error: "store_unavailable" };
    try {
      return chatSessionsStore.upsert(session && typeof session === "object" ? session : {});
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:chatSessionsDelete", (_event, id) => {
    if (!chatSessionsStore) return { ok: false, error: "store_unavailable" };
    try {
      return chatSessionsStore.deleteOne(typeof id === "string" ? id : "");
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:chatSessionsDeleteMany", (_event, ids) => {
    if (!chatSessionsStore) return { ok: false, error: "store_unavailable" };
    try {
      const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
      return chatSessionsStore.deleteMany(list);
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("studio:chatSessionsImportLegacy", (_event, sessions) => {
    if (!chatSessionsStore) return { ok: false, error: "store_unavailable" };
    try {
      const list = Array.isArray(sessions) ? sessions : [];
      return chatSessionsStore.importLegacy(list);
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
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
        const result = await generateConversationTitle(cfg, text, ac.signal);
        if (result.usage && tokenUsageStore) {
          const modelMeta = resolveActiveModelMeta(cfg);
          tokenUsageStore.recordImmediate({
            conversationId:
              typeof payload?.conversationId === "string" ? payload.conversationId.trim() : "",
            userContentPreview: text.slice(0, 240),
            source: "title",
            channel: "internal",
            ...(modelMeta ?? {}),
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens:
              result.usage.totalTokens ??
              (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          });
        }
        return { ok: true, title: result.title };
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
