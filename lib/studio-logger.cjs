/**
 * Centralized Electron main-process logging + safe metadata for gateway debugging.
 */

const path = require("path");

/** @typedef {{ isDev?: boolean }} InitOpts */

/** @type {typeof import('electron-log').default | null} */
let cached = null;
let initialized = false;

/**
 * Must run early in main (after app exists). Configures file under `logs/open-studio.log`.
 * @param {import('electron').App} app
 * @param {InitOpts} [opts]
 */
function initStudioLogger(app, opts = {}) {
  if (initialized) return getStudioLog();

  /** @type {typeof import('electron-log').default} */
  const elog = require("electron-log/main");
  try {
    elog.initialize?.({ preload: true });
  } catch {
    /* older electron-log fallback */
  }

  elog.transports.file.resolvePathFn = () => path.join(app.getPath("logs"), "open-studio.log");
  elog.transports.file.level = "verbose";

  elog.transports.console.level = opts.isDev ? "debug" : "info";

  cached = elog;
  initialized = true;
  return elog;
}

/** @returns {typeof import('electron-log').default} */
function getStudioLog() {
  if (cached) return cached;
  try {
    return require("electron-log/main");
  } catch {
    return /** @type {any} */ ({
      info: (...a) => console.log("[open-studio]", ...a),
      warn: (...a) => console.warn("[open-studio]", ...a),
      error: (...a) => console.error("[open-studio]", ...a),
      verbose: (...a) => console.log("[open-studio]", ...a),
      debug: (...a) => console.log("[open-studio]", ...a),
    });
  }
}

/** @param {unknown} cfg */
function gatewayDiagFromUserCfg(cfg) {
  try {
    const oc =
      cfg && typeof cfg === "object" ? /** @type {any} */ (cfg).openclaw ?? {} : {};
    const baseUrlRaw = typeof oc.gatewayBaseUrl === "string" ? oc.gatewayBaseUrl.trim() : "";
    const tok = typeof oc.gatewayToken === "string" ? oc.gatewayToken.trim() : "";
    const sessionKey =
      typeof oc.sessionKey === "string" && oc.sessionKey.trim() ? oc.sessionKey.trim() : "";

    /** @type {URL | null} */
    let u = null;
    try {
      u = baseUrlRaw ? new URL(/^https?:\/\//i.test(baseUrlRaw) ? baseUrlRaw : `http://${baseUrlRaw}`) : null;
    } catch {
      u = null;
    }

    return {
      gatewayBaseUrl: baseUrlRaw,
      gatewayParsedHost: u?.hostname ?? "",
      gatewayParsedPort: u?.port ?? "",
      gatewayParsedProtocol: u?.protocol ?? "",
      gatewayHasTokenConfigured: tok.length > 0,
      gatewayTokenChars: tok.length,
      gatewayTokenPrefixSample: tok ? `${tok.slice(0, 4)}…` : "",
      gatewaySessionKey: sessionKey ? sessionKey.slice(0, 64) : "",
    };
  } catch {
    return { gatewayBaseUrl: "", parse_failed: true };
  }
}

/**
 * Describe a WS URL without leaking token (token is handshake-only elsewhere).
 * @param {{ wsUrl?: string; baseUrl?: string }} resolved
 */
function gatewayResolvedSummary(resolved) {
  try {
    const ws = typeof resolved.wsUrl === "string" ? resolved.wsUrl : "";
    const base = typeof resolved.baseUrl === "string" ? resolved.baseUrl : "";
    let host = "";
    let port = "";
    try {
      const u = new URL(ws.endsWith("/") ? ws.slice(0, -1) : ws);
      host = u.hostname;
      port = u.port || (u.protocol === "wss:" ? "443" : "80");
    } catch {
      /* noop */
    }
    return {
      wsUrlHost: host,
      wsUrlPort: port,
      wsUrlProtocol: ws.startsWith("wss") ? "wss" : "ws",
      baseUrl: base,
      tokenConfigured: !!(resolved.token && String(resolved.token).trim()),
      tokenChars: typeof resolved.token === "string" ? resolved.token.trim().length : 0,
    };
  } catch {
    return { wsUrlSummary: false };
  }
}

module.exports = {
  initStudioLogger,
  getStudioLog,
  gatewayDiagFromUserCfg,
  gatewayResolvedSummary,
};
