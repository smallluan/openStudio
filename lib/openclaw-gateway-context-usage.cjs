const { resolveGateway } = require("./openclaw-gateway-ws.cjs");
const { acquireGatewaySession } = require("./openclaw-gateway-session.cjs");

/**
 * @param {unknown} sessionRow
 * @returns {{
 *   usedTokens: number;
 *   contextWindow: number;
 *   frac: number;
 *   inputTokens?: number;
 *   outputTokens?: number;
 *   compactionCount?: number;
 * } | null}
 */
function normalizeGatewaySessionContextUsage(sessionRow) {
  if (!sessionRow || typeof sessionRow !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (sessionRow);
  const contextWindow = Number(row.contextTokens);
  const usedTokens = Number(row.totalTokens);
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  if (!Number.isFinite(usedTokens) || usedTokens < 0) return null;

  const inputTokens = Number(row.inputTokens);
  const outputTokens = Number(row.outputTokens);
  const compactionCount = Number(row.compactionCheckpointCount ?? row.compactionCount);

  return {
    usedTokens: Math.round(usedTokens),
    contextWindow: Math.round(contextWindow),
    frac: usedTokens / contextWindow,
    ...(Number.isFinite(inputTokens) && inputTokens >= 0 ? { inputTokens: Math.round(inputTokens) } : {}),
    ...(Number.isFinite(outputTokens) && outputTokens >= 0 ? { outputTokens: Math.round(outputTokens) } : {}),
    ...(Number.isFinite(compactionCount) && compactionCount >= 0
      ? { compactionCount: Math.round(compactionCount) }
      : {}),
  };
}

/**
 * Authoritative session context usage from the OpenClaw gateway (same source as session_status).
 *
 * @param {unknown} cfg
 * @param {string} sessionKey
 * @param {AbortSignal} signal
 */
async function fetchGatewaySessionContextUsage(cfg, sessionKey, signal) {
  const key = String(sessionKey ?? "").trim();
  if (!key) return null;

  const resolved = resolveGateway(cfg);
  const client = await acquireGatewaySession(resolved, signal);
  const payload = await client.request("sessions.describe", {
    key,
    includeDerivedTitles: false,
    includeLastMessage: false,
  });
  const session = payload && typeof payload === "object" ? /** @type {any} */ (payload).session : null;
  return normalizeGatewaySessionContextUsage(session);
}

module.exports = {
  fetchGatewaySessionContextUsage,
  normalizeGatewaySessionContextUsage,
};
