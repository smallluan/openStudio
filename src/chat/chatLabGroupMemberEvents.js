import { agentDisplayLabel } from "../studio/agents.js";

/**
 * @typedef {'invite' | 'remove'} GroupMemberEventKind
 */

/**
 * @typedef {import("./chatSessionsStore.js").PersistedChatMessage & {
 *   messageKind: 'group_member_event';
 * }} GroupMemberEventMessage
 */

/** @returns {string} */
function newGroupMemberEventId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `gme_${crypto.randomUUID()}`;
  return `gme_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * @param {{
 *   kind: GroupMemberEventKind;
 *   actorLabel: string;
 *   targetLabel: string;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} args
 * @returns {GroupMemberEventMessage}
 */
export function createGroupMemberEventMessage({ kind, actorLabel, targetLabel, t }) {
  const content =
    kind === "invite"
      ? t("chatLab.groupMemberInvited", { actor: actorLabel, target: targetLabel })
      : t("chatLab.groupMemberRemoved", { actor: actorLabel, target: targetLabel });
  return {
    id: newGroupMemberEventId(),
    role: "assistant",
    content,
    messageKind: "group_member_event",
    createdAt: Date.now(),
  };
}

/**
 * @param {string[]} prevNonMainIds
 * @param {string[]} nextNonMainIds
 * @param {Map<string, import("../studio/agents.js").LobsterAgent>} agentById
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {string} actorLabel
 * @returns {GroupMemberEventMessage[]}
 */
export function buildGroupMemberChangeEvents(prevNonMainIds, nextNonMainIds, agentById, t, actorLabel) {
  const prev = new Set(prevNonMainIds);
  const next = new Set(nextNonMainIds);
  /** @type {GroupMemberEventMessage[]} */
  const out = [];

  for (const id of nextNonMainIds) {
    if (prev.has(id)) continue;
    const agent = agentById.get(id);
    if (!agent || agent.isMain) continue;
    out.push(
      createGroupMemberEventMessage({
        kind: "invite",
        actorLabel,
        targetLabel: agentDisplayLabel(agent),
        t,
      }),
    );
  }

  for (const id of prevNonMainIds) {
    if (next.has(id)) continue;
    const agent = agentById.get(id);
    if (!agent || agent.isMain) continue;
    out.push(
      createGroupMemberEventMessage({
        kind: "remove",
        actorLabel,
        targetLabel: agentDisplayLabel(agent),
        t,
      }),
    );
  }

  return out;
}
