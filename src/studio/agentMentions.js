import { agentDisplayLabel } from "./agents.js";

/**
 * @param {import("./agents.js").LobsterAgent} agent
 * @param {string} [mainFallback]
 */
export function agentMentionLabel(agent, mainFallback) {
  const name = agent.name?.trim();
  if (name) return name;
  if (agent.isMain && mainFallback) return mainFallback;
  return agentDisplayLabel(agent);
}

/**
 * @param {import("./agents.js").LobsterAgent} agent
 * @param {string} [mainFallback]
 * @returns {string[]}
 */
function mentionMatchTokens(agent, mainFallback) {
  /** @type {string[]} */
  const out = [];
  const label = agentMentionLabel(agent, mainFallback);
  if (label) out.push(label);
  const gid = agent.gatewayAgentId?.trim();
  if (gid && gid !== label) out.push(gid);
  return out;
}

/**
 * @typedef {{ cleanText: string; mentionIds: string[] }} MentionParseResult
 */

/**
 * Agents eligible for @mention in the current session (main + participant bar only).
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ mainAgent?: import("./agents.js").LobsterAgent | null; participantIds?: string[] }} opts
 * @returns {import("./agents.js").LobsterAgent[]}
 */
export function mentionEligibleAgents(agents, opts = {}) {
  const mainAgent = opts.mainAgent ?? null;
  const participantIds = opts.participantIds ?? [];
  const ids = new Set();
  if (mainAgent?.id) ids.add(mainAgent.id);
  for (const id of participantIds) {
    if (id) ids.add(id);
  }
  if (!ids.size) return [];
  return agents.filter((a) => ids.has(a.id));
}

/**
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ mainAgent?: import("./agents.js").LobsterAgent | null; participantIds?: string[] }} opts
 * @returns {import("./agents.js").LobsterAgent[]}
 */
export function mentionEveryoneAgents(agents, opts = {}) {
  const mainAgent = opts.mainAgent ?? null;
  const participantIds = opts.participantIds ?? [];
  const hasSession = Boolean(mainAgent?.id) || participantIds.length > 0;
  if (hasSession) {
    const ids = new Set();
    if (mainAgent?.id) ids.add(mainAgent.id);
    for (const id of participantIds) {
      if (id) ids.add(id);
    }
    return agents.filter((a) => ids.has(a.id));
  }
  return [...agents];
}

/** @param {string[]} mentionIds @param {string[]} everyoneIds */
export function isEveryoneMention(mentionIds, everyoneIds) {
  if (!everyoneIds.length || mentionIds.length !== everyoneIds.length) return false;
  const set = new Set(everyoneIds);
  return mentionIds.every((id) => set.has(id));
}

/**
 * Parse `@AgentName` tokens against known agents (longest name match first).
 * @param {string} text
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @returns {MentionParseResult}
 */
export function parseAgentMentions(text, agents, opts = {}) {
  const raw = String(text ?? "");
  const mainFallback = typeof opts.mainFallback === "string" ? opts.mainFallback : "";
  const everyoneLabel =
    typeof opts.everyoneLabel === "string" && opts.everyoneLabel.trim()
      ? opts.everyoneLabel.trim()
      : "所有人";
  const eligible = mentionEligibleAgents(agents, opts);
  if (!raw.includes("@") || !eligible.length) {
    return { cleanText: raw, mentionIds: [] };
  }

  /** @type {string[]} */
  const mentionIds = [];
  const seen = new Set();
  let cleanText = raw;

  const escapedEveryone = everyoneLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const everyoneRe = new RegExp(`@${escapedEveryone}(?=\\s|$|[.,!?;:，。！？；：])`, "gu");
  if (everyoneRe.test(cleanText)) {
    cleanText = cleanText.replace(everyoneRe, "").replace(/\s{2,}/g, " ").trim();
    for (const agent of mentionEveryoneAgents(eligible, opts)) {
      if (!seen.has(agent.id)) {
        seen.add(agent.id);
        mentionIds.push(agent.id);
      }
    }
  }

  const sorted = [...eligible].sort((a, b) => {
    const la = agentMentionLabel(a, mainFallback).length;
    const lb = agentMentionLabel(b, mainFallback).length;
    return lb - la;
  });

  for (const agent of sorted) {
    for (const label of mentionMatchTokens(agent, mainFallback)) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`@${escaped}(?=\\s|$|[.,!?;:，。！？；：])`, "gu");
      if (!re.test(cleanText)) continue;
      cleanText = cleanText.replace(re, "").replace(/\s{2,}/g, " ").trim();
      if (!seen.has(agent.id)) {
        seen.add(agent.id);
        mentionIds.push(agent.id);
      }
      break;
    }
  }

  return { cleanText: cleanText.trim(), mentionIds };
}

/**
 * @param {string} draft
 * @param {number} caret
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @returns {{ query: string; start: number } | null}
 */
export function activeMentionQuery(draft, caret, agents, opts = {}) {
  const eligible = mentionEligibleAgents(agents, opts);
  if (!eligible.length) return null;
  const text = String(draft ?? "");
  const pos = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, pos);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

/**
 * @param {string} draft
 * @param {{ start: number; query: string }} active
 * @param {import("./agents.js").LobsterAgent} agent
 */
export function insertMention(draft, active, agent, mainFallback) {
  const label = agentMentionLabel(agent, mainFallback);
  const before = draft.slice(0, active.start);
  const after = draft.slice(active.start + 1 + active.query.length);
  const token = `@${label}`;
  const spacerBefore = before && !/\s$/.test(before) ? " " : "";
  // Always terminate the mention token so the picker closes (activeMentionQuery requires a space after @label).
  const spacerAfter = !after || !/^\s/.test(after) ? " " : "";
  return `${before}${spacerBefore}${token}${spacerAfter}${after}`;
}

/**
 * @param {string} draft
 * @param {{ start: number; query: string }} active
 * @param {string} everyoneLabel
 */
export function insertMentionEveryone(draft, active, everyoneLabel) {
  const label = String(everyoneLabel ?? "").trim() || "所有人";
  const before = draft.slice(0, active.start);
  const after = draft.slice(active.start + 1 + active.query.length);
  const token = `@${label}`;
  const spacerBefore = before && !/\s$/.test(before) ? " " : "";
  const spacerAfter = !after || !/^\s/.test(after) ? " " : "";
  return `${before}${spacerBefore}${token}${spacerAfter}${after}`;
}

/**
 * Resolve which agents should reply for a user turn.
 * Without an @mention (including @everyone), only the main agent replies — participant bar
 * agents stay available for explicit @mentions but do not all chime in on every message.
 * @param {{
 *   mentionIds?: string[];
 *   participantIds?: string[];
 *   agents: import("./agents.js").LobsterAgent[];
 * }} args
 * @returns {import("./agents.js").LobsterAgent[]}
 */
export function resolveReplyTargets({ mentionIds, agents }) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const mentions = (mentionIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  if (mentions.length) return /** @type {import("./agents.js").LobsterAgent[]} */ (mentions);

  const main = agents.find((a) => a.isMain) ?? agents[0];
  return main ? [main] : [];
}
