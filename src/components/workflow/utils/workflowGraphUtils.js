import { WORKFLOW_NODE_TYPES } from "../../../workflow/workflowTypes.js";

/** @param {string | undefined} nodeType */
export function getWorkflowNodeAccentColor(nodeType) {
  switch (nodeType) {
    case WORKFLOW_NODE_TYPES.INPUT:
      return "#22c55e";
    case WORKFLOW_NODE_TYPES.OUTPUT:
      return "#f97316";
    case WORKFLOW_NODE_TYPES.NESTED:
      return "#8b5cf6";
    case WORKFLOW_NODE_TYPES.AGENT:
    default:
      return "#3b82f6";
  }
}

/**
 * Downstream reachable subgraph from a start node (follow edge direction).
 * @param {string} startNodeId
 * @param {import('@xyflow/react').Edge[]} edges
 */
export function computeReachableFromNode(startNodeId, edges) {
  /** @type {Map<string, Array<{ target: string; edgeId: string }>>} */
  const downstream = new Map();

  for (const edge of edges) {
    const list = downstream.get(edge.source) ?? [];
    list.push({ target: edge.target, edgeId: edge.id });
    downstream.set(edge.source, list);
  }

  const nodeIds = new Set([startNodeId]);
  const edgeIds = new Set();
  const queue = [startNodeId];

  while (queue.length) {
    const current = queue.shift();
    const targets = downstream.get(current) ?? [];
    for (const { target: targetId, edgeId } of targets) {
      edgeIds.add(edgeId);
      if (!nodeIds.has(targetId)) {
        nodeIds.add(targetId);
        queue.push(targetId);
      }
    }
  }

  return { nodeIds, edgeIds };
}
