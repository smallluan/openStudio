/**
 * Serialize and dedupe gateway chat.history RPC calls.
 */

const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

function isHistoryBackpressureEnabled(env = process.env) {
  const raw = env.OPEN_STUDIO_HISTORY_RPC_BACKPRESSURE;
  if (raw === undefined) return true;
  return !DISABLED_VALUES.has(String(raw).trim().toLowerCase());
}

function normalizeHistoryIdentityValue(value) {
  if (value === undefined) return "<undefined>";
  if (value === null) return "<null>";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function getHistoryBackpressureKey(params, timeoutMs) {
  const input =
    params && typeof params === "object" && !Array.isArray(params) ? /** @type {Record<string, unknown>} */ (params) : {};
  const cursor = input.cursor ?? input.offset;
  return [
    normalizeHistoryIdentityValue(input.sessionKey),
    normalizeHistoryIdentityValue(input.limit),
    normalizeHistoryIdentityValue(cursor),
    normalizeHistoryIdentityValue(timeoutMs),
  ].join("\u001f");
}

class ChatHistoryRpcBackpressure {
  constructor(options = {}) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 1));
    this.activeCount = 0;
    /** @type {Array<{ key: string; run: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }>} */
    this.queue = [];
    /** @type {Map<string, Promise<unknown>>} */
    this.pendingByKey = new Map();
    this.env = options.env ?? process.env;
  }

  /**
   * @template T
   * @param {string} method
   * @param {unknown} params
   * @param {number | undefined} timeoutMs
   * @param {(method: string, params?: unknown) => Promise<T>} rpc
   * @returns {Promise<T>}
   */
  run(method, params, timeoutMs, rpc) {
    if (method !== "chat.history" || !isHistoryBackpressureEnabled(this.env)) {
      return rpc(method, params);
    }

    const key = getHistoryBackpressureKey(params, timeoutMs);
    const pending = this.pendingByKey.get(key);
    if (pending) return /** @type {Promise<T>} */ (pending);

    const promise = new Promise((resolve, reject) => {
      this.queue.push({
        key,
        run: () => rpc(method, params),
        resolve,
        reject,
      });
      this.drain();
    });

    this.pendingByKey.set(key, promise);
    promise.finally(() => {
      if (this.pendingByKey.get(key) === promise) this.pendingByKey.delete(key);
    });
    return /** @type {Promise<T>} */ (promise);
  }

  drain() {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.activeCount += 1;
      task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}

const sharedHistoryBackpressure = new ChatHistoryRpcBackpressure();

/**
 * Wrap a gateway client's `request` method with chat.history backpressure.
 * @param {{ request: (method: string, params?: unknown) => Promise<unknown> }} client
 */
function wrapGatewayClientWithBackpressure(client) {
  const original = client.request.bind(client);
  client.request = (method, params) => sharedHistoryBackpressure.run(method, params, undefined, original);
  return client;
}

module.exports = {
  ChatHistoryRpcBackpressure,
  wrapGatewayClientWithBackpressure,
};
