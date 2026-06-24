const fs = require("fs");
const path = require("path");
const { normalizeUsageShape, sumUsage } = require("./token-usage-extract.cjs");
const {
  resolveOpenClawStateDir,
  parseAgentIdFromSessionKey,
} = require("./sync-openclaw-agent-from-studio.cjs");

/** @param {string} stateDir @param {string} agentId */
function readSessionsIndex(stateDir, agentId) {
  const fp = path.join(stateDir, "agents", agentId, "sessions", "sessions.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} stateDir
 * @param {string} agentId
 * @param {string} sessionKey
 */
function resolveSessionFilePath(stateDir, agentId, sessionKey) {
  const index = readSessionsIndex(stateDir, agentId);
  const entry = index[sessionKey];
  if (entry && typeof entry === "object") {
    const file = /** @type {{ sessionFile?: unknown }} */ (entry).sessionFile;
    if (typeof file === "string" && file.trim()) return file.trim();
  }
  return "";
}

/**
 * @param {string} sessionFile
 * @param {number} startedAtMs
 */
function sumAssistantUsageSince(sessionFile, startedAtMs) {
  let text = "";
  try {
    text = fs.readFileSync(sessionFile, "utf8");
  } catch {
    return null;
  }

  /** @type {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} */
  let total = null;
  const graceMs = 4000;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    /** @type {*} */
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (row?.type !== "message" || !row.message || typeof row.message !== "object") continue;
    const msg = row.message;
    if (msg.role !== "assistant" || !msg.usage) continue;

    const ts =
      typeof msg.timestamp === "number" && Number.isFinite(msg.timestamp)
        ? msg.timestamp
        : Date.parse(String(row.timestamp ?? ""));
    if (Number.isFinite(ts) && ts < startedAtMs - graceMs) continue;

    const norm = normalizeUsageShape(msg.usage);
    if (norm) total = sumUsage(total, norm);
  }

  return total;
}

/**
 * Read authoritative usage for a gateway chat turn from OpenClaw session transcripts.
 *
 * @param {{ gatewayBaseUrl: string; sessionKey: string; startedAtMs: number }} opts
 * @returns {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null}
 */
function readSessionUsageSince(opts) {
  const sessionKey = String(opts.sessionKey ?? "").trim();
  const startedAtMs = Number(opts.startedAtMs);
  if (!sessionKey || !Number.isFinite(startedAtMs)) return null;

  const baseKey = sessionKey.split("#studio:")[0] ?? sessionKey;
  const agentId = parseAgentIdFromSessionKey(baseKey);
  const stateDir = resolveOpenClawStateDir(String(opts.gatewayBaseUrl ?? ""));
  const sessionFile = resolveSessionFilePath(stateDir, agentId, sessionKey);
  if (!sessionFile) return null;
  return sumAssistantUsageSince(sessionFile, startedAtMs);
}

/**
 * Transcript rows may land slightly after chat.final — retry briefly.
 *
 * @param {{ gatewayBaseUrl: string; sessionKey: string; startedAtMs: number }} opts
 */
async function readSessionUsageSinceWithRetry(opts) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const usage = readSessionUsageSince(opts);
    if (usage) return usage;
    await new Promise((resolve) => setTimeout(resolve, 60 + attempt * 40));
  }
  return null;
}

module.exports = {
  readSessionUsageSince,
  readSessionUsageSinceWithRetry,
};
