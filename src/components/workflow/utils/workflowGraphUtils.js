import { WORKFLOW_NODE_TYPES } from "../../../workflow/workflowTypes.js";
import { createWorkflowEdgeId } from "../../../workflow/workflowIds.js";
import { createWorkflowNodeId } from "./workflowNodeHandles.js";

const WORKFLOW_SNAP_GRID = 16;

/** Node types that may spawn sub-agent nodes downstream. */
export const WORKFLOW_SUB_AGENT_PARENT_TYPES = new Set([
  WORKFLOW_NODE_TYPES.AGENT,
  WORKFLOW_NODE_TYPES.SUB_AGENT,
]);

/** @param {string | undefined} nodeType */
export function getWorkflowNodeAccentColor(nodeType) {
  switch (nodeType) {
    case WORKFLOW_NODE_TYPES.INPUT:
      return "#22c55e";
    case WORKFLOW_NODE_TYPES.OUTPUT:
      return "#f97316";
    case WORKFLOW_NODE_TYPES.NESTED:
      return "#8b5cf6";
    case WORKFLOW_NODE_TYPES.SUB_AGENT:
      return "#06b6d4";
    case WORKFLOW_NODE_TYPES.AGENT:
    default:
      return "#3b82f6";
  }
}

/**
 * Validate whether a new edge is allowed in the workflow graph.
 * @param {{ source?: string | null; target?: string | null }} connection
 * @param {import('@xyflow/react').Node[]} nodes
 */
export function isValidWorkflowConnection(connection, nodes) {
  const sourceId = connection.source;
  const targetId = connection.target;
  if (!sourceId || !targetId || sourceId === targetId) return false;

  const sourceNode = nodes.find((n) => n.id === sourceId);
  const targetNode = nodes.find((n) => n.id === targetId);
  if (!sourceNode?.type || !targetNode?.type) return false;

  if (targetNode.type === WORKFLOW_NODE_TYPES.INPUT) return false;
  if (sourceNode.type === WORKFLOW_NODE_TYPES.OUTPUT) return false;

  if (
    targetNode.type === WORKFLOW_NODE_TYPES.SUB_AGENT &&
    !WORKFLOW_SUB_AGENT_PARENT_TYPES.has(sourceNode.type)
  ) {
    return false;
  }

  return true;
}

/** @param {import('@xyflow/react').Node | undefined | null} node */
function resolveNodeStudioAgentId(node) {
  const agentId = node?.data?.agentId;
  return typeof agentId === "string" && agentId ? agentId : null;
}

/** @param {import('@xyflow/react').Node | undefined | null} left @param {import('@xyflow/react').Node | undefined | null} right */
export function isSameStudioAgentNode(left, right) {
  const leftId = resolveNodeStudioAgentId(left);
  const rightId = resolveNodeStudioAgentId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

/**
 * Keep handoff proxy agent nodes in sync with their source main agent.
 * @param {import('@xyflow/react').Node[]} nodes
 */
export function syncHandoffProxyAgents(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return nodes.map((node) => {
    const handoffSourceNodeId = node.data?.handoffSourceNodeId;
    if (node.type !== WORKFLOW_NODE_TYPES.AGENT || typeof handoffSourceNodeId !== "string") {
      return node;
    }

    const parent = nodeById.get(handoffSourceNodeId);
    if (!parent) return node;

    const parentData = parent.data ?? {};
    return {
      ...node,
      data: {
        ...node.data,
        label: typeof parentData.label === "string" ? parentData.label : node.data?.label,
        description: typeof parentData.description === "string" ? parentData.description : node.data?.description,
        agentId: resolveNodeStudioAgentId(parent),
        skillOverrides: structuredClone(parentData.skillOverrides ?? { bind: [], unbind: [] }),
      },
    };
  });
}

/**
 * Sub-agents always mirror their owning main agent's studio agent selection.
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
export function inheritSubAgentAgentsFromParents(nodes, edges) {
  return nodes.map((node) => {
    if (node.type !== WORKFLOW_NODE_TYPES.SUB_AGENT) return node;

    const parentAgentNodeId = resolveHandoffAgentId(node.id, nodes, edges);
    if (!parentAgentNodeId) return node;

    const parent = nodes.find((candidate) => candidate.id === parentAgentNodeId);
    const parentStudioAgentId = resolveNodeStudioAgentId(parent);
    if (!parentStudioAgentId) return node;

    return {
      ...node,
      data: {
        ...node.data,
        agentId: parentStudioAgentId,
      },
    };
  });
}

/**
 * Collapse handoff proxies that point back to their source main agent node.
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
export function reconcileHandoffGraph(nodes, edges) {
  let nextNodes = [...nodes];
  let nextEdges = [...edges];
  let changed = true;

  while (changed) {
    changed = false;
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));

    for (const handoffNode of [...nextNodes]) {
      const handoffSourceNodeId = handoffNode.data?.handoffSourceNodeId;
      if (handoffNode.type !== WORKFLOW_NODE_TYPES.AGENT || typeof handoffSourceNodeId !== "string") {
        continue;
      }

      const parent = nodeById.get(handoffSourceNodeId);
      if (!parent) continue;

      const outgoing = nextEdges.filter((edge) => edge.source === handoffNode.id);
      for (const outEdge of outgoing) {
        const target = nodeById.get(outEdge.target);
        if (target?.type !== WORKFLOW_NODE_TYPES.AGENT || target.id !== parent.id) {
          continue;
        }

        const incoming = nextEdges.filter((edge) => edge.target === handoffNode.id);
        const subAgentSources = incoming
          .map((edge) => nodeById.get(edge.source))
          .filter((source) => source?.type === WORKFLOW_NODE_TYPES.SUB_AGENT);

        for (const inEdge of incoming) {
          const hasDirectReturn = nextEdges.some(
            (edge) => edge.source === inEdge.source && edge.target === parent.id,
          );
          if (!hasDirectReturn) {
            nextEdges = [...nextEdges, createWorkflowStepEdge(inEdge.source, parent.id)];
          }
        }

        // Ensure every downstream sub-agent from this parent returns when handoff collapses.
        for (const subAgent of nextNodes.filter(
          (candidate) =>
            candidate.type === WORKFLOW_NODE_TYPES.SUB_AGENT &&
            resolveHandoffAgentId(candidate.id, nextNodes, nextEdges) === parent.id,
        )) {
          if (subAgentSources.some((source) => source?.id === subAgent.id)) continue;
          const hasDirectReturn = nextEdges.some(
            (edge) => edge.source === subAgent.id && edge.target === parent.id,
          );
          if (!hasDirectReturn) {
            nextEdges = [...nextEdges, createWorkflowStepEdge(subAgent.id, parent.id)];
          }
        }

        const removeIds = new Set([outEdge.id, ...incoming.map((edge) => edge.id)]);
        nextEdges = nextEdges.filter((edge) => !removeIds.has(edge.id));
        changed = true;
      }

      const stillConnected = nextEdges.some(
        (edge) => edge.source === handoffNode.id || edge.target === handoffNode.id,
      );
      if (!stillConnected) {
        nextNodes = nextNodes.filter((node) => node.id !== handoffNode.id);
        changed = true;
      }
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

/** Normalize workflow graph invariants for handoff/sub-agent behavior. */
export function normalizeWorkflowGraph(nodes, edges) {
  const syncedNodes = syncHandoffProxyAgents(nodes);
  const inheritedNodes = inheritSubAgentAgentsFromParents(syncedNodes, edges);
  const handoffPaths = reconcileSubAgentHandoffPaths(inheritedNodes, edges);
  const reconciled = reconcileHandoffGraph(handoffPaths.nodes, handoffPaths.edges);
  return promoteOrphanedHandoffProxies(reconciled.nodes, reconciled.edges);
}

/**
 * Handoff proxy nodes that no longer route to a different downstream agent
 * (or lost their parent agent) should become regular agent nodes.
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
export function promoteOrphanedHandoffProxies(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const nextNodes = nodes.map((node) => {
    const handoffSourceNodeId = node.data?.handoffSourceNodeId;
    if (node.type !== WORKFLOW_NODE_TYPES.AGENT || typeof handoffSourceNodeId !== "string") {
      return node;
    }

    const parent = nodeById.get(handoffSourceNodeId);
    const outgoing = edges.filter((edge) => edge.source === node.id);
    const hasDownstreamAgentTarget = outgoing.some((edge) => {
      const target = nodeById.get(edge.target);
      return target?.type === WORKFLOW_NODE_TYPES.AGENT && target.id !== handoffSourceNodeId;
    });

    if (parent && hasDownstreamAgentTarget) return node;

    const nextData = { ...(node.data ?? {}) };
    delete nextData.handoffSourceNodeId;
    return { ...node, data: nextData };
  });

  return { nodes: nextNodes, edges };
}

/**
 * Keep sub-agent outgoing paths in sync when studio agents change after connect:
 * - same studio agent as parent → direct sub-agent → target
 * - different studio agent → sub-agent → handoff proxy → target
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
export function reconcileSubAgentHandoffPaths(nodes, edges) {
  let nextNodes = [...nodes];
  let nextEdges = [...edges];

  let changed = true;
  while (changed) {
    changed = false;
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));

    for (const handoffNode of [...nextNodes]) {
      const handoffSourceNodeId = handoffNode.data?.handoffSourceNodeId;
      if (handoffNode.type !== WORKFLOW_NODE_TYPES.AGENT || typeof handoffSourceNodeId !== "string") {
        continue;
      }

      const parent = nodeById.get(handoffSourceNodeId);
      if (!parent) continue;

      for (const outEdge of nextEdges.filter((edge) => edge.source === handoffNode.id)) {
        const target = nodeById.get(outEdge.target);
        if (target?.type !== WORKFLOW_NODE_TYPES.AGENT || target.id === parent.id) {
          continue;
        }
        if (!isSameStudioAgentNode(parent, target)) {
          continue;
        }

        const incoming = nextEdges.filter((edge) => edge.target === handoffNode.id);
        for (const inEdge of incoming) {
          const source = nodeById.get(inEdge.source);
          if (source?.type !== WORKFLOW_NODE_TYPES.SUB_AGENT) continue;
          if (!nextEdges.some((edge) => edge.source === inEdge.source && edge.target === target.id)) {
            nextEdges = [...nextEdges, createWorkflowStepEdge(inEdge.source, target.id)];
          }
        }

        const removeIds = new Set([outEdge.id, ...incoming.map((edge) => edge.id)]);
        nextEdges = nextEdges.filter((edge) => !removeIds.has(edge.id));
        changed = true;
      }

      const stillConnected = nextEdges.some(
        (edge) => edge.source === handoffNode.id || edge.target === handoffNode.id,
      );
      if (!stillConnected) {
        nextNodes = nextNodes.filter((node) => node.id !== handoffNode.id);
        changed = true;
      }
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));

    for (const edge of nextEdges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (source?.type !== WORKFLOW_NODE_TYPES.SUB_AGENT || target?.type !== WORKFLOW_NODE_TYPES.AGENT) {
        continue;
      }
      if (typeof target.data?.handoffSourceNodeId === "string") {
        continue;
      }

      const parentAgentId = resolveHandoffAgentId(edge.source, nextNodes, nextEdges);
      if (!parentAgentId || parentAgentId === target.id) continue;

      const parent = nodeById.get(parentAgentId);
      if (!parent || isSameStudioAgentNode(parent, target)) continue;

      const upgraded = ensureSubAgentHandoffToAgent(edge.source, edge.target, nextNodes, nextEdges);
      if (!upgraded) continue;

      nextNodes = upgraded.nodes;
      nextEdges = upgraded.edges;
      changed = true;
      break;
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

/**
 * Walk upstream from a sub-agent node to the owning main agent.
 * @param {string} subAgentNodeId
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @returns {string | null}
 */
export function resolveHandoffAgentId(subAgentNodeId, nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let currentId = subAgentNodeId;

  while (true) {
    const parentEdge = edges.find((edge) => {
      if (edge.target !== currentId) return false;
      const parentType = nodeById.get(edge.source)?.type;
      return parentType != null && WORKFLOW_SUB_AGENT_PARENT_TYPES.has(parentType);
    });
    if (!parentEdge) return null;

    const parent = nodeById.get(parentEdge.source);
    if (!parent?.type) return null;

    if (parent.type === WORKFLOW_NODE_TYPES.AGENT) {
      return parent.id;
    }
    if (parent.type === WORKFLOW_NODE_TYPES.SUB_AGENT) {
      currentId = parent.id;
      continue;
    }
    return null;
  }
}

/**
 * When a sub-agent connects to another main agent with a different studio agent,
 * insert a handoff proxy between them: sub-agent → handoff agent → target agent.
 * Same studio agent as the parent connects directly with no proxy.
 * @param {{ source?: string | null; target?: string | null }} connection
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @returns {{ consumed: true; nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[] } | null}
 */
export function applySubAgentHandoffOnConnect(connection, nodes, edges) {
  const sourceId = connection.source;
  const targetId = connection.target;
  if (!sourceId || !targetId) return null;

  const result = ensureSubAgentHandoffToAgent(sourceId, targetId, nodes, edges);
  if (!result) return null;

  const normalized = normalizeWorkflowGraph(result.nodes, result.edges);
  return { consumed: true, nodes: normalized.nodes, edges: normalized.edges };
}

/**
 * Route a sub-agent to a target main agent node, inserting a handoff proxy when needed.
 * @returns {{ nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[] } | null}
 */
function ensureSubAgentHandoffToAgent(subAgentId, targetAgentId, nodes, edges) {
  const sourceNode = nodes.find((node) => node.id === subAgentId);
  const targetNode = nodes.find((node) => node.id === targetAgentId);
  if (sourceNode?.type !== WORKFLOW_NODE_TYPES.SUB_AGENT || targetNode?.type !== WORKFLOW_NODE_TYPES.AGENT) {
    return null;
  }
  if (typeof targetNode.data?.handoffSourceNodeId === "string") {
    return null;
  }

  const parentAgentId = resolveHandoffAgentId(subAgentId, nodes, edges);
  if (!parentAgentId || parentAgentId === targetAgentId) {
    return null;
  }

  const parentAgent = nodes.find((node) => node.id === parentAgentId);
  if (!parentAgent) return null;

  let nextNodes = nodes;
  let nextEdges = edges.filter(
    (edge) => !(edge.source === subAgentId && edge.target === targetAgentId),
  );

  if (isSameStudioAgentNode(parentAgent, targetNode)) {
    if (!nextEdges.some((edge) => edge.source === subAgentId && edge.target === targetAgentId)) {
      nextEdges = [...nextEdges, createWorkflowStepEdge(subAgentId, targetAgentId)];
    }
    return { nodes: nextNodes, edges: nextEdges };
  }

  let handoffNode = findHandoffProxyAgentNode(parentAgentId, targetAgentId, nextNodes, nextEdges);
  if (!handoffNode) {
    handoffNode = createHandoffProxyAgentNode(parentAgent, sourceNode, targetNode);
    nextNodes = [...nextNodes, handoffNode];
  }

  if (!nextEdges.some((edge) => edge.source === subAgentId && edge.target === handoffNode.id)) {
    nextEdges = [...nextEdges, createWorkflowStepEdge(subAgentId, handoffNode.id)];
  }

  if (!nextEdges.some((edge) => edge.source === handoffNode.id && edge.target === targetAgentId)) {
    nextEdges = [...nextEdges, createWorkflowStepEdge(handoffNode.id, targetAgentId)];
  }

  return { nodes: nextNodes, edges: nextEdges };
}

/** @param {{ x: number; y: number }} position */
function snapWorkflowPosition(position) {
  return {
    x: Math.round(position.x / WORKFLOW_SNAP_GRID) * WORKFLOW_SNAP_GRID,
    y: Math.round(position.y / WORKFLOW_SNAP_GRID) * WORKFLOW_SNAP_GRID,
  };
}

/** @param {string} source @param {string} target */
function createWorkflowStepEdge(source, target) {
  return {
    id: createWorkflowEdgeId(),
    source,
    target,
    type: "workflowStep",
  };
}

/**
 * @param {string} parentAgentNodeId
 * @param {string} targetAgentId
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
function findHandoffProxyAgentNode(parentAgentNodeId, targetAgentId, nodes, edges) {
  return (
    nodes.find((node) => {
      if (node.type !== WORKFLOW_NODE_TYPES.AGENT) return false;
      if (node.data?.handoffSourceNodeId !== parentAgentNodeId) return false;
      return edges.some((edge) => edge.source === node.id && edge.target === targetAgentId);
    }) ?? null
  );
}

/**
 * @param {import('@xyflow/react').Node} parentAgent
 * @param {import('@xyflow/react').Node} subAgentNode
 * @param {import('@xyflow/react').Node} targetAgent
 */
function createHandoffProxyAgentNode(parentAgent, subAgentNode, targetAgent) {
  const parentData = /** @type {Record<string, unknown>} */ (parentAgent.data ?? {});
  const position = snapWorkflowPosition({
    x: (subAgentNode.position.x + targetAgent.position.x) / 2,
    y: (subAgentNode.position.y + targetAgent.position.y) / 2,
  });

  return {
    id: createWorkflowNodeId(),
    type: WORKFLOW_NODE_TYPES.AGENT,
    position,
    data: {
      label: typeof parentData.label === "string" ? parentData.label : "智能体",
      description: typeof parentData.description === "string" ? parentData.description : "",
      agentId: typeof parentData.agentId === "string" ? parentData.agentId : null,
      skillOverrides: structuredClone(parentData.skillOverrides ?? { bind: [], unbind: [] }),
      handoffSourceNodeId: parentAgent.id,
      flipX: false,
      flipY: false,
    },
  };
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
