/**
 * Loopback HTTP bridge: OpenClaw browser tools → Electron.
 *
 * - `browser_open` / `browser_action` → renderer preview panel
 * - `browser_debug` / `browser_debugger` / `browser_screenshot` → main-process guest capture
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
const {
  handleSidebarDebugger,
  subscribeDebuggerPause,
  getDebuggerPauseSnapshot,
  isDebuggerPaused,
} = require("./preview-guest-debugger.cjs");
const { handleSidebarEval } = require("./preview-guest-eval.cjs");

const DEBUGGER_PAUSE_CHAN = "studio:debuggerPause";

const DEFAULT_PORT = 19111;
/** Dev default — avoids clobbering / stealing the packaged app's 19111 bridge. */
const DEV_DEFAULT_PORT = 19112;
const DEFAULT_TOKEN = "open-studio-local-sidebar-action";
const DEV_DEFAULT_TOKEN = "open-studio-local-sidebar-action-dev";
const REQUEST_TIMEOUT_MS = 120_000;
const PORT_FALLBACK_ATTEMPTS = 12;

/** @type {import("http").Server | null} */
let server = null;
/** @type {number} */
let listenPort = 0;
/** @type {string} */
let authToken = DEFAULT_TOKEN;
/** @type {Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; unsubPause?: () => void }>} */
const pending = new Map();
/** @type {Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>} */
const pendingOpen = new Map();
/** @type {(() => import("electron").BrowserWindow | null) | null} */
let getMainWindow = null;
/** @type {{ info?: Function; warn?: Function; error?: Function } | null} */
let log = null;
/** @type {(() => void) | null} */
let unsubBroadcastPause = null;

/**
 * @returns {boolean}
 */
function isDevBridgeProcess() {
  return process.env.NODE_ENV === "development";
}

/**
 * @returns {{ url: string; token: string; port: number }}
 */
function getSidebarActionToolBridgeInfo() {
  const port = listenPort || (isDevBridgeProcess() ? DEV_DEFAULT_PORT : DEFAULT_PORT);
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
 * @param {number} [preferred]
 * @returns {number}
 */
function resolvePreferredBridgePort(preferred) {
  const fromOpt = Number(preferred);
  if (Number.isFinite(fromOpt) && fromOpt > 0) return Math.floor(fromOpt);
  const fromEnv = Number(process.env.OPEN_STUDIO_SIDEBAR_TOOL_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return isDevBridgeProcess() ? DEV_DEFAULT_PORT : DEFAULT_PORT;
}

/**
 * @param {import("http").Server} httpServer
 * @param {number} port
 * @returns {Promise<number>}
 */
function listenOnce(httpServer, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      httpServer.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve(port);
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, "127.0.0.1");
  });
}

/**
 * @param {import("http").Server} httpServer
 */
function closeServerQuiet(httpServer) {
  try {
    httpServer.removeAllListeners("error");
    httpServer.removeAllListeners("listening");
    httpServer.close();
  } catch {
    /* ignore */
  }
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
  if (typeof entry.unsubPause === "function") {
    try {
      entry.unsubPause();
    } catch {
      /* ignore */
    }
  }
  if (payload.error) {
    entry.reject(new Error(String(payload.error)));
  } else {
    entry.resolve(payload.result ?? { ok: false, error: "empty_result" });
  }
  return true;
}

/**
 * Broadcast pause/resume to the Open Studio renderer (host-side banner; guest JS may be frozen).
 * @param {Record<string, unknown>} evt
 */
function broadcastDebuggerPause(evt) {
  const win = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  try {
    win.webContents.send(DEBUGGER_PAUSE_CHAN, evt);
  } catch {
    /* ignore */
  }
}

/**
 * If a breakpoint hits while sidebar_action is in-flight, unblock the tool immediately
 * so the agent can inspect — otherwise executeJavaScript hangs until the 120s timeout
 * and the model wrongly concludes "breakpoint missed".
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
function dispatchToRendererWithDebuggerRace(body) {
  if (isDebuggerPaused()) {
    const pause = getDebuggerPauseSnapshot();
    return Promise.resolve({
      ok: true,
      debuggerPaused: true,
      stoppedByBreakpoint: true,
      message:
        "Page is already paused on a breakpoint. Call browser_debugger op=inspect if needed, then ALWAYS op=resume before more browser_action steps or retries.",
      pause,
      steps: [],
    });
  }
  return dispatchToRenderer(body);
}

function resolvePendingOpen(id, payload) {
  const entry = pendingOpen.get(id);
  if (!entry) return false;
  pendingOpen.delete(id);
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
function dispatchBrowserOpenToRenderer(body) {
  const win = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return Promise.resolve({
      ok: false,
      error: "no_renderer",
      message: "Open Studio window is not ready for browser_open",
    });
  }
  const params = body && typeof body === "object" ? /** @type {any} */ (body) : {};
  const url = String(params.url ?? "").trim();
  if (!url) {
    return Promise.resolve({ ok: false, error: "missing_url", message: "url is required" });
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingOpen.delete(id);
      reject(new Error("browser_open renderer timeout"));
    }, 30_000);
    pendingOpen.set(id, { resolve, reject, timer });
    try {
      win.webContents.send("studio:browserOpenToolRequest", {
        id,
        url,
        title: typeof params.title === "string" ? params.title : undefined,
      });
    } catch (e) {
      pendingOpen.delete(id);
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
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
      message: "Open Studio window is not ready for browser_action",
    });
  }

  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (entry && typeof entry.unsubPause === "function") {
        try {
          entry.unsubPause();
        } catch {
          /* ignore */
        }
      }
      pending.delete(id);
      reject(new Error("browser_action renderer timeout"));
    }, REQUEST_TIMEOUT_MS);

    const unsubPause = subscribeDebuggerPause((evt) => {
      if (!evt || evt.paused !== true) return;
      if (!pending.has(id)) return;
      void (async () => {
        if (!pending.has(id)) return;
        const pause = getDebuggerPauseSnapshot();
        /** @type {unknown} */
        let inspection = null;
        try {
          inspection = await handleSidebarDebugger({ op: "inspect" });
        } catch {
          inspection = null;
        }
        if (!pending.has(id)) return;
        resolvePending(id, {
          result: {
            ok: true,
            debuggerPaused: true,
            stoppedByBreakpoint: true,
            message:
              "BREAKPOINT HIT during browser_action — page JS is frozen (pause bar on preview). Locals are in `inspect`. After reading them, ALWAYS call browser_debugger op=resume before retrying or more clicks — otherwise the user stays stuck. Do not treat this as a failed click.",
            pause: pause.paused ? pause : evt,
            inspect: inspection,
            steps: [
              {
                ok: true,
                action: "debugger_paused",
                debuggerPaused: true,
              },
            ],
          },
        });
      })();
    });

    pending.set(id, { resolve, reject, timer, unsubPause });
    try {
      win.webContents.send("studio:sidebarActionToolRequest", {
        id,
        steps: body && typeof body === "object" ? /** @type {any} */ (body).steps : undefined,
        args: body,
      });
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      try {
        unsubPause();
      } catch {
        /* ignore */
      }
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
 * @returns {Promise<{ url: string; token: string; port: number }>}
 */
async function startSidebarActionToolBridge(opts) {
  if (server && listenPort > 0) {
    return getSidebarActionToolBridgeInfo();
  }
  if (server) {
    closeServerQuiet(server);
    server = null;
    listenPort = 0;
  }

  getMainWindow = opts.getMainWindow;
  log = opts.log ?? null;
  const defaultToken = isDevBridgeProcess() ? DEV_DEFAULT_TOKEN : DEFAULT_TOKEN;
  authToken =
    String(opts.token || process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || defaultToken).trim() || defaultToken;
  const preferredPort = resolvePreferredBridgePort(opts.port);

  // Host-side pause banner (guest Runtime.evaluate cannot run reliably while paused).
  if (typeof unsubBroadcastPause === "function") {
    try {
      unsubBroadcastPause();
    } catch {
      /* ignore */
    }
  }
  unsubBroadcastPause = subscribeDebuggerPause((evt) => {
    broadcastDebuggerPause(evt && typeof evt === "object" ? /** @type {Record<string, unknown>} */ (evt) : { paused: false });
  });

  /** @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res */
  const onRequest = async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${listenPort || preferredPort}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        sendJson(req, res, 200, {
          ok: true,
          service: "open-studio-browser-tools",
          port: listenPort || preferredPort,
          tools: [
            "browser_open",
            "browser_action",
            "browser_debug",
            "browser_debugger",
            "browser_eval",
            "browser_screenshot",
          ],
        });
        return;
      }

      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const isOpen =
        pathname === "/v1/browser_open" ||
        pathname === "/browser_open";
      const isAction =
        pathname === "/v1/browser_action" ||
        pathname === "/browser_action" ||
        pathname === "/v1/sidebar_action" ||
        pathname === "/sidebar_action";
      const isDebug =
        pathname === "/v1/browser_debug" ||
        pathname === "/browser_debug" ||
        pathname === "/v1/sidebar_debug" ||
        pathname === "/sidebar_debug";
      const isDebugger =
        pathname === "/v1/browser_debugger" ||
        pathname === "/browser_debugger" ||
        pathname === "/v1/sidebar_debugger" ||
        pathname === "/sidebar_debugger";
      const isEval =
        pathname === "/v1/browser_eval" ||
        pathname === "/browser_eval" ||
        pathname === "/v1/sidebar_eval" ||
        pathname === "/sidebar_eval";
      const isScreenshot =
        pathname === "/v1/browser_screenshot" ||
        pathname === "/browser_screenshot" ||
        pathname === "/v1/sidebar_screenshot" ||
        pathname === "/sidebar_screenshot";

      if (
        req.method !== "POST" ||
        (!isOpen && !isAction && !isDebug && !isDebugger && !isEval && !isScreenshot)
      ) {
        sendJson(req, res, 404, {
          ok: false,
          error: "not_found",
          path: pathname,
          method: req.method,
          availablePostRoutes: [
            "/v1/browser_open",
            "/v1/browser_action",
            "/v1/browser_debug",
            "/v1/browser_debugger",
            "/v1/browser_eval",
            "/v1/browser_screenshot",
          ],
          hint:
            `404 from Open Studio browser-tools bridge (127.0.0.1:${listenPort || preferredPort}). Fully quit and restart Open Studio if routes were recently added. GET /health lists supported tools.`,
        });
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
      if (isOpen) {
        result = await dispatchBrowserOpenToRenderer(body);
      } else if (isDebug) {
        result = await handleSidebarDebug(body && typeof body === "object" ? body : {});
      } else if (isDebugger) {
        result = await handleSidebarDebugger(body && typeof body === "object" ? body : {});
      } else if (isEval) {
        result = await handleSidebarEval(body && typeof body === "object" ? body : {});
      } else if (isScreenshot) {
        result = await handleSidebarScreenshot(body && typeof body === "object" ? body : {});
      } else {
        result = await dispatchToRendererWithDebuggerRace(body);
      }
      sendJson(req, res, 200, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log?.warn?.("[sidebar-action-bridge] request failed:", message);
      sendJson(req, res, 500, { ok: false, error: "bridge_error", message });
    }
  };

  /** @type {Error | null} */
  let lastErr = null;
  for (let i = 0; i < PORT_FALLBACK_ATTEMPTS; i++) {
    const port = preferredPort + i;
    const candidate = http.createServer(onRequest);
    try {
      await listenOnce(candidate, port);
      server = candidate;
      listenPort = port;
      const info = applySidebarActionToolEnv(process.env);
      if (i > 0) {
        log?.warn?.("[sidebar-action-bridge] preferred port busy; bound fallback", {
          preferredPort,
          port,
          url: info.url,
        });
      } else {
        log?.info?.("[sidebar-action-bridge] listening", info.url);
      }
      return info;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      closeServerQuiet(candidate);
      const code = /** @type {NodeJS.ErrnoException} */ (lastErr).code;
      if (code !== "EADDRINUSE") {
        log?.error?.("[sidebar-action-bridge] listen failed:", lastErr.message);
        break;
      }
      log?.warn?.("[sidebar-action-bridge] port in use, trying next", { port, next: port + 1 });
    }
  }

  server = null;
  listenPort = 0;
  const message = lastErr?.message || "listen_failed";
  log?.error?.("[sidebar-action-bridge] listen failed after retries:", message);
  // Still publish preferred URL so logs show intent; gateway calls will fail loudly.
  listenPort = preferredPort;
  const info = applySidebarActionToolEnv(process.env);
  listenPort = 0;
  return info;
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

function handleBrowserOpenToolRespond(payload) {
  const id = String(payload?.id ?? "").trim();
  if (!id) return { ok: false, error: "missing_id" };
  const ok = resolvePendingOpen(id, {
    result: payload?.result,
    error: payload?.error ? String(payload.error) : undefined,
  });
  return { ok };
}

function stopSidebarActionToolBridge() {
  for (const [id, entry] of pendingOpen) {
    clearTimeout(entry.timer);
    entry.reject(new Error("bridge_stopped"));
    pendingOpen.delete(id);
  }
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
  DEV_DEFAULT_PORT,
  DEFAULT_TOKEN,
  DEV_DEFAULT_TOKEN,
  startSidebarActionToolBridge,
  stopSidebarActionToolBridge,
  handleSidebarActionToolRespond,
  handleBrowserOpenToolRespond,
  getSidebarActionToolBridgeInfo,
  applySidebarActionToolEnv,
};
