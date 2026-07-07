/**
 * Low-level OpenClaw Gateway WebSocket client (handshake + RPC).
 * Shared by persistent session, one-off probes, and chat streaming.
 *
 * Uses the `ws` package (Node/Electron main process). Relying on a global
 * `WebSocket` in Electron's main process is fragile; `ws` matches browser
 * semantics and surfaces real system errors (e.g. ECONNREFUSED).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const WebSocket = require("ws");
const { getStudioLog, gatewayResolvedSummary } = require("./studio-logger.cjs");

const PROTOCOL_VERSION = 4;
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const CLIENT_VERSION = "0.1.0-open-studio";
const CONNECT_HANDSHAKE_TIMEOUT_MS = 15_000;
/** After `connect`, prove the gateway kept operator scopes (non-loopback URLs often clear them). */
const POST_CONNECT_PROBE_TIMEOUT_MS = 15_000;
const CHALLENGE_GRACE_MS = 200;
/** Max attempts when gateway returns UNAVAILABLE startup-sidecars (see OpenClaw protocol.md). */
const CONNECT_SIDECAR_MAX_ATTEMPTS = 90;

const OPERATOR_ROLE = "operator";
const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.talk.secrets",
];

/** @param {string | undefined | null} u */
function trimTrailingSlash(u) {
  if (typeof u !== "string") return "";
  return u.replace(/\/+$/, "");
}

/** @param {string} httpUrl */
function httpToWs(httpUrl) {
  if (httpUrl.startsWith("https://")) return "wss://" + httpUrl.slice(8);
  if (httpUrl.startsWith("http://")) return "ws://" + httpUrl.slice(7);
  return httpUrl;
}

/**
 * Try to load the auth token of the OpenClaw `--dev` profile from
 * `~/.openclaw-dev/openclaw.json`.
 * @returns {string}
 */
function tryLoadDevToken() {
  try {
    const fp = path.join(os.homedir(), ".openclaw-dev", "openclaw.json");
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw);
    const tok = parsed?.gateway?.auth?.token;
    if (typeof tok === "string" && tok.trim()) return tok.trim();
  } catch {
    /* no dev profile yet */
  }
  return "";
}

/**
 * Heuristic: is this URL pointing at the local `--dev` profile gateway?
 * @param {string} baseUrl
 */
function looksLikeDevProfile(baseUrl) {
  // Also match 19002 — dev now uses a separate port to coexist with packaged exe.
  return /^https?:\/\/(?:127\.0\.0\.1|::1|localhost):1900[12]\b/.test(baseUrl);
}

/** OpenClaw clears requested operator scopes when it classifies the peer as non-local (LAN IP, proxy headers, etc.). */
function warnIfGatewayHostMayStripScopes(baseUrl) {
  try {
    const withScheme = /^https?:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
    const u = new URL(withScheme);
    const h = u.hostname.toLowerCase();
    const loopback =
      h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
    if (!loopback) {
      getStudioLog().warn(
        `[open-studio] Gateway URL host "${u.hostname}" is not loopback. OpenClaw may clear operator scopes on this WebSocket; same-machine gateways should use http://127.0.0.1:${u.port || "(port)"}.`,
      );
    }
  } catch {
    /* ignore */
  }
}

/**
 * Shared HTTP/WS/session resolution used by probe, chat streams, and bootstrap.
 *
 * @param {*} cfg User config snapshot
 * @returns {{ baseUrl: string; wsUrl: string; token: string; sessionKey: string }}
 */
function resolveGateway(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("missing_gateway_url");
  const oc = /** @type {{ gatewayBaseUrl?: string; gatewayToken?: string; sessionKey?: string }} */ (
    /** @type {any} */ (cfg).openclaw ?? {}
  );
  const baseUrl = trimTrailingSlash(oc.gatewayBaseUrl);
  if (!baseUrl) throw new Error("missing_gateway_url");
  warnIfGatewayHostMayStripScopes(baseUrl);

  let token = typeof oc.gatewayToken === "string" ? oc.gatewayToken.trim() : "";
  if (!token && looksLikeDevProfile(baseUrl)) token = tryLoadDevToken();

  const sessionKey =
    typeof oc.sessionKey === "string" && oc.sessionKey.trim().length > 0 ? oc.sessionKey.trim() : "agent:dev:dev";

  const resolved = { baseUrl, wsUrl: httpToWs(baseUrl) + "/", token, sessionKey };
  try {
    getStudioLog().verbose?.("[gateway] resolveGateway", gatewayResolvedSummary(resolved));
  } catch {
    /* ignore log serialization */
  }

  return resolved;
}

/**
 * @param {unknown} err
 */
function isStartupSidecarsUnavailable(err) {
  const code = /** @type {any} */ (err)?.code;
  const details = /** @type {any} */ (err)?.details;
  const reason = typeof details?.reason === "string" ? details.reason : "";
  return code === "UNAVAILABLE" && reason === "startup-sidecars";
}

/**
 * @param {unknown} err
 */
function retryAfterMsFromGatewayError(err) {
  const details = /** @type {any} */ (err)?.details;
  const n = Number(details?.retryAfterMs);
  return Number.isFinite(n) ? Math.min(Math.max(n, 200), 8000) : 1500;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} timeoutMessage
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** @param {*} data */
function wsMessageToString(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString("utf8");
  return String(data);
}

/**
 * @param {{ wsUrl: string; token: string; instanceId: string; onConnectionLost?: () => void }} opts
 * @param {AbortSignal} [externalSignal]
 * @returns {Promise<{
 *   request: (method: string, params?: any) => Promise<any>;
 *   onEvent: (handler: (evt: { event: string; payload: any; seq?: number }) => void) => () => void;
 *   close: (reason?: string) => void;
 *   hello: any;
 * }>}
 */
async function openGatewayClient(opts, externalSignal) {
  const ws = new WebSocket(opts.wsUrl);

  /** @type {Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>} */
  const pending = new Map();
  /** @type {Set<(evt: { event: string; payload: any; seq?: number }) => void>} */
  const listeners = new Set();

  let connectNonce = /** @type {string | null} */ (null);
  let helloPayload = /** @type {any} */ (null);
  let closed = false;
  /** True when {@link close} was called from this client (planned shutdown). */
  let userClosed = false;

  function rawSend(frame) {
    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway_disconnected");
    }
    ws.send(JSON.stringify(frame));
  }

  function rejectAllPending(err) {
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
  }

  function close(reason) {
    if (closed) return;
    userClosed = true;
    closed = true;
    try {
      ws.close(1000, reason ?? "client_close");
    } catch {
      /* ignore */
    }
    rejectAllPending(new Error("gateway_disconnected"));
  }

  /**
   * @param {string} method
   * @param {any} params
   * @returns {Promise<any>}
   */
  function request(method, params) {
    if (ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway_disconnected"));
    }
    const id = randomUUID();
    const frame = { type: "req", id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        rawSend(frame);
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** @param {(evt: { event: string; payload: any; seq?: number }) => void} handler */
  function onEvent(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  ws.on("message", (data) => {
    /** @type {any} */
    let frame;
    try {
      frame = JSON.parse(wsMessageToString(data));
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;

    if (frame.type === "event") {
      const evtName = typeof frame.event === "string" ? frame.event : "";
      if (evtName === "connect.challenge") {
        const payload = frame.payload;
        if (payload && typeof payload.nonce === "string") {
          connectNonce = payload.nonce;
        }
        return;
      }
      for (const fn of listeners) {
        try {
          fn({ event: evtName, payload: frame.payload, seq: frame.seq });
        } catch (err) {
          getStudioLog().error("[openclaw-ws] event listener threw:", /** @type {any} */ (err)?.message ?? err);
        }
      }
      return;
    }

    if (frame.type === "res" && typeof frame.id === "string") {
      const entry = pending.get(frame.id);
      if (!entry) return;
      pending.delete(frame.id);
      if (frame.error) {
        const err = new Error(
          typeof frame.error.message === "string" ? frame.error.message : "gateway_rpc_error",
        );
        /** @type {any} */ (err).code = frame.error.code;
        /** @type {any} */ (err).details = frame.error.details;
        entry.reject(err);
        return;
      }
      if (frame.ok === false) {
        const payloadObj =
          frame.payload && typeof frame.payload === "object"
            ? /** @type {Record<string, unknown>} */ (frame.payload)
            : null;
        const msg =
          (payloadObj && typeof payloadObj.message === "string" && payloadObj.message.trim()) ||
          (typeof frame.message === "string" && frame.message.trim()) ||
          "gateway_rpc_error";
        const err = new Error(msg);
        /** @type {any} */ (err).code =
          payloadObj && typeof payloadObj.code === "string" ? payloadObj.code : undefined;
        /** @type {any} */ (err).details =
          payloadObj && typeof payloadObj.details === "object" ? payloadObj.details : undefined;
        entry.reject(err);
        return;
      }
      entry.resolve(frame.payload ?? frame.result);
    }
  });

  ws.on("close", (code, reasonBuf) => {
    const reason =
      typeof reasonBuf === "string"
        ? reasonBuf
        : Buffer.isBuffer(reasonBuf) && reasonBuf.length
          ? reasonBuf.toString("utf8")
          : `code=${code}`;
    closed = true;
    if (!userClosed) {
      try {
        opts.onConnectionLost?.();
      } catch (e) {
        getStudioLog().warn("[openclaw-ws] onConnectionLost threw:", /** @type {any} */ (e)?.message ?? e);
      }
    }
    rejectAllPending(new Error(`gateway_disconnected — ${reason}`));
  });

  ws.on("error", (err) => {
    getStudioLog().verbose?.(
      "[gateway] websocket_socket_error",
      err instanceof Error ? err.message : String(err ?? ""),
    );
    /* `close` often follows with the same failure */
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    const onOpen = () => {
      if (settled) return;
      settled = true;
      ws.off("error", onErr);
      resolve();
    };
    const onErr = (err) => {
      if (settled) return;
      settled = true;
      ws.off("open", onOpen);
      const detail = err instanceof Error ? err.message : String(err ?? "websocket error");
      getStudioLog().warn("[gateway] connect_socket_failed", gatewayResolvedSummary(opts), { detail });
      reject(new Error(`gateway_unreachable — ${detail}`));
    };
    ws.once("open", onOpen);
    ws.once("error", onErr);
    if (externalSignal) {
      const onAbort = () => {
        if (settled) return;
        settled = true;
        ws.off("open", onOpen);
        ws.off("error", onErr);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new DOMException("aborted", "AbortError"));
      };
      if (externalSignal.aborted) onAbort();
      else externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  });

  await new Promise((r) => setTimeout(r, CHALLENGE_GRACE_MS));

  void connectNonce;
  const auth = opts.token ? { token: opts.token } : undefined;
  const connectParams = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: CLIENT_ID,
      version: CLIENT_VERSION,
      platform: process.platform,
      mode: CLIENT_MODE,
      instanceId: opts.instanceId,
    },
    role: OPERATOR_ROLE,
    scopes: OPERATOR_SCOPES,
    caps: ["tool-events"],
    auth,
    userAgent: `open-studio/${CLIENT_VERSION} (node ${process.versions.node})`,
    locale: "zh-CN",
  };

  for (let attempt = 0; attempt < CONNECT_SIDECAR_MAX_ATTEMPTS; attempt++) {
    if (externalSignal?.aborted) {
      close("aborted");
      throw new DOMException("aborted", "AbortError");
    }
    try {
      helloPayload = await withTimeout(
        request("connect", connectParams),
        CONNECT_HANDSHAKE_TIMEOUT_MS,
        "gateway_unreachable — connect handshake timed out",
      );
      break;
    } catch (err) {
      if (externalSignal?.aborted) {
        close("aborted threw");
        throw new DOMException("aborted", "AbortError");
      }
      if (isStartupSidecarsUnavailable(err) && attempt + 1 < CONNECT_SIDECAR_MAX_ATTEMPTS) {
        const waitMs = retryAfterMsFromGatewayError(err);
        getStudioLog().verbose?.("[gateway] startup_sidecars_unavailable_retry", {
          attempt: attempt + 1,
          waitMs,
        });
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      close("handshake failed");
      getStudioLog().error("[gateway] connect_rpc_failed", gatewayResolvedSummary(opts), {
        attempt: attempt + 1,
        message: /** @type {any} */ (err)?.message ?? String(err ?? ""),
      });
      throw err;
    }
  }

  try {
    await withTimeout(
      request("health", {}),
      POST_CONNECT_PROBE_TIMEOUT_MS,
      "gateway_unreachable — post-connect health probe timed out",
    );
  } catch (err) {
    const msg = typeof /** @type {any} */ (err)?.message === "string" ? /** @type {any} */ (err).message : String(err ?? "");
    if (msg.includes("missing scope")) {
      close("operator_scopes_denied");
      getStudioLog().error("[gateway] post_connect_denied_missing_scope", gatewayResolvedSummary(opts));
      throw new Error("gateway_missing_operator_scope");
    }
    getStudioLog().error("[gateway] post_connect_health_failed", gatewayResolvedSummary(opts), { message: msg });
    throw err;
  }

  return {
    request,
    onEvent,
    close,
    hello: helloPayload,
  };
}

module.exports = {
  resolveGateway,
  openGatewayClient,
  withTimeout,
  PROTOCOL_VERSION,
  CLIENT_ID,
  CLIENT_MODE,
  CLIENT_VERSION,
  isStartupSidecarsUnavailable,
};
