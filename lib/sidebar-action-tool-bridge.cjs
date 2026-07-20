/**
 * Loopback HTTP bridge: OpenClaw preview tools → Electron.
 *
 * - `sidebar_action` → renderer automation + DOM observation
 * - `sidebar_debug` / `sidebar_debugger` / `sidebar_screenshot` → main-process guest capture
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
const DEFAULT_TOKEN = "open-studio-local-sidebar-action";
const REQUEST_TIMEOUT_MS = 120_000;

/** @type {import("http").Server | null} */
let server = null;
/** @type {number} */
let listenPort = 0;
/** @type {string} */
let authToken = DEFAULT_TOKEN;
/** @type {Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; unsubPause?: () => void }>} */
const pending = new Map();
/** @type {(() => import("electron").BrowserWindow | null) | null} */
let getMainWindow = null;
/** @type {{ info?: Function; warn?: Function; error?: Function } | null} */
let log = null;
/** @type {(() => void) | null} */
let unsubBroadcastPause = null;

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
        "Page is already paused on a breakpoint. Call sidebar_debugger op=inspect if needed, then ALWAYS op=resume before more sidebar_action steps or retries.",
      pause,
      steps: [],
    });
  }
  return dispatchToRenderer(body);
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
      const entry = pending.get(id);
      if (entry && typeof entry.unsubPause === "function") {
        try {
          entry.unsubPause();
        } catch {
          /* ignore */
        }
      }
      pending.delete(id);
      reject(new Error("sidebar_action renderer timeout"));
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
              "BREAKPOINT HIT during sidebar_action — page JS is frozen (pause bar on preview). Locals are in `inspect`. After reading them, ALWAYS call sidebar_debugger op=resume before retrying or more clicks — otherwise the user stays stuck. Do not treat this as a failed click.",
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
 */
function startSidebarActionToolBridge(opts) {
  if (server) {
    return getSidebarActionToolBridgeInfo();
  }

  getMainWindow = opts.getMainWindow;
  log = opts.log ?? null;
  authToken = String(opts.token || process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || DEFAULT_TOKEN).trim() || DEFAULT_TOKEN;
  const preferredPort = Number(opts.port || process.env.OPEN_STUDIO_SIDEBAR_TOOL_PORT || DEFAULT_PORT) || DEFAULT_PORT;

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

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${listenPort || preferredPort}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        sendJson(req, res, 200, {
          ok: true,
          service: "open-studio-sidebar-tools",
          tools: ["sidebar_action", "sidebar_debug", "sidebar_debugger", "sidebar_eval", "sidebar_screenshot"],
        });
        return;
      }

      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const isAction =
        pathname === "/v1/sidebar_action" || pathname === "/sidebar_action";
      const isDebug = pathname === "/v1/sidebar_debug" || pathname === "/sidebar_debug";
      const isDebugger =
        pathname === "/v1/sidebar_debugger" || pathname === "/sidebar_debugger";
      const isEval = pathname === "/v1/sidebar_eval" || pathname === "/sidebar_eval";
      const isScreenshot =
        pathname === "/v1/sidebar_screenshot" || pathname === "/sidebar_screenshot";

      if (req.method !== "POST" || (!isAction && !isDebug && !isDebugger && !isEval && !isScreenshot)) {
        sendJson(req, res, 404, {
          ok: false,
          error: "not_found",
          path: pathname,
          method: req.method,
          availablePostRoutes: [
            "/v1/sidebar_action",
            "/v1/sidebar_debug",
            "/v1/sidebar_debugger",
            "/v1/sidebar_eval",
            "/v1/sidebar_screenshot",
          ],
          hint:
            "404 from Open Studio sidebar-tools bridge (127.0.0.1:19111). If sidebar_debugger was recently added, fully quit and restart Open Studio so the main process reloads lib/sidebar-action-tool-bridge.cjs. GET /health lists supported tools.",
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
      if (isDebug) {
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
