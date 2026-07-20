import { Position } from "@xyflow/react";

/** @param {{ flipX?: boolean; flipY?: boolean } | undefined} data */
export function getWorkflowHandlePositions(data) {
  const flipX = Boolean(data?.flipX);
  return {
    target: flipX ? Position.Right : Position.Left,
    source: flipX ? Position.Left : Position.Right,
  };
}

/** @param {string} nodeId @param {'x' | 'y'} axis @param {import('@xyflow/react').Node[]} nodes @param {import('@xyflow/react').Edge[]} edges */
export function flipWorkflowNode(nodeId, axis, nodes, edges) {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target) return { nodes, edges };

  const data = { ...(target.data ?? {}) };
  if (axis === "x") data.flipX = !data.flipX;
  if (axis === "y") data.flipY = !data.flipY;

  const nextNodes = nodes.map((n) => (n.id === nodeId ? { ...n, data } : n));
  return { nodes: nextNodes, edges };
}

/** @param {string} nodeId @param {import('@xyflow/react').Node[]} nodes @param {import('@xyflow/react').Edge[]} edges */
export function deleteWorkflowNode(nodeId, nodes, edges) {
  return {
    nodes: nodes.filter((n) => n.id !== nodeId),
    edges: edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

/** @param {import('@xyflow/react').Node[]} nodes @param {import('@xyflow/react').Edge[]} edges */
export function deleteWorkflowNodes(nodeIds, nodes, edges) {
  const idSet = new Set(nodeIds);
  return {
    nodes: nodes.filter((n) => !idSet.has(n.id)),
    edges: edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
  };
}

/** @param {import('@xyflow/react').Node[]} nodes @param {import('@xyflow/react').Edge[]} edges */
export function copyWorkflowSubgraph(nodes, edges) {
  const selected = nodes.filter((n) => n.selected);
  if (!selected.length) return null;
  const idSet = new Set(selected.map((n) => n.id));
  const subEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  return {
    nodes: structuredClone(selected),
    edges: structuredClone(subEdges),
  };
}

/**
 * @param {{ nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[] }} clipboard
 * @param {{ x: number; y: number } | undefined} anchorFlow
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
export function pasteWorkflowSubgraph(clipboard, anchorFlow, nodes, edges) {
  if (!clipboard?.nodes?.length) return { nodes, edges };

  const idMap = new Map();
  const minX = Math.min(...clipboard.nodes.map((n) => n.position.x));
  const minY = Math.min(...clipboard.nodes.map((n) => n.position.y));
  const offsetX = anchorFlow ? anchorFlow.x - minX : 32;
  const offsetY = anchorFlow ? anchorFlow.y - minY : 32;

  const pastedNodes = clipboard.nodes.map((n) => {
    const newId = `node-${Date.now()}-${Math.round(Math.random() * 10000)}`;
    idMap.set(n.id, newId);
    return {
      ...n,
      id: newId,
      selected: true,
      position: {
        x: n.position.x + offsetX,
        y: n.position.y + offsetY,
      },
    };
  });

  const pastedEdges = clipboard.edges.map((e) => {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) return null;
    return {
      ...e,
      id: `e-${source}-${target}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      source,
      target,
    };
  }).filter(Boolean);

  const cleared = nodes.map((n) => ({ ...n, selected: false }));
  return {
    nodes: [...cleared, ...pastedNodes],
    edges: [...edges, ...pastedEdges],
  };
}
