/**
 * Persistent gateway WebSocket for Open Studio: one connection per gateway identity,
 * shared across bootstrap, probes, and chat turns — avoids repeated handshakes and
 * lets OpenClaw amortize plugin/tool initialization.
 */

const { randomUUID } = require("crypto");
const { resolveGateway, openGatewayClient } = require("./openclaw-gateway-ws.cjs");

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

/** Serialize `tools.catalog` → `sessions.create` → `tools.effective` across bootstrap, warm IPC, and pre-chat. Concurrent hydrates stall the same gateway thread; overlapping calls produced stacked catalogs / long `sessions.create` in logs. */
let hydrateChatPrepQueue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function enqueueHydrateChatPrep(fn) {
  const run = hydrateChatPrepQueue.then(() => fn());
  hydrateChatPrepQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function invalidateGatewaySession() {
  if (active?.client) {
    try {
      active.client.close("session_invalidate");
    } catch {
      /* ignore */
    }
  }
  active = null;
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
        },
      },
      signal,
    );
    clientRef.current = client;
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
  await connectChain;
  if (!active?.client) {
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
  });
}

/**
 * @param {unknown} cfg
 * @param {AbortSignal} signal
 * @param {(detail: { phase: string; [k: string]: unknown }) => void} [onProgress]
 */
async function runGatewayBootstrapReadiness(cfg, signal, onProgress) {
  const resolved = resolveGateway(cfg);
  onProgress?.({ phase: "gateway_connect" });
  const client = await acquireGatewaySession(resolved, signal);
  await hydrateGatewayChatPrep(client, cfg, signal, onProgress);
  onProgress?.({ phase: "gateway_ready" });
}

module.exports = {
  gatewayIdentityKey,
  acquireGatewaySession,
  invalidateGatewaySession,
  hydrateGatewayToolSurface,
  hydrateGatewayChatPrep,
  runGatewayBootstrapReadiness,
};
