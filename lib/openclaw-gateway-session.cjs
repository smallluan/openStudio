/**
 * Persistent gateway WebSocket for Open Studio: one connection per gateway identity,
 * shared across bootstrap, probes, and chat turns — avoids repeated handshakes and
 * lets OpenClaw amortize plugin/tool initialization.
 */

const { randomUUID } = require("crypto");
const { resolveGateway, openGatewayClient } = require("./openclaw-gateway-ws.cjs");
const { getStudioLog } = require("./studio-logger.cjs");
const { wrapGatewayClientWithBackpressure } = require("./openclaw-gateway-rpc-backpressure.cjs");

/**
 * @param {{ wsUrl: string; token: string; sessionKey: string }} resolved
 */
function gatewayIdentityKey(resolved) {
  return `${resolved.wsUrl}\n${resolved.token}\n${resolved.sessionKey}`;
}

/** @type {{ key: string; client: Awaited<ReturnType<typeof openGatewayClient>> } | null} */
let active = null;

/** @type {Promise<void> | null} */
let connectChain = null;

/**
 * Serialize gateway prep RPCs (same WS / single-threaded gateway). Urgent tasks run before
 * background prewarm so a new-thread first message does not queue behind stale sessions.
 *
 * @type {Array<{ urgent: boolean; run: () => Promise<void> }>}
 */
const hydratePrepTasks = [];

/** @type {Promise<void> | null} */
let hydratePrepDrain = null;

async function drainHydratePrepTasks() {
  try {
    for (;;) {
      if (hydratePrepTasks.length === 0) break;
      const urgentIdx = hydratePrepTasks.findIndex((t) => t.urgent);
      const idx = urgentIdx >= 0 ? urgentIdx : 0;
      const [task] = hydratePrepTasks.splice(idx, 1);
      await task.run();
    }
  } finally {
    hydratePrepDrain = null;
    if (hydratePrepTasks.length > 0) {
      hydratePrepDrain = drainHydratePrepTasks();
    }
  }
}

/**
 * Studio process-local: gateway session keys that already paid `sessions.create` +
 * `tools.effective` on this WebSocket generation. Without this, every chat turn repeated
 * `sessions.create` (sometimes queued for minutes behind other RPCs).
 * Cleared when the client disconnects or the pool is invalidated.
 */
const gatewaySessionPrepReady = new Set();

function clearGatewaySessionPrepCache() {
  gatewaySessionPrepReady.clear();
}

function markGatewaySessionPrepReady(sessionKey) {
  if (typeof sessionKey === "string" && sessionKey.trim()) gatewaySessionPrepReady.add(sessionKey);
}

function isGatewaySessionPrepReady(sessionKey) {
  return typeof sessionKey === "string" && sessionKey.trim() && gatewaySessionPrepReady.has(sessionKey);
}

/**
 * UI threads use `wechat:<peerId>`; gateway session keys must not embed a raw `wechat:`
 * segment — OpenClaw treats it as channel routing and the run can stall with zero tokens.
 * @param {string} conversationId
 */
function normalizeStudioConversationIdForGateway(conversationId) {
  const cid = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!cid) return "";
  if (cid.startsWith("wechat:")) return `wx_${cid.slice("wechat:".length)}`;
  return cid;
}

/**
 * @param {string} conversationId
 */
function sanitizeConversationIdSegment(conversationId) {
  const normalized = normalizeStudioConversationIdForGateway(conversationId);
  if (!normalized) return "";
  return normalized
    .replace(/#/g, "")
    .replace(/\s+/g, "")
    .replace(/@/g, "_at_")
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 96);
}

/**
 * Gateway chat memory is keyed per Studio thread: `<configured sessionKey>#studio:<conversationId>`.
 * @param {string} baseSessionKey
 * @param {string} conversationId
 */
function resolveStudioGatewaySessionKey(baseSessionKey, conversationId) {
  const safe = sanitizeConversationIdSegment(conversationId);
  if (!safe) return baseSessionKey;
  return `${baseSessionKey}#studio:${safe}`;
}

/**
 * Best-effort: run `sessions.create` + `tools.effective` for saved conversation ids so the first
 * `chat.send` does not pay cold tool materialization. Work is serialized with other hydrate RPCs.
 *
 * @param {unknown} cfg
 * @param {string[]} conversationIds
 * @param {AbortSignal} signal
 * @param {{ urgentFirst?: boolean }} [opts] When true, the first session that actually enqueues work is urgent.
 */
async function prewarmStudioGatewaySessions(cfg, conversationIds, signal, opts = {}) {
  const urgentFirst = Boolean(opts.urgentFirst);
  let spendUrgentOnNext = urgentFirst;
  const resolved = resolveGateway(cfg);
  const client = await acquireGatewaySession(resolved, signal);
  const base = resolved.sessionKey;
  const seenKeys = new Set();
  for (const raw of conversationIds) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (typeof raw !== "string" || !raw.trim()) continue;
    const sessionKey = resolveStudioGatewaySessionKey(base, raw);
    if (seenKeys.has(sessionKey)) continue;
    seenKeys.add(sessionKey);
    if (sessionKey === base) continue;
    if (isGatewaySessionPrepReady(sessionKey)) continue;
    const urgent = spendUrgentOnNext;
    spendUrgentOnNext = false;
    await enqueueHydrateChatPrep(async () => {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      if (isGatewaySessionPrepReady(sessionKey)) return;
      try {
        await client.request("sessions.create", { key: sessionKey });
      } catch {
        /* session may already exist */
      }
      try {
        await client.request("tools.effective", { sessionKey });
      } catch {
        /* best-effort */
      }
      markGatewaySessionPrepReady(sessionKey);
    }, { urgent });
  }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ urgent?: boolean }} [opts]
 * @returns {Promise<T>}
 */
function enqueueHydrateChatPrep(fn, opts = {}) {
  const urgent = Boolean(opts.urgent);
  return new Promise((resolve, reject) => {
    hydratePrepTasks.push({
      urgent,
      run: async () => {
        try {
          const v = await fn();
          resolve(v);
        } catch (e) {
          reject(e);
        }
      },
    });
    hydratePrepDrain ??= drainHydratePrepTasks();
  });
}

function invalidateGatewaySession() {
  if (active?.client) {
    getStudioLog().info("[gateway_session] invalidate (closing active websocket client)");
    try {
      active.client.close("session_invalidate");
    } catch {
      /* ignore */
    }
  }
  active = null;
  clearGatewaySessionPrepCache();
}

/**
 * @param {{ baseUrl: string; wsUrl: string; token: string; sessionKey: string }} resolved
 * @param {AbortSignal} signal
 */
async function acquireGatewaySession(resolved, signal) {
  const key = gatewayIdentityKey(resolved);
  if (active && active.key === key && active.client) {
    return active.client;
  }

  const run = async () => {
    if (active && active.key !== key) {
      invalidateGatewaySession();
    }
    const instanceId = randomUUID();
    /** Mutable ref so `onConnectionLost` never touches `client` in the TDZ (close during connect). */
    const clientRef = { current: /** @type {Awaited<ReturnType<typeof openGatewayClient>> | null} */ (null) };
    const client = await openGatewayClient(
      {
        wsUrl: resolved.wsUrl,
        token: resolved.token,
        instanceId,
        onConnectionLost: () => {
          const c = clientRef.current;
          if (c && active?.client === c) {
            active = null;
          }
          clearGatewaySessionPrepCache();
        },
      },
      signal,
    );
    clientRef.current = client;
    wrapGatewayClientWithBackpressure(client);
    active = { key, client };
  };

  if (connectChain) {
    await connectChain;
    if (active && gatewayIdentityKey(resolved) === active.key && active.client) {
      return active.client;
    }
  }

  connectChain = run().finally(() => {
    connectChain = null;
  });
  try {
    await connectChain;
  } catch (e) {
    getStudioLog().error("[gateway_session] acquire_failed", {
      message: /** @type {any} */ (e)?.message ?? String(e ?? ""),
    });
    throw e;
  }
  if (!active?.client) {
    getStudioLog().error("[gateway_session] unavailable_after_chain");
    throw new Error("gateway_session_unavailable");
  }
  return active.client;
}

/**
 * OpenClaw exposes `tools.catalog`, which enumerates core + plugin tool groups by
 * loading the plugin registry — **no LLM call, no provider billing**. This is the
 * supported way to pay plugin/tool staging cost up front.
 *
 * @param {Awaited<ReturnType<typeof openGatewayClient>>} client
 * @param {AbortSignal} signal
 */
async function hydrateGatewayToolSurface(client, signal) {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  await client.request("tools.catalog", { includePlugins: true });
}

/**
 * Pay the same "live coding tools" cost as the first `chat.send` during bootstrap:
 * `tools.catalog` is only a static listing; OpenClaw builds real tool handles in
 * `tools.effective` via `createOpenClawCodingTools` (see openclaw dist).
 *
 * @param {Awaited<ReturnType<typeof openGatewayClient>>} client
 * @param {unknown} cfg
 * @param {AbortSignal} signal
 * @param {(detail: { phase: string; [k: string]: unknown }) => void} [onProgress]
 */
async function hydrateGatewayChatPrep(client, cfg, signal, onProgress) {
  return enqueueHydrateChatPrep(async () => {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const resolved = resolveGateway(cfg);
    onProgress?.({ phase: "tools_catalog" });
    await client.request("tools.catalog", { includePlugins: true });
    onProgress?.({ phase: "session_ensure" });
    await client.request("sessions.create", { key: resolved.sessionKey });
    onProgress?.({ phase: "tools_effective" });
    await client.request("tools.effective", { sessionKey: resolved.sessionKey });
    markGatewaySessionPrepReady(resolved.sessionKey);
  });
}

/**
 * @param {unknown} err
 */
function isRetriableGatewayBootstrapError(err) {
  const msg = String(/** @type {any} */ (err)?.message ?? err ?? "");
  return /gateway_unreachable|ECONNREFUSED|startup.sidecars|startup-sidecars/i.test(msg);
}

/**
 * @param {unknown} cfg
 * @param {AbortSignal} signal
 * @param {(detail: { phase: string; [k: string]: unknown }) => void} [onProgress]
 */
async function runGatewayBootstrapReadiness(cfg, signal, onProgress) {
  const resolved = resolveGateway(cfg);
  onProgress?.({ phase: "gateway_connect" });

  const deadline = Date.now() + 120_000;
  let attempt = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      await acquireGatewaySession(resolved, signal);
      onProgress?.({ phase: "gateway_ready" });
      return;
    } catch (err) {
      if (!isRetriableGatewayBootstrapError(err) || Date.now() >= deadline) throw err;
      attempt += 1;
      invalidateGatewaySession();
      const waitMs = Math.min(2000, 300 + attempt * 250);
      getStudioLog().verbose?.("[gateway] bootstrap_connect_retry", {
        attempt,
        waitMs,
        message: String(/** @type {any} */ (err)?.message ?? err ?? ""),
      });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

module.exports = {
  gatewayIdentityKey,
  acquireGatewaySession,
  invalidateGatewaySession,
  hydrateGatewayToolSurface,
  hydrateGatewayChatPrep,
  runGatewayBootstrapReadiness,
  markGatewaySessionPrepReady,
  isGatewaySessionPrepReady,
  clearGatewaySessionPrepCache,
  resolveStudioGatewaySessionKey,
  normalizeStudioConversationIdForGateway,
  sanitizeConversationIdSegment,
  prewarmStudioGatewaySessions,
  enqueueHydrateChatPrep,
};
