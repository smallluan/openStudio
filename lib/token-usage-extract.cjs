/** Extract normalized token usage objects from gateway / LLM payloads. */

/** @param {unknown} value */
function toNonNegInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

/**
 * Map OpenClaw / OpenAI / Anthropic / Gemini usage blobs to a common shape.
 * OpenClaw session transcripts use `{ input, output, cacheRead, totalTokens, ... }`.
 *
 * @param {unknown} raw
 * @returns {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null}
 */
function normalizeUsageShape(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);

  const inputCore =
    toNonNegInt(o.input) ??
    toNonNegInt(o.input_tokens) ??
    toNonNegInt(o.inputTokens) ??
    toNonNegInt(o.prompt_tokens) ??
    toNonNegInt(o.promptTokens) ??
    toNonNegInt(o.promptTokenCount);

  const cacheRead =
    toNonNegInt(o.cacheRead) ??
    toNonNegInt(o.cache_read) ??
    toNonNegInt(o.cache_read_input_tokens) ??
    toNonNegInt(o.cached_tokens);

  const cacheWrite =
    toNonNegInt(o.cacheWrite) ??
    toNonNegInt(o.cache_write) ??
    toNonNegInt(o.cache_creation_input_tokens);

  const outputCore =
    toNonNegInt(o.output) ??
    toNonNegInt(o.output_tokens) ??
    toNonNegInt(o.outputTokens) ??
    toNonNegInt(o.completion_tokens) ??
    toNonNegInt(o.completionTokens) ??
    toNonNegInt(o.candidatesTokenCount);

  const reasoningTokens =
    toNonNegInt(o.reasoningTokens) ?? toNonNegInt(o.reasoning_tokens);

  let inputTokens = inputCore;
  if (inputTokens != null) {
    inputTokens += (cacheRead ?? 0) + (cacheWrite ?? 0);
  } else if (cacheRead != null || cacheWrite != null) {
    inputTokens = (cacheRead ?? 0) + (cacheWrite ?? 0);
  }

  let outputTokens = outputCore;
  if (outputTokens != null && reasoningTokens != null) {
    outputTokens += reasoningTokens;
  } else if (outputTokens == null && reasoningTokens != null) {
    outputTokens = reasoningTokens;
  }

  let totalTokens =
    toNonNegInt(o.totalTokens) ??
    toNonNegInt(o.total_tokens) ??
    toNonNegInt(o.total) ??
    toNonNegInt(o.totalTokenCount);

  if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  if (inputTokens == null && outputTokens == null && totalTokens == null) return null;
  return {
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    ...(totalTokens != null ? { totalTokens } : {}),
  };
}

/**
 * @param {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} a
 * @param {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} b
 */
function mergeUsage(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const pick = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
  const inputTokens = pick(a.inputTokens, b.inputTokens);
  const outputTokens = pick(a.outputTokens, b.outputTokens);
  let totalTokens = pick(a.totalTokens, b.totalTokens);
  if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  return {
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    ...(totalTokens != null ? { totalTokens } : {}),
  };
}

/**
 * Sum usage across multiple LLM calls in one chat turn (tool loops).
 * @param {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} a
 * @param {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} b
 */
function sumUsage(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const inputTokens = (a.inputTokens ?? 0) + (b.inputTokens ?? 0);
  const outputTokens = (a.outputTokens ?? 0) + (b.outputTokens ?? 0);
  let totalTokens = (a.totalTokens ?? 0) + (b.totalTokens ?? 0);
  if (totalTokens === 0) totalTokens = inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

const USAGE_KEYS = new Set(["usage", "usageMetadata", "tokenUsage", "tokens"]);

/**
 * Prefer explicit assistant message usage on chat.final payloads.
 * @param {unknown} payload
 */
function extractUsageFromChatPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = /** @type {Record<string, unknown>} */ (payload);
  const message = p.message;
  if (message && typeof message === "object") {
    const msg = /** @type {Record<string, unknown>} */ (message);
    if (msg.usage) {
      const fromMessage = normalizeUsageShape(msg.usage);
      if (fromMessage) return fromMessage;
    }
  }
  return extractUsageFromPayload(payload);
}

/**
 * Breadth-first scan for usage-like objects on chat / agent payloads.
 * @param {unknown} root
 * @param {number} [maxDepth]
 * @returns {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null}
 */
function extractUsageFromPayload(root, maxDepth = 6) {
  if (!root || typeof root !== "object") return null;

  /** @type {Array<{ node: unknown; depth: number }>} */
  const queue = [{ node: root, depth: 0 }];
  /** @type {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} */
  let best = null;

  while (queue.length) {
    const item = queue.shift();
    if (!item) continue;
    const { node, depth } = item;
    if (!node || typeof node !== "object" || depth > maxDepth) continue;

    if (Array.isArray(node)) {
      for (const child of node) {
        if (child && typeof child === "object") queue.push({ node: child, depth: depth + 1 });
      }
      continue;
    }

    const o = /** @type {Record<string, unknown>} */ (node);
    for (const [key, val] of Object.entries(o)) {
      if (USAGE_KEYS.has(key) || /usage$/i.test(key)) {
        const norm = normalizeUsageShape(val);
        if (norm) best = mergeUsage(best, norm);
      }
      if (val && typeof val === "object" && depth < maxDepth) {
        queue.push({ node: val, depth: depth + 1 });
      }
    }
  }

  return best;
}

module.exports = {
  normalizeUsageShape,
  extractUsageFromChatPayload,
  extractUsageFromPayload,
  mergeUsage,
  sumUsage,
};
