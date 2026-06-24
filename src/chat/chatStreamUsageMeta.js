/**
 * Metadata forwarded to the main process for per-turn token usage accounting.
 * @param {{
 *   conversationTitle?: string;
 *   assistantMessageId?: string;
 *   userMessageId?: string;
 *   userContentPreview?: string;
 *   agentId?: string;
 * }} fields
 */
export function buildStreamUsageMeta(fields) {
  return {
    conversationTitle: String(fields.conversationTitle ?? "").trim().slice(0, 160),
    assistantMessageId: String(fields.assistantMessageId ?? "").trim(),
    userMessageId: String(fields.userMessageId ?? "").trim(),
    userContentPreview: String(fields.userContentPreview ?? "").trim().slice(0, 240),
    agentId: String(fields.agentId ?? "").trim(),
  };
}

/** @param {number} n */
export function formatTokenCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(v));
}

/** @param {number} ts */
export function formatUsageTimestamp(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
