import { WORKFLOW_NODE_TYPES } from "../../../workflow/workflowTypes.js";
import { enrichWorkflowNodesForDisplay } from "./workflowDisplayUtils.js";

/**
 * @param {string} parentId
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
function collectSubAgentChildIds(parentId, nodes, edges) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.source === parentId)
    .map((e) => nodeById.get(e.target))
    .filter((n) => n?.type === WORKFLOW_NODE_TYPES.SUB_AGENT)
    .map((n) => n.id);
}

/**
 * Build read-only React Flow nodes/edges with runtime execution highlighting.
 * @param {{
 *   nodes: import('@xyflow/react').Node[];
 *   edges: import('@xyflow/react').Edge[];
 *   runtime: import('../../../workflow/workflowRuntimeRegistry.js').WorkflowSessionRuntimeState | null | undefined;
 *   liveExecution?: import('../../../workflow/workflowLiveExecution.js').WorkflowLiveExecution | null;
 *   agentById: Map<string, import('../../../studio/agents.js').StudioAgent>;
 *   workflows?: Array<{ id: string; name?: string }>;
 * }} args
 */
export function buildWorkflowRuntimeDisplayGraph({
  nodes,
  edges,
  runtime,
  liveExecution = null,
  agentById,
  workflows = [],
}) {
  const completedSet = new Set([
    ...(runtime?.completedNodeIds ?? []),
    ...(liveExecution?.settledSubAgentIds ?? []),
  ]);
  const dispatchSet = new Set(
    liveExecution?.dispatchNodeIds?.length
      ? liveExecution.dispatchNodeIds
      : (runtime?.activeNodeIds ?? []),
  );

  const liveHighlightIds =
    liveExecution?.hasLiveSignal && liveExecution.activeHighlightIds.length
      ? liveExecution.activeHighlightIds
      : [];
  const activeSet = new Set(
    liveHighlightIds.length ? liveHighlightIds : (runtime?.activeNodeIds ?? []),
  );

  const focusNodeIds =
    liveExecution?.hasLiveSignal && liveExecution.focusNodeIds.length
      ? liveExecution.focusNodeIds
      : [...activeSet];

  const hasStarted = activeSet.size > 0 || completedSet.size > 0 || dispatchSet.size > 0;
  if (hasStarted) {
    for (const node of nodes) {
      if (node.type === WORKFLOW_NODE_TYPES.INPUT) completedSet.add(node.id);
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const enriched = enrichWorkflowNodesForDisplay(nodes, edges, { agentById, workflows });
  const displayNodes = enriched.map((node) => {
    /** @type {'active' | 'completed' | 'pending'} */
    let runtimeStatus = "pending";
    if (activeSet.has(node.id)) runtimeStatus = "active";
    else if (completedSet.has(node.id)) runtimeStatus = "completed";

    return {
      ...node,
      draggable: false,
      selectable: false,
      connectable: false,
      data: {
        ...node.data,
        __runtimeView: true,
        isActive: runtimeStatus === "active",
        runtimeStatus,
      },
    };
  });

  const displayEdges = edges.map((edge) => {
    const targetActive = activeSet.has(edge.target);
    const targetNode = nodeById.get(edge.target);
    const sourceCompleted = completedSet.has(edge.source);
    const sourceIsDispatchParent =
      dispatchSet.has(edge.source) &&
      targetNode?.type === WORKFLOW_NODE_TYPES.SUB_AGENT &&
      collectSubAgentChildIds(edge.source, nodes, edges).includes(edge.target);
    const sourceReady =
      sourceCompleted ||
      activeSet.has(edge.source) ||
      (sourceIsDispatchParent && targetActive);
    const flowing = targetActive && sourceReady;
    return {
      ...edge,
      type: "workflowStep",
      animated: flowing,
      className: flowing ? "is-runtime-flow" : undefined,
    };
  });

  return { nodes: displayNodes, edges: displayEdges, focusNodeIds };
}
