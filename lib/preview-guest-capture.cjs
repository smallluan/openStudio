/**
 * Guest webview capture for Open Studio preview / Web Explore:
 * - console + network ring buffers (recording gated)
 * - viewport screenshots via capturePage
 *
 * Used by native tools `sidebar_debug` and `sidebar_screenshot`.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PREVIEW_PARTITION = "persist:openstudio-preview";
const MAX_CONSOLE = 400;
const MAX_NETWORK = 300;
const MAX_BODY_CHARS = 12_000;
const MAX_CATALOG = 80;
const MAX_FETCH = 20;
const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token)$/i;

/** @type {Map<number, import("electron").WebContents>} */
const guests = new Map();
/** @type {number | null} */
let activeGuestId = null;

/** @type {{ active: boolean; startedAt: number | null; startedMs: number | null }} */
let recording = { active: false, startedAt: null, startedMs: null };

/** @type {Array<Record<string, unknown>>} */
let consoleBuf = [];
/** @type {Array<Record<string, unknown>>} */
let networkBuf = [];
/** @type {Map<string, Record<string, unknown>>} */
const networkByRequestId = new Map();

let consoleSeq = 0;
let networkSeq = 0;

/** @type {{ info?: Function; warn?: Function; error?: Function } | null} */
let log = null;
/** @type {boolean} */
let webRequestHooked = false;
/** When true, CDP Network is live — skip webRequest duplicate rows. */
let cdpNetworkActive = false;

/**
 * @param {{ info?: Function; warn?: Function; error?: Function } | null | undefined} logger
 */
function initPreviewGuestCapture(logger) {
  log = logger ?? null;
  ensureWebRequestFallback();
}

/**
 * Fallback metadata-only network capture when CDP debugger cannot attach
 * (e.g. guest DevTools already open). No response bodies.
 */
function ensureWebRequestFallback() {
  if (webRequestHooked) return;
  try {
    const { session } = require("electron");
    const ses = session.fromPartition(PREVIEW_PARTITION);
    ses.webRequest.onCompleted({ urls: ["http://*/*", "https://*/*"] }, (details) => {
      if (!recording.active || cdpNetworkActive) return;
      const url = String(details.url || "");
      networkSeq += 1;
      const row = {
        id: `req_${networkSeq}`,
        requestId: `wr_${details.id}`,
        ts: Date.now(),
        method: String(details.method || "GET"),
        url,
        type: String(details.resourceType || ""),
        status: Number(details.statusCode) || 0,
        mimeType: "",
        ok: details.statusCode >= 200 && details.statusCode < 400,
        errorText: "",
        requestHeaders: {},
        responseHeaders: sanitizeHeaders(details.responseHeaders, false),
        body: "",
        bodyTruncated: false,
        guestId: activeGuestId,
        source: "webRequest",
      };
      networkBuf.push(row);
      if (networkBuf.length > MAX_NETWORK) networkBuf.shift();
    });
    ses.webRequest.onErrorOccurred({ urls: ["http://*/*", "https://*/*"] }, (details) => {
      if (!recording.active || cdpNetworkActive) return;
      networkSeq += 1;
      networkBuf.push({
        id: `req_${networkSeq}`,
        requestId: `wr_${details.id}`,
        ts: Date.now(),
        method: String(details.method || "GET"),
        url: String(details.url || ""),
        type: String(details.resourceType || ""),
        status: null,
        mimeType: "",
        ok: false,
        errorText: String(details.error || "error"),
        requestHeaders: {},
        responseHeaders: {},
        body: "",
        bodyTruncated: false,
        guestId: activeGuestId,
        source: "webRequest",
      });
      if (networkBuf.length > MAX_NETWORK) networkBuf.shift();
    });
    webRequestHooked = true;
  } catch (e) {
    log?.warn?.("[preview-guest-capture] webRequest fallback unavailable:", e?.message ?? e);
  }
}

/**
 * @param {import("electron").WebContents} guestContents
 */
function attachPreviewGuest(guestContents) {
  if (!guestContents || guestContents.isDestroyed?.()) return;
  const id = guestContents.id;
  if (guests.has(id)) return;
  guests.set(id, guestContents);
  if (activeGuestId == null) activeGuestId = id;

  // Electron 42+: details on the event object; older positional args still emitted for compat.
  guestContents.on("console-message", (event, level, message, line, sourceId) => {
    if (!recording.active) return;
    const details = event && typeof event === "object" ? event : {};
    const msg = details.message != null ? details.message : message;
    const lvl = details.level != null ? details.level : level;
    const lineNo = details.lineNumber != null ? details.lineNumber : line;
    const src = details.sourceId != null ? details.sourceId : sourceId;
    pushConsole({
      level: consoleLevelName(lvl),
      message: String(msg ?? "").slice(0, 4000),
      line: Number(lineNo) || 0,
      source: String(src ?? "").slice(0, 500),
      guestId: id,
    });
  });

  guestContents.on("destroyed", () => {
    guests.delete(id);
    if (activeGuestId === id) {
      activeGuestId = guests.size ? [...guests.keys()].at(-1) ?? null : null;
    }
    if (recording.active && activeGuestId == null) {
      stopRecordingInternal({ detachDebugger: true });
    }
  });

  log?.info?.("[preview-guest-capture] attached guest", { id });
}

/**
 * @param {number | string | null | undefined} webContentsId
 */
function setActivePreviewGuest(webContentsId) {
  const id = Number(webContentsId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: "invalid_guest_id" };
  }
  if (!guests.has(id)) {
    // Guest may not have fired did-attach yet; still remember preference.
    activeGuestId = id;
    return { ok: true, activeGuestId: id, pending: true };
  }
  activeGuestId = id;
  return { ok: true, activeGuestId: id };
}

/**
 * @returns {import("electron").WebContents | null}
 */
function getActiveGuest() {
  if (activeGuestId != null) {
    const wc = guests.get(activeGuestId);
    if (wc && !wc.isDestroyed()) return wc;
  }
  for (const wc of guests.values()) {
    if (wc && !wc.isDestroyed()) return wc;
  }
  return null;
}

/**
 * @param {string | number | undefined} level
 */
function consoleLevelName(level) {
  if (typeof level === "string") {
    const s = level.toLowerCase();
    if (s === "warning" || s === "warn") return "warn";
    if (s === "error") return "error";
    if (s === "info") return "info";
    if (s === "debug" || s === "verbose") return "debug";
    return s || "log";
  }
  // Legacy numeric: 0=verbose, 1=info, 2=warning, 3=error
  const n = Number(level);
  if (n >= 3) return "error";
  if (n === 2) return "warn";
  if (n === 1) return "info";
  return "log";
}

/**
 * @param {Record<string, unknown>} entry
 */
function pushConsole(entry) {
  consoleSeq += 1;
  const row = {
    id: `log_${consoleSeq}`,
    ts: Date.now(),
    ...entry,
  };
  consoleBuf.push(row);
  if (consoleBuf.length > MAX_CONSOLE) {
    consoleBuf = consoleBuf.slice(-MAX_CONSOLE);
  }
}

/**
 * @param {Record<string, string | undefined> | undefined} headers
 * @param {boolean} includeSensitive
 */
function sanitizeHeaders(headers, includeSensitive) {
  if (!headers || typeof headers !== "object") return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!includeSensitive && SENSITIVE_HEADER_RE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = String(v ?? "").slice(0, 2000);
  }
  return out;
}

/**
 * @param {string} url
 */
function shortUrl(url) {
  const s = String(url ?? "");
  if (s.length <= 160) return s;
  return `${s.slice(0, 100)}…${s.slice(-40)}`;
}

/**
 * @param {import("electron").WebContents} wc
 */
async function attachDebugger(wc) {
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach("1.3");
    }
  } catch (e) {
    log?.warn?.("[preview-guest-capture] debugger.attach failed:", e?.message ?? e);
    return false;
  }

  const onMessage = async (_event, method, params) => {
    if (!recording.active) return;
    try {
      if (method === "Network.requestWillBeSent") {
        const requestId = String(params?.requestId ?? "");
        if (!requestId) return;
        networkSeq += 1;
        const req = params.request || {};
        const row = {
          id: `req_${networkSeq}`,
          requestId,
          ts: Date.now(),
          method: String(req.method || "GET"),
          url: String(req.url || ""),
          type: String(params?.type || params?.resourceType || ""),
          status: null,
          mimeType: "",
          ok: null,
          errorText: "",
          requestHeaders: sanitizeHeaders(req.headers, false),
          responseHeaders: {},
          body: "",
          bodyTruncated: false,
          guestId: wc.id,
        };
        networkByRequestId.set(requestId, row);
        networkBuf.push(row);
        if (networkBuf.length > MAX_NETWORK) {
          const dropped = networkBuf.shift();
          if (dropped?.requestId) networkByRequestId.delete(String(dropped.requestId));
        }
        return;
      }

      if (method === "Network.responseReceived") {
        const requestId = String(params?.requestId ?? "");
        const row = networkByRequestId.get(requestId);
        if (!row) return;
        const response = params.response || {};
        row.status = Number(response.status) || 0;
        row.mimeType = String(response.mimeType || "");
        row.ok = row.status >= 200 && row.status < 400;
        row.responseHeaders = sanitizeHeaders(response.headers, false);
        row.type = String(params?.type || row.type || "");
        return;
      }

      if (method === "Network.loadingFailed") {
        const requestId = String(params?.requestId ?? "");
        const row = networkByRequestId.get(requestId);
        if (!row) return;
        row.ok = false;
        row.errorText = String(params?.errorText || params?.canceled || "loading_failed");
        return;
      }

      if (method === "Network.loadingFinished") {
        const requestId = String(params?.requestId ?? "");
        const row = networkByRequestId.get(requestId);
        if (!row || row.body) return;
        // Lazily fetch small text-ish bodies; skip obvious binaries.
        const mime = String(row.mimeType || "");
        const url = String(row.url || "");
        const maybeText =
          /json|text|javascript|xml|urlencoded|graphql/i.test(mime) ||
          /\.(json|js|css|txt|html|svg)(\?|$)/i.test(url) ||
          !mime;
        if (!maybeText) return;
        try {
          const bodyResult = await wc.debugger.sendCommand("Network.getResponseBody", { requestId });
          let text = bodyResult?.base64Encoded
            ? Buffer.from(String(bodyResult.body || ""), "base64").toString("utf8")
            : String(bodyResult?.body ?? "");
          if (text.length > MAX_BODY_CHARS) {
            text = text.slice(0, MAX_BODY_CHARS);
            row.bodyTruncated = true;
          }
          row.body = text;
        } catch {
          /* body unavailable (opaque / streamed / CORS) */
        }
      }
    } catch (e) {
      log?.warn?.("[preview-guest-capture] network event error:", e?.message ?? e);
    }
  };

  // Avoid stacking handlers across start/stop cycles.
  try {
    wc.debugger.removeAllListeners("message");
  } catch {
    /* ignore */
  }
  wc.debugger.on("message", onMessage);

  try {
    await wc.debugger.sendCommand("Network.enable");
    cdpNetworkActive = true;
  } catch (e) {
    log?.warn?.("[preview-guest-capture] Network.enable failed:", e?.message ?? e);
    cdpNetworkActive = false;
    return false;
  }
  return true;
}

/**
 * @param {import("electron").WebContents} wc
 */
function detachDebugger(wc) {
  cdpNetworkActive = false;
  try {
    if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) {
      wc.debugger.removeAllListeners("message");
      wc.debugger.detach();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Reload the active preview/Web Explore guest so first-load network/console can be captured.
 * @param {{ waitMs?: number; ignoreCache?: boolean }} [opts]
 */
async function reloadActiveGuest(opts = {}) {
  const wc = getActiveGuest();
  if (!wc) {
    return { ok: false, error: "no_guest", message: "No preview/Web Explore webview is attached" };
  }
  const urlBefore = safeGuestUrl(wc);
  const waitMs = Math.max(0, Math.min(15_000, Number(opts.waitMs) || 1200));
  const ignoreCache = opts.ignoreCache === true;
  try {
    if (ignoreCache && typeof wc.reloadIgnoringCache === "function") {
      wc.reloadIgnoringCache();
    } else {
      wc.reload();
    }
  } catch (e) {
    return {
      ok: false,
      error: "reload_failed",
      message: e instanceof Error ? e.message : String(e),
      url: urlBefore,
    };
  }
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return {
    ok: true,
    reloaded: true,
    ignoreCache,
    waitMs,
    urlBefore,
    url: safeGuestUrl(wc),
    guestId: wc.id,
    recording: getRecordingStatus(),
  };
}

/**
 * @param {{ clear?: boolean; reload?: boolean; waitMs?: number; ignoreCache?: boolean }} [opts]
 */
async function startRecording(opts = {}) {
  const wc = getActiveGuest();
  if (!wc) {
    return { ok: false, error: "no_guest", message: "No preview/Web Explore webview is attached" };
  }
  if (opts.clear) {
    clearBuffers();
  }
  const attached = await attachDebugger(wc);
  recording = { active: true, startedAt: Date.now(), startedMs: Date.now() };
  /** @type {Record<string, unknown>} */
  const result = {
    ok: true,
    recording: getRecordingStatus(),
    debuggerAttached: attached,
    guestId: wc.id,
    url: safeGuestUrl(wc),
  };
  // Start recording first, then reload — captures document navigation requests.
  if (opts.reload) {
    const reloadResult = await reloadActiveGuest({
      waitMs: opts.waitMs,
      ignoreCache: opts.ignoreCache,
    });
    result.reloaded = Boolean(reloadResult.ok);
    result.reload = reloadResult;
    if (reloadResult.ok) {
      result.url = reloadResult.url;
    } else {
      result.ok = false;
      result.error = reloadResult.error || "reload_failed";
      result.message = reloadResult.message;
    }
  }
  return result;
}

/**
 * @param {{ detachDebugger?: boolean }} [opts]
 */
function stopRecordingInternal(opts = {}) {
  recording = { active: false, startedAt: recording.startedAt, startedMs: recording.startedMs };
  if (opts.detachDebugger !== false) {
    const wc = getActiveGuest();
    if (wc) detachDebugger(wc);
  }
  return { ok: true, recording: getRecordingStatus() };
}

function stopRecording() {
  return stopRecordingInternal({ detachDebugger: true });
}

function clearBuffers() {
  consoleBuf = [];
  networkBuf = [];
  networkByRequestId.clear();
  return { ok: true, cleared: true, recording: getRecordingStatus() };
}

function getRecordingStatus() {
  return {
    active: recording.active,
    startedAt: recording.startedAt,
    elapsedMs: recording.startedAt ? Date.now() - recording.startedAt : 0,
    consoleCount: consoleBuf.length,
    networkCount: networkBuf.length,
    activeGuestId,
    guestCount: guests.size,
  };
}

/**
 * @param {import("electron").WebContents} wc
 */
function safeGuestUrl(wc) {
  try {
    return String(wc.getURL?.() ?? "");
  } catch {
    return "";
  }
}

/**
 * @param {Record<string, unknown>} args
 */
function buildCatalog(args = {}) {
  const max = Math.min(MAX_CATALOG, Math.max(1, Number(args.max) || 40));
  const levelFilter = normalizeStringList(args.logLevels);
  const contains = String(args.contains ?? "").trim().toLowerCase();
  const urlContains = String(args.urlContains ?? "").trim().toLowerCase();
  const statusMin = args.statusMin != null ? Number(args.statusMin) : null;
  const statusMax = args.statusMax != null ? Number(args.statusMax) : null;
  const onlyErrors = args.onlyErrors === true;

  let logs = consoleBuf.slice();
  if (levelFilter.length) {
    const set = new Set(levelFilter.map((x) => x.toLowerCase()));
    logs = logs.filter((r) => set.has(String(r.level || "").toLowerCase()));
  }
  if (contains) {
    logs = logs.filter((r) => String(r.message || "").toLowerCase().includes(contains));
  }
  if (onlyErrors) {
    logs = logs.filter((r) => r.level === "error" || r.level === "warn");
  }

  let network = networkBuf.slice();
  if (urlContains) {
    network = network.filter((r) => String(r.url || "").toLowerCase().includes(urlContains));
  }
  if (statusMin != null && Number.isFinite(statusMin)) {
    network = network.filter((r) => Number(r.status) >= statusMin);
  }
  if (statusMax != null && Number.isFinite(statusMax)) {
    network = network.filter((r) => Number(r.status) <= statusMax);
  }
  if (onlyErrors) {
    network = network.filter((r) => r.ok === false || Number(r.status) >= 400 || r.errorText);
  }

  const logCatalog = logs.slice(-max).map((r) => ({
    id: r.id,
    level: r.level,
    summary: truncateOneLine(`${r.level}: ${r.message}`, 160),
    source: r.source ? truncateOneLine(String(r.source), 80) : "",
    ts: r.ts,
  }));

  const networkCatalog = network.slice(-max).map((r) => {
    const status = r.status != null ? r.status : "?";
    const err = r.errorText ? ` ${r.errorText}` : "";
    return {
      id: r.id,
      method: r.method,
      status,
      summary: truncateOneLine(`${r.method} ${status} ${shortUrl(String(r.url))}${err}`, 180),
      url: shortUrl(String(r.url)),
      type: r.type || "",
      ok: r.ok,
      ts: r.ts,
    };
  });

  return {
    ok: true,
    recording: getRecordingStatus(),
    logCatalog,
    networkCatalog,
    hint: "Call sidebar_debug with op=fetch and networkIds/logIds (or filters) to pull details into context. Do not request everything unless needed.",
  };
}

/**
 * @param {Record<string, unknown>} args
 */
function fetchDetails(args = {}) {
  const max = Math.min(MAX_FETCH, Math.max(1, Number(args.max) || 8));
  const includeBody = args.includeResponseBody !== false;
  const includeSensitive = args.includeSensitive === true;
  const maxChars = Math.min(MAX_BODY_CHARS, Math.max(200, Number(args.maxChars) || 4000));

  const networkIds = new Set(normalizeStringList(args.networkIds));
  const logIds = new Set(normalizeStringList(args.logIds));
  const contains = String(args.contains ?? "").trim().toLowerCase();
  const urlContains = String(args.urlContains ?? "").trim().toLowerCase();
  const levelFilter = normalizeStringList(args.logLevels);
  const onlyErrors = args.onlyErrors === true;

  /** @type {Array<Record<string, unknown>>} */
  let logs = [];
  if (logIds.size) {
    logs = consoleBuf.filter((r) => logIds.has(String(r.id)));
  } else if (contains || levelFilter.length || onlyErrors || args.fetchLogs === true) {
    logs = consoleBuf.slice();
    if (levelFilter.length) {
      const set = new Set(levelFilter.map((x) => x.toLowerCase()));
      logs = logs.filter((r) => set.has(String(r.level || "").toLowerCase()));
    }
    if (contains) logs = logs.filter((r) => String(r.message || "").toLowerCase().includes(contains));
    if (onlyErrors) logs = logs.filter((r) => r.level === "error" || r.level === "warn");
  }

  /** @type {Array<Record<string, unknown>>} */
  let network = [];
  if (networkIds.size) {
    network = networkBuf.filter((r) => networkIds.has(String(r.id)));
  } else if (urlContains || onlyErrors || args.fetchNetwork === true) {
    network = networkBuf.slice();
    if (urlContains) network = network.filter((r) => String(r.url || "").toLowerCase().includes(urlContains));
    if (onlyErrors) {
      network = network.filter((r) => r.ok === false || Number(r.status) >= 400 || r.errorText);
    }
  }

  logs = logs.slice(-max);
  network = network.slice(-max);

  if (!logs.length && !network.length) {
    return {
      ok: false,
      error: "no_matches",
      message: "No log/network entries matched. Call op=catalog first, then fetch by id.",
      recording: getRecordingStatus(),
    };
  }

  return {
    ok: true,
    recording: getRecordingStatus(),
    logs: logs.map((r) => ({
      id: r.id,
      level: r.level,
      message: String(r.message || "").slice(0, maxChars),
      source: r.source,
      line: r.line,
      ts: r.ts,
    })),
    network: network.map((r) => {
      /** @type {Record<string, unknown>} */
      const out = {
        id: r.id,
        method: r.method,
        url: r.url,
        status: r.status,
        mimeType: r.mimeType,
        type: r.type,
        ok: r.ok,
        errorText: r.errorText,
        requestHeaders: includeSensitive
          ? r.requestHeaders
          : sanitizeHeaders(/** @type {any} */ (r.requestHeaders), false),
        responseHeaders: includeSensitive
          ? r.responseHeaders
          : sanitizeHeaders(/** @type {any} */ (r.responseHeaders), false),
        ts: r.ts,
      };
      if (includeBody) {
        const body = String(r.body || "");
        out.body = body.slice(0, maxChars);
        out.bodyTruncated = Boolean(r.bodyTruncated) || body.length > maxChars;
      }
      return out;
    }),
  };
}

/**
 * @param {Record<string, unknown>} args
 */
async function handleSidebarDebug(args = {}) {
  const op = String(args.op ?? args.action ?? "catalog").trim().toLowerCase();

  switch (op) {
    case "start":
      return startRecording({
        clear: args.clear !== false,
        reload: args.reload === true,
        waitMs: args.waitMs,
        ignoreCache: args.ignoreCache === true,
      });
    case "reload":
    case "refresh":
      return reloadActiveGuest({
        waitMs: args.waitMs,
        ignoreCache: args.ignoreCache === true,
      });
    case "stop":
      return stopRecording();
    case "clear":
      return clearBuffers();
    case "status":
      return { ok: true, recording: getRecordingStatus(), partition: PREVIEW_PARTITION };
    case "catalog":
      return buildCatalog(args);
    case "fetch":
      return fetchDetails(args);
    default:
      return {
        ok: false,
        error: "unknown_op",
        message: `Unknown op "${op}". Use start|stop|clear|status|catalog|fetch|reload.`,
      };
  }
}

/**
 * @param {Record<string, unknown>} [args]
 */
async function handleSidebarScreenshot(args = {}) {
  const wc = getActiveGuest();
  if (!wc) {
    return { ok: false, error: "no_guest", message: "No preview/Web Explore webview is attached" };
  }

  let image;
  try {
    image = await wc.capturePage();
  } catch (e) {
    return {
      ok: false,
      error: "capture_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const size = image.getSize();
  const png = image.toPNG();
  let tempRoot = "";
  try {
    tempRoot = require("electron").app.getPath("temp");
  } catch {
    tempRoot = require("os").tmpdir();
  }
  const dir = path.join(tempRoot, "open-studio-preview-shots");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const fileName = `shot-${Date.now()}-${wc.id}.png`;
  const filePath = path.join(dir, fileName);
  try {
    fs.writeFileSync(filePath, png);
  } catch (e) {
    return {
      ok: false,
      error: "write_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const includeBase64 = args.includeBase64 === true;
  /** @type {Record<string, unknown>} */
  const result = {
    ok: true,
    path: filePath,
    mimeType: "image/png",
    width: size.width,
    height: size.height,
    bytes: png.length,
    url: safeGuestUrl(wc),
    guestId: wc.id,
    hint: "Screenshot saved on disk. Vision-capable models can use this image; otherwise use path as a capture artifact. Prefer DOM inventory + sidebar_action for interaction.",
  };
  if (includeBase64) {
    // Cap ~1.5MB base64 payload for tool JSON
    if (png.length <= 1_100_000) {
      result.base64 = png.toString("base64");
    } else {
      result.base64Omitted = true;
      result.base64OmittedReason = "image_too_large";
    }
  }
  return result;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,|\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncateOneLine(text, max) {
  const s = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

module.exports = {
  PREVIEW_PARTITION,
  initPreviewGuestCapture,
  attachPreviewGuest,
  setActivePreviewGuest,
  getActiveGuest,
  handleSidebarDebug,
  handleSidebarScreenshot,
  getRecordingStatus,
};
