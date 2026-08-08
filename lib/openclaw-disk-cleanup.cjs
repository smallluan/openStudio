/**
 * Purge OpenClaw on-disk agent + gateway session data when Studio deletes agents or chats.
 */

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { resolveOpenClawStateDir } = require("./openclaw-runtime-profile.cjs");
const { resolveGateway } = require("./openclaw-gateway-ws.cjs");
const { acquireGatewaySession, resolveStudioGatewaySessionKey, sanitizeConversationIdSegment } = require("./openclaw-gateway-session.cjs");
const { getStudioLog } = require("./studio-logger.cjs");

function normalizeAgentId(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "main";
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "").slice(0, 64) || "main";
}

/** @param {string} gatewayAgentId */
function sessionKeyForGatewayAgentId(gatewayAgentId) {
  const id = normalizeAgentId(gatewayAgentId);
  if (id === "dev") return "agent:dev:dev";
  return `agent:${id}:main`;
}

/** @param {string} stateDir */
function readGatewayAgentIds(stateDir) {
  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = normalizeAgentId(/** @type {{ id?: unknown }} */ (entry).id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {unknown} sessionMeta Chat session row from chat-sessions-store (id, channel, gatewayConversationId, …).
 * @returns {string[]}
 */
function resolveConversationIdsForCleanup(sessionMeta) {
  const row = sessionMeta && typeof sessionMeta === "object" ? sessionMeta : {};
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const gatewayConversationId =
    typeof row.gatewayConversationId === "string" ? row.gatewayConversationId.trim() : "";
  /** @type {Set<string>} */
  const ids = new Set();
  if (gatewayConversationId) ids.add(gatewayConversationId);
  if (id) ids.add(id);
  return [...ids].filter(Boolean);
}

/**
 * @param {string} stateDir
 * @param {string[]} conversationIds
 * @returns {string[]}
 */
function collectStudioGatewaySessionKeys(stateDir, conversationIds) {
  const agentIds = readGatewayAgentIds(stateDir);
  /** @type {Set<string>} */
  const keys = new Set();
  for (const agentId of agentIds) {
    const base = sessionKeyForGatewayAgentId(agentId);
    for (const conversationId of conversationIds) {
      const key = resolveStudioGatewaySessionKey(base, conversationId);
      if (key && key !== base) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * @param {unknown} cfg
 * @param {string[]} sessionKeys
 * @param {AbortSignal} [signal]
 */
async function deleteGatewaySessionsByKeys(cfg, sessionKeys, signal) {
  const keys = [...new Set(sessionKeys.map((k) => String(k ?? "").trim()).filter(Boolean))];
  if (!keys.length) return { deleted: 0, errors: 0 };

  const resolved = resolveGateway(cfg);
  const client = await acquireGatewaySession(resolved, signal);
  let deleted = 0;
  let errors = 0;
  for (const key of keys) {
    if (signal?.aborted) break;
    try {
      const payload = await client.request("sessions.delete", {
        key,
        deleteTranscript: true,
        emitLifecycleHooks: false,
      });
      if (payload && typeof payload === "object" && /** @type {{ deleted?: boolean }} */ (payload).deleted) {
        deleted += 1;
      }
    } catch (err) {
      errors += 1;
      getStudioLog().warn("[openclaw-disk-cleanup] sessions.delete failed", {
        key,
        error: String(/** @type {any} */ (err)?.message ?? err),
      });
    }
  }
  return { deleted, errors };
}

/**
 * @param {string} sqlitePath
 * @param {string} storePath
 * @param {string[]} conversationIds
 */
function purgeStudioConversationsFromAgentSqlite(sqlitePath, storePath, conversationIds) {
  if (!fs.existsSync(sqlitePath)) return 0;
  const normalizedStorePath = path.resolve(storePath);
  const segments = conversationIds.map((id) => sanitizeConversationIdSegment(id)).filter(Boolean);
  if (!segments.length) return 0;

  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
  } catch {
    /* ignore */
  }

  db.exec("BEGIN IMMEDIATE");
  let removed = 0;
  try {
    for (const segment of segments) {
      const needle = `#studio:${segment}`;
      const rows = db
        .prepare(
          "SELECT session_key, entry_json FROM session_store_entries WHERE store_path = ? AND session_key LIKE ?",
        )
        .all(normalizedStorePath, `%${needle}%`);
      for (const row of rows) {
        let sessionFile = "";
        try {
          const parsed = JSON.parse(String(row.entry_json ?? ""));
          if (parsed && typeof parsed === "object" && typeof parsed.sessionFile === "string") {
            sessionFile = path.resolve(parsed.sessionFile.trim());
          }
        } catch {
          /* ignore */
        }
        if (sessionFile) {
          db.prepare(
            "DELETE FROM session_transcripts WHERE store_path = ? AND transcript_path = ?",
          ).run(normalizedStorePath, sessionFile);
        }
        db.prepare("DELETE FROM session_store_entries WHERE store_path = ? AND session_key = ?").run(
          normalizedStorePath,
          row.session_key,
        );
        removed += 1;
      }
    }
    if (removed > 0) {
      db.prepare(
        "UPDATE session_store_meta SET revision = revision + 1 WHERE store_path = ?",
      ).run(normalizedStorePath);
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/**
 * @param {string} stateDir
 * @param {string[]} conversationIds
 */
function purgeStudioConversationsFromDiskSqlite(stateDir, conversationIds) {
  const agentsRoot = path.join(stateDir, "agents");
  if (!fs.existsSync(agentsRoot)) return { agents: 0, entries: 0 };

  let agentsTouched = 0;
  let entriesRemoved = 0;
  for (const name of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const sessionsDir = path.join(agentsRoot, name.name, "sessions");
    const sqlitePath = path.join(sessionsDir, "sessions.sqlite");
    const storePath = path.join(sessionsDir, "sessions.json");
    if (!fs.existsSync(sqlitePath)) continue;
    const n = purgeStudioConversationsFromAgentSqlite(sqlitePath, storePath, conversationIds);
    if (n > 0) {
      agentsTouched += 1;
      entriesRemoved += n;
    }
  }
  return { agents: agentsTouched, entries: entriesRemoved };
}

/**
 * @param {unknown} cfg
 * @param {unknown} sessionMeta
 * @param {AbortSignal} [signal]
 */
async function purgeStudioChatSessionFromDisk(cfg, sessionMeta, signal) {
  const oc = cfg?.openclaw && typeof cfg.openclaw === "object" ? cfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const conversationIds = resolveConversationIdsForCleanup(sessionMeta);
  if (!conversationIds.length) return { ok: true, skipped: true };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const sessionKeys = collectStudioGatewaySessionKeys(stateDir, conversationIds);

  /** @type {{ gateway?: { deleted: number; errors: number }; sqlite?: { agents: number; entries: number } }} */
  const result = {};

  if (sessionKeys.length) {
    try {
      result.gateway = await deleteGatewaySessionsByKeys(cfg, sessionKeys, signal);
    } catch (err) {
      getStudioLog().warn("[openclaw-disk-cleanup] gateway purge unavailable:", String(err?.message ?? err));
    }
  }

  try {
    result.sqlite = purgeStudioConversationsFromDiskSqlite(stateDir, conversationIds);
  } catch (err) {
    getStudioLog().warn("[openclaw-disk-cleanup] sqlite purge failed:", String(err?.message ?? err));
  }

  return { ok: true, conversationIds, sessionKeys, ...result };
}

module.exports = {
  readGatewayAgentIds,
  resolveConversationIdsForCleanup,
  collectStudioGatewaySessionKeys,
  deleteGatewaySessionsByKeys,
  purgeStudioConversationsFromAgentSqlite,
  purgeStudioConversationsFromDiskSqlite,
  purgeStudioChatSessionFromDisk,
};
