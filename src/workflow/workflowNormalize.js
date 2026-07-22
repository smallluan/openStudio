import { WORKFLOW_NODE_TYPES } from "./workflowTypes.js";
import { ensureUniqueWorkflowEdgeIds } from "./workflowIds.js";

/** @param {unknown} overrides */
function normalizeSkillOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") {
    return { bind: [], unbind: [] };
  }
  const o = /** @type {{ bind?: unknown; unbind?: unknown }} */ (overrides);
  return {
    bind: Array.isArray(o.bind) ? o.bind.filter((x) => typeof x === "string") : [],
    unbind: Array.isArray(o.unbind) ? o.unbind.filter((x) => typeof x === "string") : [],
  };
}

/** @param {unknown} node */
function normalizeNode(node) {
  if (!node || typeof node !== "object") return null;
  const n = /** @type {Record<string, unknown>} */ (node);
  const id = typeof n.id === "string" ? n.id : "";
  const type = typeof n.type === "string" ? n.type : "";
  if (!id || !type) return null;

  const position =
    n.position && typeof n.position === "object"
      ? {
          x: Number(/** @type {{ x?: unknown }} */ (n.position).x) || 0,
          y: Number(/** @type {{ y?: unknown }} */ (n.position).y) || 0,
        }
      : { x: 0, y: 0 };

  const rawData = n.data && typeof n.data === "object" ? { .../** @type {Record<string, unknown>} */ (n.data) } : {};

  if (type === WORKFLOW_NODE_TYPES.AGENT) {
    rawData.agentId = typeof rawData.agentId === "string" ? rawData.agentId : null;
    rawData.skillOverrides = normalizeSkillOverrides(rawData.skillOverrides);
    rawData.handoffSourceNodeId =
      typeof rawData.handoffSourceNodeId === "string" ? rawData.handoffSourceNodeId : null;
    rawData.label = typeof rawData.label === "string" ? rawData.label : "智能体节点";
  } else if (type === WORKFLOW_NODE_TYPES.NESTED) {
    rawData.workflowId = typeof rawData.workflowId === "string" ? rawData.workflowId : null;
    rawData.label = typeof rawData.label === "string" ? rawData.label : "嵌套工作流";
  } else if (type === WORKFLOW_NODE_TYPES.SUB_AGENT) {
    rawData.agentId = typeof rawData.agentId === "string" ? rawData.agentId : null;
    rawData.task = typeof rawData.task === "string" ? rawData.task : "";
    rawData.label = typeof rawData.label === "string" ? rawData.label : "子智能体";
  } else if (type === WORKFLOW_NODE_TYPES.INPUT) {
    rawData.label = typeof rawData.label === "string" ? rawData.label : "输入";
  } else if (type === WORKFLOW_NODE_TYPES.OUTPUT) {
    rawData.label = typeof rawData.label === "string" ? rawData.label : "输出";
  }

  rawData.description = typeof rawData.description === "string" ? rawData.description : "";
  rawData.prompt = typeof rawData.prompt === "string" ? rawData.prompt : "";
  rawData.flipX = Boolean(rawData.flipX);
  rawData.flipY = Boolean(rawData.flipY);

  return {
    id,
    type,
    position,
    data: rawData,
  };
}

/** @param {unknown} edge */
function normalizeEdge(edge) {
  if (!edge || typeof edge !== "object") return null;
  const e = /** @type {Record<string, unknown>} */ (edge);
  const id = typeof e.id === "string" ? e.id : "";
  const source = typeof e.source === "string" ? e.source : "";
  const target = typeof e.target === "string" ? e.target : "";
  if (!id || !source || !target) return null;
  return { id, source, target };
}

/** @param {unknown} raw */
export function normalizeWorkflowDocument(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof o.id === "string" ? o.id : "";
  if (!id) return null;

  const nodes = Array.isArray(o.nodes) ? o.nodes.map(normalizeNode).filter(Boolean) : [];
  const edgesRaw = Array.isArray(o.edges) ? o.edges.map(normalizeEdge).filter(Boolean) : [];
  const edges = ensureUniqueWorkflowEdgeIds(edgesRaw);

  const viewport =
    o.viewport && typeof o.viewport === "object"
      ? {
          x: Number(/** @type {{ x?: unknown }} */ (o.viewport).x) || 0,
          y: Number(/** @type {{ y?: unknown }} */ (o.viewport).y) || 0,
          zoom: Number(/** @type {{ zoom?: unknown }} */ (o.viewport).zoom) || 1,
        }
      : undefined;

  const now = Date.now();
  return {
    id,
    name: typeof o.name === "string" ? o.name.trim() : "",
    description: typeof o.description === "string" ? o.description : "",
    draft: o.draft === true,
    nodes,
    edges,
    viewport,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
  };
}
