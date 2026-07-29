/**
 * Persistent gateway WebSocket for Open Studio: one connection per gateway identity,
 * shared across bootstrap, probes, and chat turns — avoids repeated handshakes and
 * lets OpenClaw amortize plugin/tool initialization.
 *
 * The shared connect handshake must NOT be tied to a caller's AbortSignal. WeChat poll /
 * prewarm use short budgets (e.g. 12s); if they owned the handshake, their abort tore
 * down the socket for chat as well and left empty assistant replies.
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

/** Aborts only the in-flight shared handshake (invalidate / generation bump). */
/** @type {AbortController | null} */
let connectGenerationAbort = null;

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isAbortError(err) {
  if (!err) return false;
  if (typeof err === "object" && /** @type {any} */ (err).name === "AbortError") return true;
  return /aborted/i.test(String(/** @type {any} */ (err)?.message ?? err ?? ""));
}

/**
 * Race a promise against the caller's abort without aborting the shared work.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal | null | undefined} signal
 * @returns {Promise<T>}
 */
function raceWithCallerAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function abortInFlightSharedConnect() {
  if (!connectGenerationAbort) return;
  try {
    connectGenerationAbort.abort();
  } catch {
    /* ignore */
  }
  connectGenerationAbort = null;
}

/**
 * Parallel gateway prep pool — different session keys hydrate concurrently; same key dedupes.
 * Urgent tasks still jump the queue head.
 */
const HYDRATE_MAX_CONCURRENT = Math.max(
  1,
  Math.min(8, Number(process.env.OPEN_STUDIO_HYDRATE_CONCURRENCY) || 4),
);

/**
 * @type {Array<{ urgent: boolean; sessionKey: string; run: () => Promise<void> }>}
 */
const hydratePrepTasks = [];

/** @type {Map<string, Promise<void>>} */
const hydratePrepInflightByKey = new Map();

let hydrateActiveCount = 0;

function pumpHydratePrepQueue() {
  while (hydrateActiveCount < HYDRATE_MAX_CONCURRENT && hydratePrepTasks.length > 0) {
    const urgentIdx = hydratePrepTasks.findIndex((t) => t.urgent);
    const idx = urgentIdx >= 0 ? urgentIdx : 0;
    const [task] = hydratePrepTasks.splice(idx, 1);
    hydrateActiveCount += 1;
    void task
      .run()
      .catch(() => {
        /* caller promise handles rejection */
      })
      .finally(() => {
        hydrateActiveCount -= 1;
        if (task.sessionKey) hydratePrepInflightByKey.delete(task.sessionKey);
        pumpHydratePrepQueue();
      });
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
 * Pay `sessions.create` + `tools.effective` for explicit gateway session keys (multi-agent prewarm).
 *
 * @param {unknown} cfg
 * @param {string[]} sessionKeys
 * @param {AbortSignal} signal
 * @param {{ urgent?: boolean }} [opts]
 */
async function prewarmGatewaySessionKeys(cfg, sessionKeys, signal, opts = {}) {
  const urgent = Boolean(opts.urgent);
  const resolved = resolveGateway(cfg);
  const client = await acquireGatewaySession(resolved, signal);
  const seenKeys = new Set();
  /** @type {Promise<void>[]} */
  const waits = [];
  for (const raw of sessionKeys) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const sessionKey = typeof raw === "string" ? raw.trim() : "";
    if (!sessionKey || seenKeys.has(sessionKey)) continue;
    seenKeys.add(sessionKey);
    if (isGatewaySessionPrepReady(sessionKey)) continue;
    waits.push(
      enqueueHydrateChatPrep(
        async () => {
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
        },
        { urgent, sessionKey },
      ),
    );
  }
  await Promise.allSettled(waits);
}

/**
 * Best-effort: run `sessions.create` + `tools.effective` for saved conversation ids so the first
 * `chat.send` does not pay cold tool materialization. Different session keys prep in parallel.
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
    }, { urgent, sessionKey });
  }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ urgent?: boolean; sessionKey?: string }} [opts]
 * @returns {Promise<T>}
 */
function enqueueHydrateChatPrep(fn, opts = {}) {
  const urgent = Boolean(opts.urgent);
  const sessionKey = typeof opts.sessionKey === "string" ? opts.sessionKey.trim() : "";
  if (sessionKey) {
    const inflight = hydratePrepInflightByKey.get(sessionKey);
    if (inflight) return /** @type {Promise<T>} */ (inflight);
  }
  /** @type {Promise<T>} */
  let promise;
  promise = new Promise((resolve, reject) => {
    hydratePrepTasks.push({
      urgent,
      sessionKey,
      run: async () => {
        try {
          const v = await fn();
          resolve(v);
        } catch (e) {
          reject(e);
        }
      },
    });
    pumpHydratePrepQueue();
  });
  if (sessionKey) hydratePrepInflightByKey.set(sessionKey, /** @type {Promise<void>} */ (promise));
  return promise;
}

function invalidateGatewaySession() {
  abortInFlightSharedConnect();
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
 * @param {string} key
 */
function startSharedConnect(resolved, key) {
  if (active && active.key !== key) {
    invalidateGatewaySession();
  }
  const gen = new AbortController();
  connectGenerationAbort = gen;
  return (async () => {
    try {
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
        gen.signal,
      );
      clientRef.current = client;
      wrapGatewayClientWithBackpressure(client);
      active = { key, client };
    } finally {
      if (connectGenerationAbort === gen) connectGenerationAbort = null;
    }
  })();
}

/**
 * @param {{ baseUrl: string; wsUrl: string; token: string; sessionKey: string }} resolved
 * @param {AbortSignal} signal
 */
async function acquireGatewaySession(resolved, signal) {
  const key = gatewayIdentityKey(resolved);
  const maxAttempts = 3;
  /** @type {unknown} */
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    if (active && active.key === key && active.client) {
      return active.client;
    }

    if (connectChain) {
      try {
        await raceWithCallerAbort(connectChain, signal);
      } catch (e) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        lastErr = e;
      }
      if (active && active.key === key && active.client) {
        return active.client;
      }
      if (connectChain) continue;
      if (attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
    }

    if (active && active.key === key && active.client) {
      return active.client;
    }

    if (!connectChain) {
      connectChain = startSharedConnect(resolved, key).finally(() => {
        connectChain = null;
      });
    }

    try {
      await raceWithCallerAbort(connectChain, signal);
    } catch (e) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      lastErr = e;
      getStudioLog().error("[gateway_session] acquire_failed", {
        message: /** @type {any} */ (e)?.message ?? String(e ?? ""),
        attempt: attempt + 1,
        sharedAbort: isAbortError(e),
      });
      if (attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
      throw e;
    }

    if (active && active.key === key && active.client) {
      return active.client;
    }
  }

  getStudioLog().error("[gateway_session] unavailable_after_chain");
  throw lastErr instanceof Error ? lastErr : new Error("gateway_session_unavailable");
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
  const resolved = resolveGateway(cfg);
  return enqueueHydrateChatPrep(
    async () => {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      onProgress?.({ phase: "tools_catalog" });
      await client.request("tools.catalog", { includePlugins: true });
      onProgress?.({ phase: "session_ensure" });
      await client.request("sessions.create", { key: resolved.sessionKey });
      onProgress?.({ phase: "tools_effective" });
      await client.request("tools.effective", { sessionKey: resolved.sessionKey });
      markGatewaySessionPrepReady(resolved.sessionKey);
    },
    { sessionKey: resolved.sessionKey },
  );
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
  prewarmGatewaySessionKeys,
  enqueueHydrateChatPrep,
  raceWithCallerAbort,
  isAbortError,
  /** @internal Test helper: reset module singletons between unit tests. */
  __resetGatewaySessionForTests() {
    abortInFlightSharedConnect();
    active = null;
    connectChain = null;
    clearGatewaySessionPrepCache();
    hydratePrepTasks.length = 0;
    hydratePrepInflightByKey.clear();
    hydrateActiveCount = 0;
  },
};
