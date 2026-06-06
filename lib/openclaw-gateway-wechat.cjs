const { randomUUID, createHash } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { resolveGateway } = require("./openclaw-gateway-ws.cjs");
const { resolveOpenClawStateDir } = require("./sync-openclaw-agent-from-studio.cjs");

const WECHAT_CAPABILITY_METHODS = [
  "wechat.capabilities",
  "wechat.capability",
  "plugins.wechat.capabilities",
  "plugins.wechat.capability",
  "plugin.wechat.capabilities",
  "plugin.wechat.capability",
  "capabilities",
  "rpc.capabilities",
  "methods.list",
  "rpc.discover",
  "gateway.capabilities",
];
const WECHAT_AUTH_START_METHODS = [
  "wechat.auth.startQr",
  "wechat.auth.startQR",
  "wechat.auth.startQRCode",
  "wechat.auth.start_qr",
  "wechat.auth.start_qrcode",
  "wechat.auth.startQrcode",
  "wechat.auth.start",
  "wechat.auth.login",
  "wechat.auth.qrcode",
  "wechat.auth.qrCode",
  "wechat.auth.qr_code",
  "wechat.auth.qr.start",
  "wechat.qr.start",
  "wechat.qrcode.start",
  "wechat.qrCode.start",
  "plugins.wechat.auth.startQr",
  "plugins.wechat.auth.startQR",
  "plugins.wechat.auth.startQRCode",
  "plugins.wechat.auth.start_qr",
  "plugins.wechat.auth.start_qrcode",
  "plugins.wechat.auth.startQrcode",
  "plugins.wechat.auth.start",
  "plugins.wechat.auth.login",
  "plugins.wechat.auth.qrcode",
  "plugins.wechat.auth.qrCode",
  "plugins.wechat.auth.qr_code",
  "plugins.wechat.auth.qr.start",
  "plugins.wechat.auth.qrcode.start",
  "plugins.wechat.auth.qrCode.start",
  "plugins.wechat.qr.start",
  "plugins.wechat.qrcode.start",
  "plugins.wechat.qrCode.start",
  "plugin.wechat.auth.startQr",
  "plugin.wechat.auth.startQR",
  "plugin.wechat.auth.startQRCode",
  "plugin.wechat.auth.start_qr",
  "plugin.wechat.auth.start_qrcode",
  "plugin.wechat.auth.startQrcode",
  "plugin.wechat.auth.start",
  "plugin.wechat.auth.login",
  "plugin.wechat.auth.qrcode",
  "plugin.wechat.auth.qrCode",
  "plugin.wechat.auth.qr_code",
  "plugin.wechat.auth.qr.start",
  "plugin.wechat.auth.qrcode.start",
  "plugin.wechat.auth.qrCode.start",
  "wechat.qr",
  "wechat.qrcode",
  "wechat.qr.get",
  "wechat.qrcode.get",
  "wechat.auth.qr",
  "wechat.auth.getQr",
  "wechat.auth.getQRCode",
  "plugins.wechat.qr",
  "plugins.wechat.qrcode",
  "plugins.wechat.qr.get",
  "plugins.wechat.qrcode.get",
  "plugins.wechat.auth.qr",
  "plugins.wechat.auth.getQr",
  "plugins.wechat.auth.getQRCode",
  "plugin.wechat.qr",
  "plugin.wechat.qrcode",
  "plugin.wechat.qr.get",
  "plugin.wechat.qrcode.get",
  "plugin.wechat.auth.qr",
  "plugin.wechat.auth.getQr",
  "plugin.wechat.auth.getQRCode",
];
const WECHAT_AUTH_STATUS_METHODS = [
  "wechat.auth.status",
  "wechat.auth.query",
  "wechat.auth.getStatus",
  "wechat.auth.get_status",
  "wechat.auth.qrcode.status",
  "wechat.auth.qrCode.status",
  "wechat.auth.qr.status",
  "wechat.status",
  "wechat.connection.status",
  "plugins.wechat.auth.status",
  "plugins.wechat.auth.query",
  "plugins.wechat.auth.getStatus",
  "plugins.wechat.auth.get_status",
  "plugins.wechat.auth.qrcode.status",
  "plugins.wechat.auth.qrCode.status",
  "plugins.wechat.auth.qr.status",
  "plugins.wechat.status",
  "plugins.wechat.connection.status",
  "plugin.wechat.auth.status",
  "plugin.wechat.auth.query",
  "plugin.wechat.auth.getStatus",
  "plugin.wechat.auth.get_status",
  "plugin.wechat.auth.qrcode.status",
  "plugin.wechat.auth.qrCode.status",
  "plugin.wechat.auth.qr.status",
  "plugin.wechat.status",
  "plugin.wechat.connection.status",
  "wechat.connection.state",
  "wechat.auth.state",
  "plugins.wechat.connection.state",
  "plugins.wechat.auth.state",
  "plugin.wechat.connection.state",
  "plugin.wechat.auth.state",
];
const WECHAT_AUTH_DISCONNECT_METHODS = [
  "wechat.auth.disconnect",
  "wechat.auth.logout",
  "wechat.disconnect",
  "plugins.wechat.auth.disconnect",
  "plugins.wechat.auth.logout",
  "plugins.wechat.disconnect",
];
const WECHAT_INBOUND_PULL_METHODS = [
  "wechat.inbound.pull",
  "wechat.messages.pull",
  "wechat.message.pull",
  "wechat.inbox.pull",
  "plugins.wechat.inbound.pull",
  "plugins.wechat.messages.pull",
  "plugins.wechat.message.pull",
  "plugins.wechat.inbox.pull",
];
const WECHAT_OUTBOUND_SEND_METHODS = [
  "wechat.outbound.send",
  "wechat.messages.send",
  "wechat.message.send",
  "plugins.wechat.outbound.send",
  "plugins.wechat.messages.send",
  "plugins.wechat.message.send",
];

const WECHAT_PLUGIN_MISSING_ERROR = "wechat_plugin_not_loaded";
const WECHAT_CHANNEL_ID = "openclaw-weixin";
const WECHAT_LEGACY_PLUGIN_IDS = new Set(["wechat", "openclaw-weixin"]);
const WECHAT_LOGIN_API_BASE = "https://ilinkai.weixin.qq.com";
const WECHAT_LOGIN_BOT_TYPE = "3";
const WEIXIN_TEXT_ITEM_TYPE = 1;
const WEIXIN_VOICE_ITEM_TYPE = 3;
const WEIXIN_GET_UPDATES_POLL_MS = 2_500;
const WECHAT_TOOL_PROBE_TTL_MS = 15_000;
/** @type {{ ts: number; available: boolean; reason?: string }} */
let wechatToolProbeCache = { ts: 0, available: true };
/** @type {Map<string, { sessionKey: string; qrText: string; startedAt: number }>} */
const activeWeixinLogins = new Map();
/** @type {Set<string>} */
const weixinLoginWaitInFlight = new Set();

/**
 * @param {unknown} err
 */
function errorToMessage(err) {
  const fromMessage = String(err?.message ?? "").trim();
  if (fromMessage) return fromMessage;
  const fromErrorMessage = String(err?.error?.message ?? "").trim();
  if (fromErrorMessage) return fromErrorMessage;
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch {
    /* ignore */
  }
  return String(err ?? "");
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {string[]} methods
 * @param {Record<string, unknown>} params
 */
async function requestWithFallback(client, methods, params = {}) {
  /** @type {unknown} */
  let lastErr = null;
  for (const method of methods) {
    try {
      const payload = await client.request(method, params);
      return { method, payload };
    } catch (err) {
      if (isMethodMissingError(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw /** @type {any} */ (lastErr);
  throw new Error("wechat_method_not_supported");
}

/** @param {unknown} err */
function isMethodMissingError(err) {
  const msg = errorToMessage(err);
  const code = Number(err?.code ?? err?.error?.code);
  if (code === -32601) return true;
  return /method[_\s-]?not[_\s-]?found|unknown[_\s-]?method|not[_\s-]?implemented|unsupported/i.test(msg);
}

/**
 * @param {unknown} cfg
 */
function resolveStateDirFromCfg(cfg) {
  const resolved = resolveGateway(cfg);
  return resolveOpenClawStateDir(resolved.baseUrl);
}

/**
 * Gateway-mapped state dir first, then the sibling profile (CLI login often writes ~/.openclaw).
 * @param {unknown} cfg
 */
function listCandidateStateDirs(cfg) {
  const primary = resolveStateDirFromCfg(cfg);
  const alt =
    path.basename(primary) === ".openclaw-dev"
      ? path.join(os.homedir(), ".openclaw")
      : path.join(os.homedir(), ".openclaw-dev");
  return primary === alt ? [primary] : [primary, alt];
}

/**
 * @param {string} stateDir
 */
function findWeixinPluginRoot(stateDir) {
  const npmProjects = path.join(stateDir, "npm", "projects");
  if (!fs.existsSync(npmProjects)) return null;
  for (const entry of fs.readdirSync(npmProjects)) {
    const root = path.join(npmProjects, entry, "node_modules", "@tencent-weixin", "openclaw-weixin");
    const loginQr = path.join(root, "dist", "src", "auth", "login-qr.js");
    if (fs.existsSync(loginQr)) return root;
  }
  return null;
}

/**
 * @param {unknown} [cfg]
 */
function resolveWeixinPluginStateDir(cfg) {
  const dirs = cfg ? listCandidateStateDirs(cfg) : [path.join(os.homedir(), ".openclaw-dev"), path.join(os.homedir(), ".openclaw")];
  for (const stateDir of dirs) {
    if (findWeixinPluginRoot(stateDir)) return stateDir;
  }
  return dirs[0] ?? path.join(os.homedir(), ".openclaw-dev");
}

/**
 * @param {string} stateDir
 * @param {unknown} [cfg]
 */
function isWeixinChannelPluginAvailable(stateDir, cfg) {
  if (findWeixinPluginRoot(stateDir)) return true;
  const dirs = cfg ? listCandidateStateDirs(cfg) : [stateDir];
  for (const dir of dirs) {
    if (findWeixinPluginRoot(dir)) return true;
    try {
      const cfgPath = path.join(dir, "openclaw.json");
      const raw = fs.readFileSync(cfgPath, "utf8");
      const parsed = JSON.parse(raw);
      const allow = Array.isArray(parsed?.plugins?.allow) ? parsed.plugins.allow : [];
      if (allow.some((id) => typeof id === "string" && WECHAT_LEGACY_PLUGIN_IDS.has(id.trim()))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * @param {string} stateDir
 * @param {string} relPath
 */
async function importWeixinPluginModule(accountStateDir, relPath, cfg) {
  const pluginStateDir = resolveWeixinPluginStateDir(cfg);
  const root = findWeixinPluginRoot(pluginStateDir) ?? findWeixinPluginRoot(accountStateDir);
  if (!root) throw new Error(WECHAT_PLUGIN_MISSING_ERROR);
  const abs = path.join(root, "dist", "src", relPath);
  if (!fs.existsSync(abs)) throw new Error(WECHAT_PLUGIN_MISSING_ERROR);
  const prev = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = accountStateDir;
  try {
    return await import(pathToFileURL(abs).href);
  } finally {
    if (prev === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = prev;
  }
}

/** @param {string} value */
function normalizeWeixinAccountId(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "default";
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "default";
}

/**
 * @param {string} stateDir
 */
/**
 * @param {unknown} [cfg]
 */
function resolveWeixinAccountsStateDir(cfg) {
  const dirs = cfg ? listCandidateStateDirs(cfg) : [];
  for (const stateDir of dirs) {
    const status = readWeixinConnectionStatusFromDir(stateDir);
    if (status.connected) return { stateDir, ...status };
  }
  return {
    stateDir: cfg ? resolveStateDirFromCfg(cfg) : path.join(os.homedir(), ".openclaw"),
    connected: false,
    accountId: "",
    accountName: "",
    qrText: "",
    qrImageDataUrl: "",
  };
}

function readWeixinConnectionStatusFromDir(stateDir) {
  const accountsDir = path.join(stateDir, "openclaw-weixin", "accounts");
  const indexPath = path.join(stateDir, "openclaw-weixin", "accounts.json");
  /** @type {string[]} */
  let accountIds = [];
  try {
    if (fs.existsSync(indexPath)) {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (Array.isArray(parsed)) {
        accountIds = parsed.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim());
      }
    }
  } catch {
    /* ignore */
  }
  if (accountIds.length === 0 && fs.existsSync(accountsDir)) {
    accountIds = fs
      .readdirSync(accountsDir)
      .filter((name) => name.endsWith(".json") && !name.includes(".sync.") && !name.includes(".context-tokens."))
      .map((name) => name.replace(/\.json$/i, ""));
  }
  for (const accountId of accountIds) {
    try {
      const raw = fs.readFileSync(path.join(accountsDir, `${accountId}.json`), "utf8");
      const row = JSON.parse(raw);
      const token = typeof row?.token === "string" ? row.token.trim() : "";
      if (!token) continue;
      return {
        connected: true,
        accountId,
        accountName: typeof row?.userId === "string" && row.userId.trim() ? row.userId.trim() : accountId,
      };
    } catch {
      /* try next */
    }
  }
  const pending = activeWeixinLogins.get(stateDir);
  if (pending?.qrText) {
    return {
      connected: false,
      accountId: "",
      accountName: "",
      qrText: pending.qrText,
      qrImageDataUrl: "",
    };
  }
  return { connected: false, accountId: "", accountName: "", qrText: "", qrImageDataUrl: "" };
}

/** @param {unknown} full */
function bodyFromWeixinItemList(itemList) {
  if (!Array.isArray(itemList)) return "";
  for (const item of itemList) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const type = Number(row.type);
    const textItem = row.text_item && typeof row.text_item === "object" ? row.text_item : null;
    if (type === WEIXIN_TEXT_ITEM_TYPE && textItem && textItem.text != null) {
      return String(textItem.text).trim();
    }
    const voiceItem = row.voice_item && typeof row.voice_item === "object" ? row.voice_item : null;
    if (type === WEIXIN_VOICE_ITEM_TYPE && voiceItem && voiceItem.text != null) {
      return String(voiceItem.text).trim();
    }
  }
  return "";
}

/** @param {unknown} full */
function stableWeixinInboundMessageId(peerId, text, ts, row) {
  const serverId = String(row.message_id ?? row.msg_id ?? row.server_msg_id ?? "").trim();
  const clientId = String(row.client_id ?? "").trim();
  if (serverId) return `wx:${serverId}`;
  if (clientId) return `wxc:${clientId}`;
  const contextToken = String(row.context_token ?? row.contextToken ?? "").trim();
  const toUserId = String(row.to_user_id ?? row.toUserId ?? "").trim();
  const checksum = createHash("sha1")
    .update(
      JSON.stringify({
        peerId,
        toUserId,
        text: text.slice(0, 512),
        ts,
        contextToken,
      }),
    )
    .digest("hex")
    .slice(0, 20);
  return `wxf:${checksum}`;
}

/**
 * @param {Record<string, unknown>} row
 */
function normalizeWeixinInboundTs(row) {
  const candidates = [
    row.create_time_ms,
    row.createTimeMs,
    row.create_time,
    row.createTime,
    row.ts,
    row.timestamp,
  ];
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw < 1_000_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw);
    }
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) {
        return parsed < 1_000_000_000_000 ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
      }
    }
  }
  return Date.now();
}

/** @param {unknown} full */
function normalizeWeixinInboundFromMessage(full) {
  if (!full || typeof full !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (full);
  const peerId = String(row.from_user_id ?? "").trim();
  const text = bodyFromWeixinItemList(row.item_list);
  if (!peerId || !text) return null;
  const ts = normalizeWeixinInboundTs(row);
  const messageId = stableWeixinInboundMessageId(peerId, text, ts, row);
  return {
    peerId,
    messageId,
    text,
    ts,
    contextToken: String(row.context_token ?? "").trim(),
  };
}

/**
 * @param {string} accountStateDir
 * @param {unknown} [cfg]
 * @param {{ limit?: number }} [opts]
 */
async function pullWeixinChannelInbound(accountStateDir, cfg, opts = {}) {
  const conn = readWeixinConnectionStatusFromDir(accountStateDir);
  if (!conn.connected || !conn.accountId) {
    return { ok: true, method: `${WECHAT_CHANNEL_ID}.getUpdates`, messages: [], raw: null };
  }
  const accounts = await importWeixinPluginModule(accountStateDir, "auth/accounts.js", cfg);
  const accountData =
    typeof accounts.loadWeixinAccount === "function" ? accounts.loadWeixinAccount(conn.accountId) : null;
  const token = typeof accountData?.token === "string" ? accountData.token.trim() : "";
  const baseUrl =
    typeof accountData?.baseUrl === "string" && accountData.baseUrl.trim()
      ? accountData.baseUrl.trim()
      : WECHAT_LOGIN_API_BASE;
  if (!token) {
    return { ok: true, method: `${WECHAT_CHANNEL_ID}.getUpdates`, messages: [], raw: null };
  }

  const api = await importWeixinPluginModule(accountStateDir, "api/api.js", cfg);
  const syncBuf = await importWeixinPluginModule(accountStateDir, "storage/sync-buf.js", cfg);
  const inbound = await importWeixinPluginModule(accountStateDir, "messaging/inbound.js", cfg);
  if (typeof inbound.restoreContextTokens === "function") inbound.restoreContextTokens(conn.accountId);

  const syncPath = syncBuf.getSyncBufFilePath(conn.accountId);
  const getUpdatesBuf =
    typeof syncBuf.loadGetUpdatesBuf === "function" ? syncBuf.loadGetUpdatesBuf(syncPath) ?? "" : "";

  const resp = await api.getUpdates({
    baseUrl,
    token,
    get_updates_buf: getUpdatesBuf,
    timeoutMs: WEIXIN_GET_UPDATES_POLL_MS,
  });

  if (resp?.get_updates_buf && typeof syncBuf.saveGetUpdatesBuf === "function") {
    syncBuf.saveGetUpdatesBuf(syncPath, resp.get_updates_buf);
  }

  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.min(50, Number(opts.limit))) : 10;
  const messages = [];
  const seenMessageIds = new Set();
  for (const full of (Array.isArray(resp?.msgs) ? resp.msgs : []).slice(0, limit)) {
    const normalized = normalizeWeixinInboundFromMessage(full);
    if (!normalized) continue;
    if (seenMessageIds.has(normalized.messageId)) continue;
    seenMessageIds.add(normalized.messageId);
    if (normalized.contextToken && typeof inbound.setContextToken === "function") {
      inbound.setContextToken(conn.accountId, normalized.peerId, normalized.contextToken);
    }
    messages.push({ ...normalized, accountId: conn.accountId });
  }
  return { ok: true, method: `${WECHAT_CHANNEL_ID}.getUpdates`, messages, raw: resp };
}

/**
 * @param {string} accountStateDir
 * @param {unknown} [cfg]
 * @param {{ peerId: string; text: string; accountId?: string }} args
 */
/**
 * @param {string} accountStateDir
 * @param {unknown} [cfg]
 * @param {{ peerId: string; status?: 1 | 2; accountId?: string }} args
 */
async function sendWeixinTypingIndicator(accountStateDir, cfg, args) {
  const peerId = String(args.peerId ?? "").trim();
  if (!peerId) throw new Error("wechat_invalid_typing_peer");

  const conn = readWeixinConnectionStatusFromDir(accountStateDir);
  const accountId = String(args.accountId ?? conn.accountId ?? "").trim();
  if (!accountId) throw new Error("wechat_account_not_configured");

  const accounts = await importWeixinPluginModule(accountStateDir, "auth/accounts.js", cfg);
  const accountData =
    typeof accounts.loadWeixinAccount === "function" ? accounts.loadWeixinAccount(accountId) : null;
  const token = typeof accountData?.token === "string" ? accountData.token.trim() : "";
  const baseUrl =
    typeof accountData?.baseUrl === "string" && accountData.baseUrl.trim()
      ? accountData.baseUrl.trim()
      : WECHAT_LOGIN_API_BASE;
  if (!token) throw new Error("wechat_account_not_configured");

  const inbound = await importWeixinPluginModule(accountStateDir, "messaging/inbound.js", cfg);
  if (typeof inbound.restoreContextTokens === "function") inbound.restoreContextTokens(accountId);
  const contextToken =
    typeof inbound.getContextToken === "function" ? inbound.getContextToken(accountId, peerId) : undefined;

  const api = await importWeixinPluginModule(accountStateDir, "api/api.js", cfg);
  let typingTicket = "";
  if (typeof api.getConfig === "function") {
    try {
      const configResp = await api.getConfig({
        baseUrl,
        token,
        ilinkUserId: peerId,
        contextToken,
        timeoutMs: 8_000,
      });
      typingTicket = String(configResp?.typing_ticket ?? "").trim();
    } catch {
      /* typing is best-effort */
    }
  }
  if (!typingTicket) return { ok: false, reason: "no_typing_ticket" };

  const status = args.status === 2 ? 2 : 1;
  if (typeof api.sendTyping === "function") {
    await api.sendTyping({
      baseUrl,
      token,
      timeoutMs: 8_000,
      body: {
        ilink_user_id: peerId,
        typing_ticket: typingTicket,
        status,
      },
    });
  }
  return { ok: true, status };
}

async function sendWeixinChannelOutbound(accountStateDir, cfg, args) {
  const peerId = String(args.peerId ?? "").trim();
  const text = String(args.text ?? "").trim();
  if (!peerId || !text) throw new Error("wechat_invalid_outbound");

  const conn = readWeixinConnectionStatusFromDir(accountStateDir);
  const accountId = String(args.accountId ?? conn.accountId ?? "").trim();
  if (!accountId) throw new Error("wechat_account_not_configured");

  const accounts = await importWeixinPluginModule(accountStateDir, "auth/accounts.js", cfg);
  const accountData =
    typeof accounts.loadWeixinAccount === "function" ? accounts.loadWeixinAccount(accountId) : null;
  const token = typeof accountData?.token === "string" ? accountData.token.trim() : "";
  const baseUrl =
    typeof accountData?.baseUrl === "string" && accountData.baseUrl.trim()
      ? accountData.baseUrl.trim()
      : WECHAT_LOGIN_API_BASE;
  if (!token) throw new Error("wechat_account_not_configured");

  const inbound = await importWeixinPluginModule(accountStateDir, "messaging/inbound.js", cfg);
  if (typeof inbound.restoreContextTokens === "function") inbound.restoreContextTokens(accountId);
  const contextToken =
    typeof inbound.getContextToken === "function" ? inbound.getContextToken(accountId, peerId) : undefined;

  const send = await importWeixinPluginModule(accountStateDir, "messaging/send.js", cfg);
  const result = await send.sendMessageWeixin({
    to: peerId,
    text,
    opts: { baseUrl, token, contextToken },
  });
  return {
    ok: true,
    method: `${WECHAT_CHANNEL_ID}.sendMessage`,
    messageId: String(result?.messageId ?? randomUUID()),
    raw: result,
  };
}

/**
 * @param {string} stateDir
 * @param {{ connected?: boolean; alreadyConnected?: boolean; botToken?: string; accountId?: string; baseUrl?: string; userId?: string }} result
 * @param {unknown} [cfg]
 */
async function persistWeixinLoginResult(stateDir, result, cfg) {
  if (!(result.connected || result.alreadyConnected) || !result.botToken || !result.accountId) return;
  const accounts = await importWeixinPluginModule(stateDir, "auth/accounts.js", cfg);
  const normalizedId = normalizeWeixinAccountId(result.accountId);
  accounts.saveWeixinAccount(normalizedId, {
    token: result.botToken,
    baseUrl: result.baseUrl || WECHAT_LOGIN_API_BASE,
    userId: result.userId,
  });
  accounts.registerWeixinAccountId(normalizedId);
  if (result.userId && typeof accounts.clearStaleAccountsForUserId === "function") {
    const inbound = await importWeixinPluginModule(stateDir, "messaging/inbound.js", cfg).catch(() => null);
    const onClear =
      inbound && typeof inbound.clearContextTokensForAccount === "function"
        ? inbound.clearContextTokensForAccount
        : undefined;
    accounts.clearStaleAccountsForUserId(normalizedId, result.userId, onClear);
  }
}

/**
 * @param {unknown} cfg
 * @param {string} sessionKey
 */
function beginWechatLoginWait(cfg, sessionKey) {
  const stateDir = resolveStateDirFromCfg(cfg);
  const waitKey = `${stateDir}:${sessionKey}`;
  if (weixinLoginWaitInFlight.has(waitKey)) return;
  weixinLoginWaitInFlight.add(waitKey);
  void (async () => {
    try {
      const login = await importWeixinPluginModule(stateDir, "auth/login-qr.js", cfg);
      const result = await login.waitForWeixinLogin({
        sessionKey,
        apiBaseUrl: WECHAT_LOGIN_API_BASE,
        timeoutMs: 480_000,
        botType: WECHAT_LOGIN_BOT_TYPE,
      });
      await persistWeixinLoginResult(stateDir, result, cfg);
      activeWeixinLogins.delete(stateDir);
    } catch {
      /* background wait is best-effort */
    } finally {
      weixinLoginWaitInFlight.delete(waitKey);
    }
  })();
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {unknown} [cfg]
 */
async function ensureWechatToolSurface(client, cfg) {
  const now = Date.now();
  if (cfg) {
    const stateDir = resolveStateDirFromCfg(cfg);
    if (isWeixinChannelPluginAvailable(stateDir, cfg)) {
      wechatToolProbeCache = { ts: now, available: true };
      return;
    }
  }
  if (now - wechatToolProbeCache.ts < WECHAT_TOOL_PROBE_TTL_MS) {
    if (!wechatToolProbeCache.available) throw new Error(wechatToolProbeCache.reason || WECHAT_PLUGIN_MISSING_ERROR);
    return;
  }
  try {
    const payload = await client.request("tools.catalog", { includePlugins: true });
    const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
    const groups = Array.isArray(obj.groups) ? obj.groups : [];
    const hasWechatGroup = groups.some((g) => {
      if (!g || typeof g !== "object") return false;
      const row = /** @type {Record<string, unknown>} */ (g);
      const id = String(row.id ?? "");
      const label = String(row.label ?? "");
      const source = String(row.source ?? "");
      return (
        /wechat|weixin/i.test(id) ||
        (/wechat|weixin/i.test(label) && /plugin/i.test(source))
      );
    });
    wechatToolProbeCache = {
      ts: now,
      available: hasWechatGroup,
      reason: hasWechatGroup ? "" : WECHAT_PLUGIN_MISSING_ERROR,
    };
    if (!hasWechatGroup) throw new Error(WECHAT_PLUGIN_MISSING_ERROR);
  } catch (err) {
    const msg = errorToMessage(err);
    if (isMethodMissingError(err) || /unknown method:\s*tools\.catalog/i.test(msg)) {
      wechatToolProbeCache = { ts: now, available: true };
      return;
    }
    throw err;
  }
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {Record<string, unknown>} params
 */
async function tryWebLoginStart(client, params) {
  try {
    const payload = await client.request("web.login.start", params);
    const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
    const qrText = String(obj.qrDataUrl ?? obj.qrText ?? obj.qr ?? "");
    const sessionKey = String(obj.sessionKey ?? "");
    if (!qrText) return null;
    return { qrText, sessionKey, raw: obj };
  } catch (err) {
    const msg = errorToMessage(err);
    if (/web login provider is not available/i.test(msg)) return null;
    if (isMethodMissingError(err)) return null;
    throw err;
  }
}

/**
 * @param {string} stateDir
 * @param {{ accountId?: string; force?: boolean }} [opts]
 */
async function startWeixinChannelQrAuth(stateDir, cfg, opts = {}) {
  const login = await importWeixinPluginModule(stateDir, "auth/login-qr.js", cfg);
  const result = await login.startWeixinLoginWithQr({
    accountId: typeof opts.accountId === "string" ? opts.accountId : undefined,
    force: Boolean(opts.force),
    apiBaseUrl: WECHAT_LOGIN_API_BASE,
    botType: WECHAT_LOGIN_BOT_TYPE,
  });
  const qrText = String(result?.qrcodeUrl ?? "");
  const sessionKey = String(result?.sessionKey ?? "");
  if (!qrText) throw new Error(String(result?.message ?? "wechat_qr_start_failed"));
  activeWeixinLogins.set(stateDir, { sessionKey, qrText, startedAt: Date.now() });
  return { qrText, sessionKey, message: String(result?.message ?? ""), raw: result };
}

/**
 * @param {string[]} methods
 */
function dedupeMethods(methods) {
  const out = [];
  const seen = new Set();
  for (const item of methods) {
    const m = String(item ?? "").trim();
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/**
 * @param {unknown} capRaw
 * @returns {string[]}
 */
function extractCapabilityMethods(capRaw) {
  if (!capRaw || typeof capRaw !== "object") return [];
  const obj = /** @type {Record<string, unknown>} */ (capRaw);
  const methods = Array.isArray(obj.methods)
    ? obj.methods
    : Array.isArray(obj.rpcMethods)
      ? obj.rpcMethods
      : Array.isArray(obj.availableMethods)
        ? obj.availableMethods
        : [];
  return dedupeMethods(methods.map((x) => String(x ?? "")));
}

/**
 * @param {string[]} methods
 * @param {"start" | "status"} kind
 */
function pickWechatMethods(methods, kind) {
  const rows = dedupeMethods(methods).filter((m) => /wechat/i.test(m));
  if (kind === "start") {
    return rows.filter((m) => /(start|login|qr|qrcode)/i.test(m));
  }
  return rows.filter((m) => /(status|state|query|get|info)/i.test(m));
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {"start" | "status"} kind
 * @param {string[]} fallbackMethods
 */
async function resolveWechatMethods(client, kind, fallbackMethods) {
  let discovered = [];
  try {
    const { payload } = await requestWithFallback(client, WECHAT_CAPABILITY_METHODS, {});
    discovered = pickWechatMethods(extractCapabilityMethods(payload), kind);
  } catch {
    /* capability probe is best-effort */
  }
  return dedupeMethods([...discovered, ...fallbackMethods]);
}

/**
 * @param {unknown} raw
 */
function normalizeInboundMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const peerId = String(row.peerId ?? row.openid ?? row.from ?? row.chatId ?? row.userId ?? "").trim();
  const text = String(row.text ?? row.content ?? row.body ?? "").trim();
  const ts = typeof row.ts === "number" ? row.ts : Date.now();
  if (!peerId || !text) return null;
  const explicitId = String(row.messageId ?? row.msgId ?? row.id ?? "").trim();
  const messageId = explicitId || `wxf:${peerId}:${ts}:${text.slice(0, 160)}`;
  return {
    peerId,
    messageId,
    text,
    ts,
    raw: row,
  };
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 */
async function probeWechatCapability(client) {
  try {
    const { payload } = await requestWithFallback(client, WECHAT_CAPABILITY_METHODS, {});
    const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
    return {
      available: true,
      methods:
        Array.isArray(obj.methods) && obj.methods.length > 0
          ? obj.methods.map((x) => String(x))
          : [
              ...WECHAT_AUTH_START_METHODS,
              ...WECHAT_AUTH_STATUS_METHODS,
              ...WECHAT_AUTH_DISCONNECT_METHODS,
              ...WECHAT_INBOUND_PULL_METHODS,
              ...WECHAT_OUTBOUND_SEND_METHODS,
            ],
      raw: obj,
    };
  } catch {
    return {
      available: false,
      methods: [],
      raw: null,
    };
  }
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {unknown} [cfg]
 */
async function startWechatQrAuth(client, cfg) {
  const stateDir = cfg ? resolveStateDirFromCfg(cfg) : null;
  if (stateDir && isWeixinChannelPluginAvailable(stateDir, cfg)) {
    const web = await tryWebLoginStart(client, {});
    if (web?.qrText) {
      activeWeixinLogins.set(stateDir, {
        sessionKey: web.sessionKey,
        qrText: web.qrText,
        startedAt: Date.now(),
      });
      if (web.sessionKey && cfg) beginWechatLoginWait(cfg, web.sessionKey);
      return {
        ok: true,
        method: "web.login.start",
        status: "pending",
        qrText: web.qrText,
        qrImageDataUrl: "",
        sessionKey: web.sessionKey,
        raw: web.raw,
      };
    }
    const channel = await startWeixinChannelQrAuth(stateDir, cfg, {});
    if (cfg && channel.sessionKey) beginWechatLoginWait(cfg, channel.sessionKey);
    return {
      ok: true,
      method: `${WECHAT_CHANNEL_ID}.loginWithQrStart`,
      status: "pending",
      qrText: channel.qrText,
      qrImageDataUrl: "",
      sessionKey: channel.sessionKey,
      raw: channel.raw,
    };
  }

  await ensureWechatToolSurface(client, cfg);
  try {
    const methods = await resolveWechatMethods(client, "start", WECHAT_AUTH_START_METHODS);
    const { payload, method } = await requestWithFallback(client, methods, {});
    const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
    return {
      ok: true,
      method,
      status: String(obj.status ?? "pending"),
      qrText: String(obj.qrText ?? obj.qr ?? obj.qrcode ?? obj.qrCode ?? ""),
      qrImageDataUrl: String(obj.qrImageDataUrl ?? obj.qrDataUrl ?? obj.qrcodeDataUrl ?? ""),
      expiresAt: typeof obj.expiresAt === "number" ? obj.expiresAt : null,
      raw: obj,
    };
  } catch (err) {
    if (!isMethodMissingError(err)) throw err;
    const status = await getWechatAuthStatus(client, cfg);
    return {
      ok: true,
      method: `${status.method} (status-fallback)`,
      status: status.status || "pending",
      qrText: String(status.raw?.qrText ?? status.raw?.qr ?? status.raw?.qrcode ?? status.raw?.qrCode ?? ""),
      qrImageDataUrl: String(
        status.raw?.qrImageDataUrl ?? status.raw?.qrDataUrl ?? status.raw?.qrcodeDataUrl ?? "",
      ),
      expiresAt: typeof status.raw?.expiresAt === "number" ? status.raw.expiresAt : null,
      raw: status.raw,
    };
  }
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {unknown} [cfg]
 */
async function getWechatAuthStatus(client, cfg) {
  const primaryDir = cfg ? resolveStateDirFromCfg(cfg) : null;
  if (primaryDir && isWeixinChannelPluginAvailable(primaryDir, cfg)) {
    const resolved = resolveWeixinAccountsStateDir(cfg);
    const local = resolved.connected
      ? resolved
      : {
          ...readWeixinConnectionStatusFromDir(primaryDir),
          stateDir: primaryDir,
        };
    const pending = activeWeixinLogins.get(primaryDir);
    if (!local.connected && pending?.qrText) {
      local.qrText = pending.qrText;
    }
    return {
      ok: true,
      method: `${WECHAT_CHANNEL_ID}.local-status`,
      status: local.connected ? "connected" : local.qrText ? "pending" : "disconnected",
      connected: Boolean(local.connected),
      accountId: String(local.accountId ?? ""),
      accountName: String(local.accountName ?? ""),
      qrText: String(local.qrText ?? ""),
      qrImageDataUrl: String(local.qrImageDataUrl ?? ""),
      raw: local,
    };
  }

  await ensureWechatToolSurface(client, cfg);
  const methods = await resolveWechatMethods(client, "status", WECHAT_AUTH_STATUS_METHODS);
  const { payload, method } = await requestWithFallback(client, methods, {});
  const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
  return {
    ok: true,
    method,
    status: String(obj.status ?? "unknown"),
    connected: Boolean(obj.connected ?? obj.loggedIn ?? false),
    accountId: String(obj.accountId ?? obj.wxid ?? obj.openid ?? ""),
    accountName: String(obj.accountName ?? obj.nick ?? obj.nickname ?? ""),
    qrText: String(obj.qrText ?? obj.qr ?? obj.qrcode ?? obj.qrCode ?? ""),
    qrImageDataUrl: String(obj.qrImageDataUrl ?? obj.qrDataUrl ?? obj.qrcodeDataUrl ?? ""),
    raw: obj,
  };
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {unknown} [cfg]
 */
async function disconnectWechatAuth(client, cfg) {
  const primaryDir = cfg ? resolveStateDirFromCfg(cfg) : null;
  if (primaryDir && isWeixinChannelPluginAvailable(primaryDir, cfg)) {
    for (const stateDir of cfg ? listCandidateStateDirs(cfg) : [primaryDir]) {
      activeWeixinLogins.delete(stateDir);
      try {
        const accounts = await importWeixinPluginModule(stateDir, "auth/accounts.js", cfg);
        const ids =
          typeof accounts.listIndexedWeixinAccountIds === "function"
            ? accounts.listIndexedWeixinAccountIds()
            : [];
        for (const accountId of ids) {
          if (typeof accounts.clearWeixinAccount === "function") accounts.clearWeixinAccount(accountId);
          if (typeof accounts.unregisterWeixinAccountId === "function") accounts.unregisterWeixinAccountId(accountId);
        }
      } catch {
        /* best-effort local disconnect */
      }
    }
    return { ok: true, method: `${WECHAT_CHANNEL_ID}.local-disconnect`, raw: null };
  }

  await ensureWechatToolSurface(client, cfg);
  const { payload, method } = await requestWithFallback(client, WECHAT_AUTH_DISCONNECT_METHODS, {});
  const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
  return { ok: true, method, raw: obj };
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {{ limit?: number }} [opts]
 */
async function pullWechatInbound(client, opts = {}, cfg) {
  const primaryDir = cfg ? resolveStateDirFromCfg(cfg) : null;
  if (primaryDir && isWeixinChannelPluginAvailable(primaryDir, cfg)) {
    const { stateDir } = resolveWeixinAccountsStateDir(cfg);
    return pullWeixinChannelInbound(stateDir, cfg, opts);
  }
  await ensureWechatToolSurface(client, cfg);
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.min(50, Number(opts.limit))) : 10;
  const { payload, method } = await requestWithFallback(client, WECHAT_INBOUND_PULL_METHODS, { limit });
  const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
  const rows = Array.isArray(obj.messages) ? obj.messages : Array.isArray(payload) ? payload : [];
  const messages = rows.map(normalizeInboundMessage).filter(Boolean);
  return {
    ok: true,
    method,
    messages,
    raw: obj,
  };
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {{ peerId: string; text: string; conversationId?: string; idempotencyKey?: string }} args
 */
async function sendWechatOutbound(client, args, cfg) {
  const primaryDir = cfg ? resolveStateDirFromCfg(cfg) : null;
  if (primaryDir && isWeixinChannelPluginAvailable(primaryDir, cfg)) {
    const { stateDir } = resolveWeixinAccountsStateDir(cfg);
    return sendWeixinChannelOutbound(stateDir, cfg, args);
  }
  await ensureWechatToolSurface(client, cfg);
  const peerId = String(args.peerId ?? "").trim();
  const text = String(args.text ?? "").trim();
  if (!peerId || !text) throw new Error("wechat_invalid_outbound");
  const idempotencyKey = String(args.idempotencyKey ?? randomUUID()).trim();
  const params = {
    peerId,
    text,
    conversationId: String(args.conversationId ?? "").trim(),
    idempotencyKey,
  };
  const { payload, method } = await requestWithFallback(client, WECHAT_OUTBOUND_SEND_METHODS, params);
  const obj = payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
  return {
    ok: true,
    method,
    messageId: String(obj.messageId ?? obj.id ?? idempotencyKey),
    raw: obj,
  };
}

/**
 * @param {Awaited<import("./openclaw-gateway-ws.cjs").openGatewayClient>} client
 * @param {{ peerId: string; status?: 1 | 2 }} args
 */
async function sendWechatTyping(client, args, cfg) {
  const peerId = String(args.peerId ?? "").trim();
  if (!peerId) throw new Error("wechat_invalid_typing_peer");
  const primaryDir = cfg ? resolveStateDirFromCfg(cfg) : null;
  if (primaryDir && isWeixinChannelPluginAvailable(primaryDir, cfg)) {
    const { stateDir } = resolveWeixinAccountsStateDir(cfg);
    return sendWeixinTypingIndicator(stateDir, cfg, args);
  }
  return { ok: false, reason: "weixin_plugin_unavailable" };
}

module.exports = {
  probeWechatCapability,
  startWechatQrAuth,
  getWechatAuthStatus,
  disconnectWechatAuth,
  pullWechatInbound,
  sendWechatOutbound,
  sendWechatTyping,
  beginWechatLoginWait,
};
