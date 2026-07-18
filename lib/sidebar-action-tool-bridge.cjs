/**
 * Loopback HTTP bridge: OpenClaw preview tools → Electron.
 *
 * - `sidebar_action` → renderer automation + DOM observation
 * - `sidebar_debug` / `sidebar_screenshot` → main-process guest capture
 *
 * Gateway process POSTs here; returns JSON tool results.
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const {
  handleSidebarDebug,
  handleSidebarScreenshot,
} = require("./preview-guest-capture.cjs");

const DEFAULT_PORT = 19111;
const DEFAULT_TOKEN = "open-studio-local-sidebar-action";
const REQUEST_TIMEOUT_MS = 120_000;

/** @type {import("http").Server | null} */
let server = null;
/** @type {number} */
let listenPort = 0;
/** @type {string} */
let authToken = DEFAULT_TOKEN;
/** @type {Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>} */
const pending = new Map();
/** @type {(() => import("electron").BrowserWindow | null) | null} */
let getMainWindow = null;
/** @type {{ info?: Function; warn?: Function; error?: Function } | null} */
let log = null;

/**
 * @returns {{ url: string; token: string; port: number }}
 */
function getSidebarActionToolBridgeInfo() {
  const port = listenPort || DEFAULT_PORT;
  return {
    url: `http://127.0.0.1:${port}`,
    token: authToken,
    port,
  };
}

/**
 * Apply env vars the gateway child should inherit (or already has via defaults).
 * @param {NodeJS.ProcessEnv} [env]
 */
function applySidebarActionToolEnv(env = process.env) {
  const info = getSidebarActionToolBridgeInfo();
  env.OPEN_STUDIO_SIDEBAR_TOOL_URL = info.url;
  env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN = info.token;
  return info;
}

/**
 * @param {string} id
 * @param {{ result?: unknown; error?: string }} payload
 */
function resolvePending(id, payload) {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (payload.error) {
    entry.reject(new Error(String(payload.error)));
  } else {
    entry.resolve(payload.result ?? { ok: false, error: "empty_result" });
  }
  return true;
}

/**
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
function dispatchToRenderer(body) {
  const win = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return Promise.resolve({
      ok: false,
      error: "no_renderer",
      message: "Open Studio window is not ready for sidebar_action",
    });
  }

  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("sidebar_action renderer timeout"));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      win.webContents.send("studio:sidebarActionToolRequest", {
        id,
        steps: body && typeof body === "object" ? /** @type {any} */ (body).steps : undefined,
        args: body,
      });
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    Connection: "close",
  });
  res.end(body);
}

/**
 * @param {import("http").IncomingMessage} req
 */
function authorize(req) {
  const expected = authToken;
  if (!expected) return true;
  const header = String(req.headers.authorization ?? "").trim();
  if (header.toLowerCase().startsWith("bearer ") && header.slice(7).trim() === expected) {
    return true;
  }
  const alt = String(req.headers["x-open-studio-token"] ?? "").trim();
  return alt === expected;
}

/**
 * @param {{
 *   getMainWindow: () => import("electron").BrowserWindow | null;
 *   log?: { info?: Function; warn?: Function; error?: Function };
 *   port?: number;
 *   token?: string;
 * }} opts
 */
function startSidebarActionToolBridge(opts) {
  if (server) {
    return getSidebarActionToolBridgeInfo();
  }

  getMainWindow = opts.getMainWindow;
  log = opts.log ?? null;
  authToken = String(opts.token || process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || DEFAULT_TOKEN).trim() || DEFAULT_TOKEN;
  const preferredPort = Number(opts.port || process.env.OPEN_STUDIO_SIDEBAR_TOOL_PORT || DEFAULT_PORT) || DEFAULT_PORT;

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${listenPort || preferredPort}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        sendJson(req, res, 200, {
          ok: true,
          service: "open-studio-sidebar-tools",
          tools: ["sidebar_action", "sidebar_debug", "sidebar_screenshot"],
        });
        return;
      }

      const pathname = url.pathname;
      const isAction =
        pathname === "/v1/sidebar_action" || pathname === "/sidebar_action";
      const isDebug = pathname === "/v1/sidebar_debug" || pathname === "/sidebar_debug";
      const isScreenshot =
        pathname === "/v1/sidebar_screenshot" || pathname === "/sidebar_screenshot";

      if (req.method !== "POST" || (!isAction && !isDebug && !isScreenshot)) {
        sendJson(req, res, 404, { ok: false, error: "not_found" });
        return;
      }

      if (!authorize(req)) {
        sendJson(req, res, 401, { ok: false, error: "unauthorized" });
        return;
      }

      const raw = await readBody(req);
      /** @type {unknown} */
      let body = {};
      if (raw.length) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          sendJson(req, res, 400, { ok: false, error: "invalid_json" });
          return;
        }
      }

      /** @type {unknown} */
      let result;
      if (isDebug) {
        result = await handleSidebarDebug(body && typeof body === "object" ? body : {});
      } else if (isScreenshot) {
        result = await handleSidebarScreenshot(body && typeof body === "object" ? body : {});
      } else {
        result = await dispatchToRenderer(body);
      }
      sendJson(req, res, 200, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log?.warn?.("[sidebar-action-bridge] request failed:", message);
      sendJson(req, res, 500, { ok: false, error: "bridge_error", message });
    }
  });

  listenPort = preferredPort;
  server.on("error", (err) => {
    log?.error?.("[sidebar-action-bridge] listen failed:", err?.message ?? err);
  });
  server.listen(preferredPort, "127.0.0.1", () => {
    listenPort = preferredPort;
    const info = applySidebarActionToolEnv(process.env);
    log?.info?.("[sidebar-action-bridge] listening", info.url);
  });
  return applySidebarActionToolEnv(process.env);
}

/**
 * Called from ipcMain when renderer finishes a tool request.
 * @param {{ id?: string; result?: unknown; error?: string }} payload
 */
function handleSidebarActionToolRespond(payload) {
  const id = String(payload?.id ?? "").trim();
  if (!id) return { ok: false, error: "missing_id" };
  const ok = resolvePending(id, {
    result: payload?.result,
    error: payload?.error ? String(payload.error) : undefined,
  });
  return { ok };
}

function stopSidebarActionToolBridge() {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("bridge_stopped"));
    pending.delete(id);
  }
  if (server) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    server = null;
  }
  listenPort = 0;
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_TOKEN,
  startSidebarActionToolBridge,
  stopSidebarActionToolBridge,
  handleSidebarActionToolRespond,
  getSidebarActionToolBridgeInfo,
  applySidebarActionToolEnv,
};
