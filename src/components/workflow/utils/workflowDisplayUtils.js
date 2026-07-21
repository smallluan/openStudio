import { agentDisplayLabel } from "../../../studio/agents.js";
import { WORKFLOW_NODE_TYPES } from "../../../workflow/workflowTypes.js";
import { resolveHandoffAgentId } from "./workflowGraphUtils.js";

/** @param {import('@xyflow/react').Node} node */
function resolveAgentNodeStudioId(node, nodes) {
  let agentId = node.data?.agentId;
  if (!agentId && node.data?.handoffSourceNodeId) {
    const parent = nodes.find((candidate) => candidate.id === node.data.handoffSourceNodeId);
    agentId = parent?.data?.agentId ?? null;
  }
  return typeof agentId === "string" && agentId ? agentId : null;
}

/**
 * Add display-only fields for canvas rendering. Never persist these fields.
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {{ agentById: Map<string, import('../../../studio/agents.js').StudioAgent>; workflows: Array<{ id: string; name?: string }> }} ctx
 */
export function enrichWorkflowNodesForDisplay(nodes, edges, { agentById, workflows }) {
  return nodes.map((node) => {
    if (node.type === WORKFLOW_NODE_TYPES.AGENT) {
      const agentId = resolveAgentNodeStudioId(node, nodes);
      const agent = agentId ? agentById.get(String(agentId)) : null;
      return { ...node, data: { ...node.data, agentName: agent ? agentDisplayLabel(agent) : undefined } };
    }
    if (node.type === WORKFLOW_NODE_TYPES.SUB_AGENT) {
      let agentId = node.data?.agentId;
      if (!agentId) {
        const parentAgentNodeId = resolveHandoffAgentId(node.id, nodes, edges);
        const parent = parentAgentNodeId ? nodes.find((candidate) => candidate.id === parentAgentNodeId) : null;
        agentId = parent?.data?.agentId ?? null;
      }
      const agent = agentId ? agentById.get(String(agentId)) : null;
      return { ...node, data: { ...node.data, agentName: agent ? agentDisplayLabel(agent) : undefined } };
    }
    if (node.type === WORKFLOW_NODE_TYPES.NESTED) {
      const wfId = node.data?.workflowId;
      const wf = wfId ? workflows.find((w) => w.id === wfId) : null;
      return { ...node, data: { ...node.data, workflowName: wf?.name } };
    }
    return node;
  });
}
