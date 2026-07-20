/**
 * Shared thread context layer for multi-agent gateway turns.
 *
 * Canonical transcript lives in chatSessionsStore; each agent session tracks a sync
 * cursor so subsequent turns send deltas instead of replaying the full thread.
 */

import { agentDisplayLabel, sessionKeyForAgent } from "../studio/agents.js";
import { appendFollowUpToGatewayBody } from "./chatLabFollowUp.js";
import { gatewayUserMessageBodyWithRefs } from "./chatLabComposerFileRefs.js";
import { openClawAttachmentsFromComposer } from "./chatLabComposerAttachments.js";
import { getSession, updateSessionThreadContext } from "./chatSessionsStore.js";

/** User+assistant turns included on first contact with an agent session. */
export const GATEWAY_BOOTSTRAP_RECENT_TURNS = 8;
/** Older turns collapsed into a stored summary on bootstrap. */
export const GATEWAY_SUMMARY_MAX_CHARS = 2400;
/** After this many chat turns, refresh the stored thread summary. */
export const GATEWAY_SUMMARY_REFRESH_TURN_INTERVAL = 12;

/**
 * @typedef {'none' | 'bootstrap' | 'incremental' | 'full'} GatewayContextEmbedMode
 */

/**
 * @typedef {object} GatewayOutgoingContext
 * @property {Array<{ role: string; content: string; attachments?: unknown[] }>} priorRows
 * @property {GatewayContextEmbedMode} contextEmbedMode
 * @property {string | null} syncThroughMessageId Message id to record after a successful turn
 * @property {string} [threadSummaryPrefix] Prepended to prior rows on bootstrap
 */

/**
 * @param {Array<{ role?: string; messageKind?: string }>} msgs
 * @returns {boolean}
 */
export function isGatewayChatTurn(m) {
  if (!m || m.error) return false;
  if (m.messageKind === "group_member_event") return true;
  return m.role === "user" || m.role === "assistant";
}

/**
 * @param {Array<Record<string, unknown>>} messages
 */
export function filterMessagesForGatewayContext(messages) {
  return (messages ?? []).filter((m) => isGatewayChatTurn(m));
}

/**
 * @param {Array<{ id?: string; role?: string; content?: string }>} messages
 * @param {string} afterMessageId
 */
export function sliceMessagesAfter(messages, afterMessageId) {
  if (!afterMessageId) return [...messages];
  const idx = messages.findIndex((m) => m.id === afterMessageId);
  if (idx < 0) return [...messages];
  return messages.slice(idx + 1);
}

/**
 * @param {Array<{ role?: string; content?: string; thinking?: string }>} messages
 */
export function computeThreadSummary(messages) {
  const turns = (messages ?? []).filter(
    (m) =>
      m.messageKind === "group_member_event" ||
      m.role === "user" ||
      m.role === "assistant",
  );
  if (turns.length <= GATEWAY_BOOTSTRAP_RECENT_TURNS) return "";
  const older = turns.slice(0, Math.max(0, turns.length - GATEWAY_BOOTSTRAP_RECENT_TURNS));
  if (!older.length) return "";

  /** @type {string[]} */
  const lines = ["Prior thread summary (older turns):"];
  for (const m of older) {
    if (m.messageKind === "group_member_event") {
      const body = String(m.content ?? "").trim().replace(/\s+/g, " ");
      if (!body) continue;
      lines.push(`- [Group · system]: ${body.length > 220 ? `${body.slice(0, 219)}…` : body}`);
      continue;
    }
    const role = m.role === "user" ? "User" : "Assistant";
    const body = String(m.content ?? m.thinking ?? "").trim().replace(/\s+/g, " ");
    if (!body) continue;
    const clipped = body.length > 220 ? `${body.slice(0, 219)}…` : body;
    lines.push(`- ${role}: ${clipped}`);
    if (lines.join("\n").length > GATEWAY_SUMMARY_MAX_CHARS) break;
  }
  const out = lines.join("\n").trim();
  return out.length > GATEWAY_SUMMARY_MAX_CHARS ? `${out.slice(0, GATEWAY_SUMMARY_MAX_CHARS - 1)}…` : out;
}

/**
 * @param {Array<Record<string, unknown>>} messages
 */
export function bootstrapMessageSlice(messages) {
  const chat = filterMessagesForGatewayContext(messages);
  if (chat.length <= GATEWAY_BOOTSTRAP_RECENT_TURNS) return { slice: chat, summary: "" };
  const summary = computeThreadSummary(chat);
  const slice = chat.slice(-GATEWAY_BOOTSTRAP_RECENT_TURNS);
  return { slice, summary };
}

/**
 * @param {Array<{ role: string; content?: string; thinking?: string; error?: string; imageAttachments?: unknown; fileRefs?: unknown; agentId?: string; messageKind?: string }>} msgs
 * @param {{ includeImageAttachments?: boolean; agentById?: Map<string, import("../studio/agents.js").LobsterAgent>; targetAgentId?: string; mainAgentStudioId?: string }} [opts]
 */
export function buildGatewayPayloadRows(msgs, opts = {}) {
  const includeImageAttachments = opts.includeImageAttachments === true;
  const agentById = opts.agentById;
  const targetAgentId = typeof opts.targetAgentId === "string" ? opts.targetAgentId : "";
  const mainAgentStudioId = typeof opts.mainAgentStudioId === "string" ? opts.mainAgentStudioId : "";
  return msgs
    .filter((m) => isGatewayChatTurn(m))
    .map((m) => {
      if (m.messageKind === "group_member_event") {
        const text = String(m.content ?? "").trim();
        if (!text) return null;
        return { role: "user", content: `[群聊 · 系统]: ${text}` };
      }
      if (m.role !== "assistant") {
        const row = {
          role: m.role,
          content: appendFollowUpToGatewayBody(
            gatewayUserMessageBodyWithRefs(m.content, m.imageAttachments, m.fileRefs),
            m.followUpRef,
          ),
        };
        if (includeImageAttachments) {
          const att = openClawAttachmentsFromComposer(m.imageAttachments);
          if (att) Object.assign(row, { attachments: att });
        }
        return row;
      }
      const c = String(m.content ?? "").trim();
      const th = String(m.thinking ?? "").trim();
      let body = c || th || "";
      const agentId =
        typeof m.agentId === "string" && m.agentId
          ? m.agentId
          : m.role === "assistant" && mainAgentStudioId
            ? mainAgentStudioId
            : "";
      if (body && agentId && agentById?.has(agentId)) {
        const agent = agentById.get(agentId);
        const label = agentDisplayLabel(agent);
        body =
          targetAgentId && agentId !== targetAgentId
            ? `[群聊 · ${label}]: ${body}`
            : `[You · ${label}]: ${body}`;
      }
      // Peer agents must not use `assistant` — the model would treat their lines as its own prior reply.
      const role =
        targetAgentId && m.role === "assistant" && agentId && agentId !== targetAgentId
          ? "user"
          : m.role;
      return { role, content: body };
    })
    .filter(Boolean);
}

/**
 * Resolve prior history rows + embed mode for one agent turn.
 *
 * @param {{
 *   conversationId: string;
 *   agentId: string;
 *   historyMessages: Array<Record<string, unknown>>;
 *   agentById?: Map<string, import("../studio/agents.js").LobsterAgent>;
 *   mainAgentStudioId?: string;
 *   excludeMessageIds?: string[];
 *   forceBootstrap?: boolean;
 * }} args
 * @returns {GatewayOutgoingContext}
 */
export function resolveAgentGatewayContext(args) {
  const {
    conversationId,
    agentId,
    historyMessages,
    agentById,
    mainAgentStudioId = "",
    excludeMessageIds = [],
    forceBootstrap = false,
  } = args;

  const exclude = new Set(excludeMessageIds.filter(Boolean));
  const rawHistory = (historyMessages ?? []).filter((m) => !exclude.has(String(m.id ?? "")));

  const rec = getSession(conversationId);
  const sync = rec?.threadContext?.agentSync?.[agentId];
  const lastSyncedId = typeof sync?.lastMessageId === "string" ? sync.lastMessageId : "";

  const chatMessages = filterMessagesForGatewayContext(rawHistory);
  const syncAnchor = findSyncAnchorMessageId(rawHistory);

  if (forceBootstrap || !lastSyncedId) {
    const recSummary = rec?.threadContext?.summary?.trim();
    const { slice, summary: computedSummary } = bootstrapMessageSlice(rawHistory);
    const summary = recSummary || computedSummary;
    const priorRows = buildGatewayPayloadRows(slice, {
      agentById,
      targetAgentId: agentId,
      mainAgentStudioId,
    });
    return {
      priorRows,
      contextEmbedMode: priorRows.length ? "bootstrap" : "none",
      syncThroughMessageId: syncAnchor,
      threadSummaryPrefix: summary || undefined,
    };
  }

  const delta = sliceMessagesAfter(chatMessages, lastSyncedId);
  if (!delta.length) {
    return {
      priorRows: [],
      contextEmbedMode: "none",
      syncThroughMessageId: syncAnchor,
    };
  }

  return {
    priorRows: buildGatewayPayloadRows(delta, {
      agentById,
      targetAgentId: agentId,
      mainAgentStudioId,
    }),
    contextEmbedMode: "incremental",
    syncThroughMessageId: syncAnchor,
  };
}

/**
 * Last user/assistant message id in the thread (sync cursor target after a successful turn).
 * @param {Array<{ id?: string; role?: string; messageKind?: string }>} messages
 */
export function findSyncAnchorMessageId(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isGatewayChatTurn(m)) continue;
    if (typeof m.id === "string" && m.id) return m.id;
  }
  return null;
}

/**
 * @param {string} conversationId
 * @param {string} agentId
 * @param {string | null} lastMessageId
 * @param {Array<Record<string, unknown>>} [allMessages]
 */
export function recordAgentGatewaySync(conversationId, agentId, lastMessageId, allMessages) {
  if (!conversationId || !agentId || !lastMessageId) return;
  const rec = getSession(conversationId);
  const prev = rec?.threadContext ?? {};
  const agentSync = { ...(prev.agentSync ?? {}), [agentId]: { lastMessageId } };

  let summary = prev.summary;
  let summaryThroughMessageId = prev.summaryThroughMessageId;
  if (Array.isArray(allMessages) && allMessages.length) {
    const chat = filterMessagesForGatewayContext(allMessages);
    const turnCount = chat.length;
    const shouldRefresh =
      !summary ||
      !summaryThroughMessageId ||
      turnCount - GATEWAY_BOOTSTRAP_RECENT_TURNS >
        (chat.findIndex((m) => m.id === summaryThroughMessageId) >= 0 ? turnCount : 0);
    if (shouldRefresh && turnCount > GATEWAY_BOOTSTRAP_RECENT_TURNS) {
      summary = computeThreadSummary(chat);
      summaryThroughMessageId = findSyncAnchorMessageId(allMessages);
    }
  }

  updateSessionThreadContext(conversationId, {
    agentSync,
    ...(summary ? { summary, summaryThroughMessageId: summaryThroughMessageId ?? lastMessageId } : {}),
  });
}

/** Clear per-agent sync cursors after history truncation (edit/regenerate). */
export function resetThreadGatewaySync(conversationId) {
  if (!conversationId) return;
  const rec = getSession(conversationId);
  if (!rec?.threadContext) return;
  updateSessionThreadContext(conversationId, {
    ...(rec.threadContext.summary ? { summary: rec.threadContext.summary, summaryThroughMessageId: rec.threadContext.summaryThroughMessageId } : {}),
    agentSync: {},
  });
}

/**
 * @param {import("../studio/agents.js").LobsterAgent} agent
 * @param {string} conversationId
 */
export function resolveAgentStudioSessionKey(agent, conversationId) {
  const base = sessionKeyForAgent(agent);
  const safe = sanitizeConvSegment(conversationId);
  if (!base || !safe) return base || "";
  return `${base}#studio:${safe}`;
}

/**
 * Build session keys to prewarm for agents in a conversation.
 * @param {string} conversationId
 * @param {import("../studio/agents.js").LobsterAgent[]} agents
 */
export function agentSessionKeysForConversation(conversationId, agents) {
  return agents
    .map((a) => resolveAgentStudioSessionKey(a, conversationId))
    .filter(Boolean);
}

/** @param {string} conversationId */
function sanitizeConvSegment(conversationId) {
  const cid = String(conversationId ?? "").trim();
  if (!cid) return "";
  const normalized = cid.startsWith("wechat:") ? `wx_${cid.slice("wechat:".length)}` : cid;
  return normalized
    .replace(/#/g, "")
    .replace(/\s+/g, "")
    .replace(/@/g, "_at_")
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 96);
}
