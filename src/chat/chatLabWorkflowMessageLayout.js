import { agentAvatarGlyph, agentDisplayLabel } from "../studio/agents.js";
import { getWorkflowById, resolveWorkflowAgent } from "../workflow/workflowRuntimeRegistry.js";
import { WORKFLOW_NODE_TYPES } from "../workflow/workflowTypes.js";

/**
 * @typedef {object} WorkflowNodeMeta
 * @property {string} workflowNodeId
 * @property {string} workflowNodeLabel
 */

/**
 * @typedef {object} ChatWorkflowReplyItem
 * @property {Record<string, unknown>} message
 * @property {number} messageIndex
 * @property {string} tabId
 * @property {string} tabLabel
 * @property {string} [agentGlyph]
 * @property {string} [agentName]
 */

/**
 * @typedef {{ kind: "message"; message: Record<string, unknown>; messageIndex: number }} ChatMessageRenderItemMessage
 * @typedef {{
 *   kind: "workflow-replies";
 *   workflowId: string;
 *   workflowName?: string;
 *   userMessageId: string;
 *   replies: ChatWorkflowReplyItem[];
 * }} ChatMessageRenderItemWorkflowReplies
 * @typedef {ChatMessageRenderItemMessage | ChatMessageRenderItemWorkflowReplies} ChatMessageRenderItem
 */

/**
 * @param {import("@xyflow/react").Node | undefined} node
 */
function workflowNodeDisplayLabel(node) {
  if (!node) return "节点";
  const data = node.data && typeof node.data === "object" ? /** @type {Record<string, unknown>} */ (node.data) : {};
  const label = typeof data.label === "string" ? data.label.trim() : "";
  return label || node.id;
}

/**
 * @param {string} workflowId
 * @param {string} agentId
 * @param {Map<string, { id: string; name?: string; gatewayAgentId?: string }>} agentById
 * @param {string[]} [activeNodeIds]
 * @returns {WorkflowNodeMeta | null}
 */
export function resolveWorkflowNodeMetaForAgent(workflowId, agentId, agentById, activeNodeIds) {
  const wfId = String(workflowId ?? "").trim();
  const studioAgentId = String(agentId ?? "").trim();
  if (!wfId || !studioAgentId) return null;

  const workflow = getWorkflowById(wfId);
  if (!workflow) return null;

  const nodeById = new Map((workflow.nodes ?? []).map((n) => [n.id, n]));
  const candidateIds = (activeNodeIds ?? []).filter((id) => nodeById.has(id));
  const searchIds =
    candidateIds.length > 0
      ? candidateIds
      : (workflow.nodes ?? [])
          .filter(
            (n) => n.type === WORKFLOW_NODE_TYPES.AGENT || n.type === WORKFLOW_NODE_TYPES.SUB_AGENT,
          )
          .map((n) => n.id);

  for (const nodeId of searchIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const data = node.data && typeof node.data === "object" ? /** @type {Record<string, unknown>} */ (node.data) : {};
    const rawAgentId = typeof data.agentId === "string" ? data.agentId.trim() : "";
    if (!rawAgentId) continue;
    const resolved = resolveWorkflowAgent(rawAgentId, agentById);
    if (!resolved || resolved.id !== studioAgentId) continue;
    return {
      workflowNodeId: nodeId,
      workflowNodeLabel: workflowNodeDisplayLabel(node),
    };
  }

  return null;
}

/**
 * @param {Record<string, unknown>} message
 * @param {string} workflowId
 * @param {Map<string, { id: string; name?: string; gatewayAgentId?: string }>} agentById
 */
export function resolveWorkflowReplyTabLabel(message, workflowId, agentById) {
  const stored = typeof message.workflowNodeLabel === "string" ? message.workflowNodeLabel.trim() : "";
  if (stored) return stored;

  const agentId = typeof message.agentId === "string" ? message.agentId : "";
  const nodeId = typeof message.workflowNodeId === "string" ? message.workflowNodeId : "";
  if (nodeId) {
    const workflow = getWorkflowById(workflowId);
    const node = workflow?.nodes?.find((n) => n.id === nodeId);
    if (node) return workflowNodeDisplayLabel(node);
  }

  if (agentId) {
    const meta = resolveWorkflowNodeMetaForAgent(workflowId, agentId, agentById);
    if (meta?.workflowNodeLabel) return meta.workflowNodeLabel;
    const agent = agentById.get(agentId);
    if (agent?.name) return agent.name;
    if (agent?.gatewayAgentId) return agent.gatewayAgentId;
    return agentId;
  }

  return "智能体";
}

/**
 * @param {Record<string, unknown>} message
 */
function isWorkflowTurnAssistantMessage(message) {
  if (!message || message.role !== "assistant") return false;
  if (message.mentionDelegateReply) return false;
  if (message.workflowHandoffReply) return true;
  if (typeof message.workflowNodeId === "string" && message.workflowNodeId) return true;
  if (typeof message.workflowNodeLabel === "string" && message.workflowNodeLabel.trim()) return true;
  return true;
}

/**
 * @param {Array<Record<string, unknown>>} messages
 * @param {Map<string, { id: string; name?: string; gatewayAgentId?: string }>} agentById
 * @returns {ChatMessageRenderItem[]}
 */
export function buildChatMessageRenderItems(messages, agentById) {
  /** @type {ChatMessageRenderItem[]} */
  const items = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const workflowId = typeof message.workflowId === "string" ? message.workflowId.trim() : "";

    if (message.role === "user" && workflowId) {
      items.push({ kind: "message", message, messageIndex: i });

      /** @type {ChatWorkflowReplyItem[]} */
      const replies = [];
      let j = i + 1;
      while (j < messages.length) {
        const next = messages[j];
        if (next.role === "user" || next.messageKind === "group_member_event") break;
        if (next.role === "assistant" && isWorkflowTurnAssistantMessage(next)) {
          const agentId = typeof next.agentId === "string" ? next.agentId : "";
          const agent = agentId ? agentById.get(agentId) : null;
          replies.push({
            message: next,
            messageIndex: j,
            tabId: String(next.id ?? `wf-tab-${j}`),
            tabLabel: resolveWorkflowReplyTabLabel(next, workflowId, agentById),
            ...(agent ? { agentGlyph: agentAvatarGlyph(agent), agentName: agentDisplayLabel(agent) } : {}),
          });
          j++;
          continue;
        }
        if (next.role === "assistant") break;
        j++;
      }

      if (replies.length > 1) {
        items.push({
          kind: "workflow-replies",
          workflowId,
          workflowName:
            typeof message.workflowName === "string" && message.workflowName.trim()
              ? message.workflowName.trim()
              : undefined,
          userMessageId: String(message.id ?? ""),
          replies,
        });
      } else if (replies.length === 1) {
        items.push({ kind: "message", message: replies[0].message, messageIndex: replies[0].messageIndex });
      }

      i = j - 1;
      continue;
    }

    items.push({ kind: "message", message, messageIndex: i });
  }

  return items;
}

/**
 * Flatten render items back to message indices for scroll helpers.
 * @param {ChatMessageRenderItem[]} items
 */
export function flattenRenderItemMessageIndices(items) {
  /** @type {number[]} */
  const indices = [];
  for (const item of items) {
    if (item.kind === "message") {
      indices.push(item.messageIndex);
      continue;
    }
    for (const reply of item.replies) {
      indices.push(reply.messageIndex);
    }
  }
  return indices;
}
