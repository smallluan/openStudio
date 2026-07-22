/**
 * Runtime registry for workflows — reserved for future chat/session integration.
 * Mirrors the pattern of skillRegistry.listSkillsForPicker().
 */
import { loadWorkflowLibrary } from "./workflowsLocalStore.js";
import { normalizeWorkflowDocument } from "./workflowNormalize.js";
import { WORKFLOW_NODE_TYPES } from "./workflowTypes.js";
import { normalizeWorkflowGraph } from "../components/workflow/utils/workflowGraphUtils.js";

/** @typedef {import('./workflowTypes.js').WorkflowDocument} WorkflowDocument */
/** @typedef {import('./workflowTypes.js').WorkflowAgentNodeData} WorkflowAgentNodeData */
/** @typedef {import('./workflowTypes.js').WorkflowSubAgentNodeData} WorkflowSubAgentNodeData */
/** @typedef {{ id: string; name?: string; gatewayAgentId?: string }} RuntimeAgentMeta */
/** @typedef {{ selectedWorkflowId?: string | null; runtime?: WorkflowSessionRuntimeState | null }} WorkflowSessionState */
/** @typedef {{
 *   version: 1;
 *   workflowId: string;
 *   activeNodeIds: string[];
 *   waitingAgentIds: string[];
 *   completedNodeIds: string[];
 *   dispatchStartedAt: number;
 * }} WorkflowSessionRuntimeState
 */
/** @typedef {{
 *   workflowId: string;
 *   requiredAgentIds: string[];
 *   targetAgentIds: string[];
 *   flowFogPrompt: string;
 *   fogByAgentId: Record<string, string>;
 *   runtime: WorkflowSessionRuntimeState;
 * }} WorkflowOrchestrationPlan
 */

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   description: string;
 *   searchText: string;
 * }} WorkflowPickRow
 */

/** @returns {WorkflowDocument[]} */
export function listWorkflowDocuments() {
  const lib = loadWorkflowLibrary();
  return lib.workflows
    .map((w) => normalizeWorkflowDocument(w))
    .filter((w) => w !== null && !w.draft);
}

/** @returns {WorkflowPickRow[]} */
export function listWorkflowsForPicker() {
  return listWorkflowDocuments().map((w) => ({
    id: w.id,
    label: w.name,
    description: w.description,
    searchText: `${w.name} ${w.description}`.toLowerCase(),
  }));
}

/**
 * Resolve effective skill IDs for an agent node at runtime.
 * @param {{ skillIds?: string[] } | null | undefined} agent
 * @param {WorkflowAgentNodeData} nodeData
 * @returns {string[]}
 */
export function resolveAgentNodeSkills(agent, nodeData) {
  const base = new Set(agent?.skillIds ?? []);
  for (const id of nodeData.skillOverrides?.unbind ?? []) base.delete(id);
  for (const id of nodeData.skillOverrides?.bind ?? []) base.add(id);
  return [...base];
}

/** @param {string} workflowId */
export function getWorkflowById(workflowId) {
  const doc = listWorkflowDocuments().find((w) => w.id === workflowId) ?? null;
  if (!doc) return null;
  const normalized = normalizeWorkflowGraph(doc.nodes ?? [], doc.edges ?? []);
  return { ...doc, nodes: normalized.nodes, edges: normalized.edges };
}

/**
 * Collect sub-agent nodes connected in parallel from a parent agent/sub-agent node.
 * @param {string} parentNodeId
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @returns {Array<import('@xyflow/react').Node & { data: WorkflowSubAgentNodeData }>}
 */
export function collectParallelSubAgents(parentNodeId, nodes, edges) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((edge) => edge.source === parentNodeId)
    .map((edge) => nodeById.get(edge.target))
    .filter((node) => node?.type === WORKFLOW_NODE_TYPES.SUB_AGENT);
}

/** @param {unknown} raw @returns {string[]} */
function sanitizeIdList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const v = id.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** @param {unknown} raw @returns {WorkflowSessionRuntimeState | null} */
export function sanitizeWorkflowRuntimeState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const workflowId = typeof r.workflowId === "string" ? r.workflowId.trim() : "";
  if (!workflowId) return null;
  return {
    version: 1,
    workflowId,
    activeNodeIds: sanitizeIdList(r.activeNodeIds),
    waitingAgentIds: sanitizeIdList(r.waitingAgentIds),
    completedNodeIds: sanitizeIdList(r.completedNodeIds),
    dispatchStartedAt:
      typeof r.dispatchStartedAt === "number" && Number.isFinite(r.dispatchStartedAt)
        ? r.dispatchStartedAt
        : 0,
  };
}

/** @param {unknown} raw @returns {WorkflowSessionState | undefined} */
export function sanitizeWorkflowSessionState(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const selectedWorkflowId =
    typeof row.selectedWorkflowId === "string" ? row.selectedWorkflowId.trim().slice(0, 96) : "";
  const runtime = sanitizeWorkflowRuntimeState(row.runtime);
  if (!selectedWorkflowId && !runtime) return undefined;
  return {
    ...(selectedWorkflowId ? { selectedWorkflowId } : {}),
    ...(runtime ? { runtime } : {}),
  };
}

/** @param {import("@xyflow/react").Node | undefined} n */
function isAgentDispatchNode(n) {
  return n?.type === WORKFLOW_NODE_TYPES.AGENT;
}

/** @param {import("@xyflow/react").Node | undefined} n */
function isSubAgentNode(n) {
  return n?.type === WORKFLOW_NODE_TYPES.SUB_AGENT;
}

/** @param {import("@xyflow/react").Node} n */
function isExecutableNode(n) {
  return isAgentDispatchNode(n) || isSubAgentNode(n);
}

/** @param {import("@xyflow/react").Node} n */
function nodeAgentId(n) {
  const data = n?.data && typeof n.data === "object" ? /** @type {Record<string, unknown>} */ (n.data) : null;
  const id = typeof data?.agentId === "string" ? data.agentId.trim() : "";
  return id || "";
}

/**
 * Resolve workflow-stored agent id to current studio agent id.
 * Supports legacy data that may store gatewayAgentId instead of studio id.
 * @param {string} rawAgentId
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function canonicalStudioAgentId(rawAgentId, agentById) {
  const raw = String(rawAgentId ?? "").trim();
  if (!raw) return "";
  if (agentById.has(raw)) return raw;
  for (const [studioId, meta] of agentById.entries()) {
    if (meta?.gatewayAgentId && String(meta.gatewayAgentId).trim().toLowerCase() === raw.toLowerCase()) {
      return studioId;
    }
    if (meta?.name && String(meta.name).trim().toLowerCase() === raw.toLowerCase()) {
      return studioId;
    }
  }
  return raw;
}

/**
 * Resolve a workflow node agent reference to a studio agent record.
 * @param {string} rawAgentId
 * @param {Map<string, RuntimeAgentMeta>} agentById
 * @returns {RuntimeAgentMeta | null}
 */
export function resolveWorkflowAgent(rawAgentId, agentById) {
  const raw = String(rawAgentId ?? "").trim();
  if (!raw) return null;
  const canonical = canonicalStudioAgentId(raw, agentById);
  if (agentById.has(canonical)) return agentById.get(canonical) ?? null;
  const lower = raw.toLowerCase();
  for (const agent of agentById.values()) {
    const name = String(agent.name ?? "").trim().toLowerCase();
    const gateway = String(agent.gatewayAgentId ?? "").trim().toLowerCase();
    if (agent.id === raw || name === lower || gateway === lower) {
      return agent;
    }
  }
  return null;
}

/**
 * @param {import("@xyflow/react").Node | undefined} node
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function dispatchAgentStudioId(node, agentById) {
  if (!node || !isAgentDispatchNode(node)) return "";
  const selfRaw = nodeAgentId(node);
  const resolved = resolveWorkflowAgent(selfRaw, agentById);
  if (resolved) return resolved.id;
  const handoffSourceNodeId = node.data?.handoffSourceNodeId;
  if (typeof handoffSourceNodeId === "string") {
    return "";
  }
  return canonicalStudioAgentId(selfRaw, agentById);
}

/**
 * @param {WorkflowDocument} workflow
 * @returns {{
 *   nodeById: Map<string, import("@xyflow/react").Node>;
 *   incoming: Map<string, string[]>;
 *   outgoing: Map<string, string[]>;
 *   dispatchNodeIds: string[];
 *   executableNodeIds: string[];
 *   allAgentIds: string[];
 * }}
 */
function buildWorkflowGraphIndex(workflow) {
  const nodeById = new Map((workflow.nodes ?? []).map((n) => [n.id, n]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const node of workflow.nodes ?? []) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of workflow.edges ?? []) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }
  const dispatchNodeIds = (workflow.nodes ?? []).filter(isAgentDispatchNode).map((n) => n.id);
  const executableNodeIds = (workflow.nodes ?? []).filter(isExecutableNode).map((n) => n.id);
  const allAgentIds = [...new Set(executableNodeIds.map((id) => nodeAgentId(nodeById.get(id))).filter(Boolean))];
  return { nodeById, incoming, outgoing, dispatchNodeIds, executableNodeIds, allAgentIds };
}

/**
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {string} agentNodeId
 */
function collectDirectSubAgentChildIds(index, agentNodeId) {
  return (index.outgoing.get(agentNodeId) ?? []).filter((id) => isSubAgentNode(index.nodeById.get(id)));
}

/**
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {string} agentNodeId
 */
function findNextDispatchNodesAfterSubAgents(index, agentNodeId) {
  const found = new Set();
  for (const subId of collectDirectSubAgentChildIds(index, agentNodeId)) {
    for (const targetId of index.outgoing.get(subId) ?? []) {
      const node = index.nodeById.get(targetId);
      if (isAgentDispatchNode(node)) found.add(targetId);
    }
  }
  return [...found].map((id) => index.nodeById.get(id)).filter(Boolean);
}

/**
 * Macro-step: same executor across entry agent → sub-agents → same-executor downstream agents.
 * The executor should finish spawn + summarize in one reply before handoff.
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {string} entryDispatchNodeId
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function collectSameAgentDispatchSegment(index, entryDispatchNodeId, agentById) {
  const entry = index.nodeById.get(entryDispatchNodeId);
  if (!isAgentDispatchNode(entry)) return new Set([entryDispatchNodeId]);
  const ownerId = dispatchAgentStudioId(entry, agentById);
  if (!ownerId) return new Set([entryDispatchNodeId]);

  const segment = new Set();
  const queue = [entryDispatchNodeId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (segment.has(nodeId)) continue;
    const node = index.nodeById.get(nodeId);
    if (!node) continue;

    if (isSubAgentNode(node)) {
      segment.add(nodeId);
      for (const nextId of index.outgoing.get(nodeId) ?? []) {
        if (!segment.has(nextId)) queue.push(nextId);
      }
      continue;
    }

    if (isAgentDispatchNode(node)) {
      if (dispatchAgentStudioId(node, agentById) !== ownerId) continue;
      segment.add(nodeId);
      for (const nextId of index.outgoing.get(nodeId) ?? []) {
        if (!segment.has(nextId)) queue.push(nextId);
      }
    }
  }
  return segment;
}

/**
 * Downstream agent nodes after a full same-executor macro-step completes.
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {string} entryDispatchNodeId
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function findSegmentHandoffTargets(index, entryDispatchNodeId, agentById) {
  const segment = collectSameAgentDispatchSegment(index, entryDispatchNodeId, agentById);
  const ownerId = dispatchAgentStudioId(index.nodeById.get(entryDispatchNodeId), agentById);
  /** @type {import("@xyflow/react").Node[]} */
  const targets = [];
  const seen = new Set();
  for (const nodeId of segment) {
    for (const nextId of index.outgoing.get(nodeId) ?? []) {
      if (segment.has(nextId)) continue;
      const next = index.nodeById.get(nextId);
      if (!next || !isAgentDispatchNode(next)) continue;
      const nextAgent = dispatchAgentStudioId(next, agentById);
      if (!nextAgent || nextAgent === ownerId || seen.has(next.id)) continue;
      seen.add(next.id);
      targets.push(next);
    }
  }
  return targets;
}

/**
 * Only expose segment entry nodes on the frontier (never a same-executor summary node alone).
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {string[]} frontier
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function collapseFrontierToSegmentEntries(index, frontier, agentById) {
  if (frontier.length <= 1) return frontier;
  return frontier.filter((nodeId) => {
    return !frontier.some((otherId) => {
      if (otherId === nodeId) return false;
      return collectSameAgentDispatchSegment(index, otherId, agentById).has(nodeId);
    });
  });
}

/**
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {Set<string>} completed
 * @param {string[]} newlyDoneDispatchNodeIds
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function expandCompletionWithSegments(index, completed, newlyDoneDispatchNodeIds, agentById) {
  const next = new Set(completed);
  const seenSegments = new Set();
  for (const nodeId of newlyDoneDispatchNodeIds) {
    const segmentKey = [...collectSameAgentDispatchSegment(index, nodeId, agentById)].sort().join("|");
    if (seenSegments.has(segmentKey)) continue;
    seenSegments.add(segmentKey);
    for (const id of collectSameAgentDispatchSegment(index, nodeId, agentById)) {
      next.add(id);
    }
  }
  return next;
}

/**
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {Set<string>} completed
 * @param {string[]} newlyDoneDispatchNodeIds
 */
function expandCompletionWithSubAgents(index, completed, newlyDoneDispatchNodeIds) {
  const next = new Set(completed);
  for (const nodeId of newlyDoneDispatchNodeIds) {
    next.add(nodeId);
    for (const subId of collectDirectSubAgentChildIds(index, nodeId)) {
      next.add(subId);
    }
  }
  return next;
}

/**
 * @param {string} predId
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {Set<string>} completed
 */
function isPredecessorSatisfied(predId, index, completed) {
  const pred = index.nodeById.get(predId);
  if (!pred) return true;
  if (isSubAgentNode(pred)) return completed.has(predId);
  if (isAgentDispatchNode(pred)) return completed.has(predId);
  return true;
}

/**
 * Handoff proxy nodes that still mirror the parent agent should not become separate runtime steps.
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {Set<string>} completed
 */
function autoCompleteRedundantHandoffProxies(index, completed) {
  let next = new Set(completed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of index.dispatchNodeIds) {
      if (next.has(nodeId)) continue;
      const node = index.nodeById.get(nodeId);
      const sourceId = node?.data?.handoffSourceNodeId;
      if (typeof sourceId !== "string" || !next.has(sourceId)) continue;
      const parent = index.nodeById.get(sourceId);
      if (!parent) continue;
      if (nodeAgentId(node) === nodeAgentId(parent)) {
        next.add(nodeId);
        for (const subId of collectDirectSubAgentChildIds(index, nodeId)) {
          next.add(subId);
        }
        changed = true;
      }
    }
  }
  return next;
}

/**
 * Only AGENT nodes are runtime dispatch steps. SUB_AGENT nodes run inside the parent turn.
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {Set<string>} completed
 */
function resolveDispatchFrontierNodeIds(index, completed) {
  /** @type {string[]} */
  const frontier = [];
  for (const nodeId of index.dispatchNodeIds) {
    if (completed.has(nodeId)) continue;
    const preds = index.incoming.get(nodeId) ?? [];
    const ready = preds.every((pred) => isPredecessorSatisfied(pred, index, completed));
    if (ready) frontier.push(nodeId);
  }
  return frontier;
}

/**
 * @param {string[]} activeNodeIdsRaw
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {Set<string>} completedSet
 */
function normalizeActiveDispatchNodeIds(activeNodeIdsRaw, index, completedSet) {
  const dispatch = activeNodeIdsRaw.filter((id) => isAgentDispatchNode(index.nodeById.get(id)));
  if (dispatch.length) return dispatch;
  return resolveDispatchFrontierNodeIds(index, completedSet);
}

/**
 * @param {import("@xyflow/react").Node | undefined} node
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function nodeTitle(node, agentById) {
  if (!node) return "未知节点";
  const data = node.data && typeof node.data === "object" ? /** @type {Record<string, unknown>} */ (node.data) : {};
  const label = typeof data.label === "string" && data.label.trim() ? data.label.trim() : node.id;
  const task = typeof data.task === "string" ? data.task.trim() : "";
  const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
  const agentId = nodeAgentId(node);
  const resolved = resolveWorkflowAgent(agentId, agentById);
  const agentName = resolved
    ? resolved.name || resolved.gatewayAgentId || resolved.id
    : agentId
      ? agentById.get(agentId)?.name || agentById.get(agentId)?.gatewayAgentId || agentId
      : "";
  const taskBlock = task || prompt;
  const typeLabel = isSubAgentNode(node) ? "子智能体节点" : "智能体节点";
  return `${typeLabel}「${label}」${agentName ? `（执行者：${agentName}）` : ""}${taskBlock ? `：${taskBlock}` : ""}`;
}

/**
 * @param {ReturnType<typeof buildWorkflowGraphIndex>} index
 * @param {string} nodeId
 * @param {Set<string>} completedSet
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
function buildFogForNode(index, nodeId, completedSet, agentById) {
  const node = index.nodeById.get(nodeId);
  if (!node || !isAgentDispatchNode(node)) return "";
  const incomingIds = index.incoming.get(nodeId) ?? [];
  const outgoingIds = index.outgoing.get(nodeId) ?? [];
  const upstream = incomingIds.map((id) => index.nodeById.get(id)).filter(Boolean);
  const subChildren = (index.outgoing.get(nodeId) ?? [])
    .map((id) => index.nodeById.get(id))
    .filter((n) => isSubAgentNode(n));
  const segmentHandoff = findSegmentHandoffTargets(index, nodeId, agentById);
  const downstreamHandoff = segmentHandoff.length
    ? segmentHandoff
    : (index.outgoing.get(nodeId) ?? []).map((id) => index.nodeById.get(id)).filter((n) => isAgentDispatchNode(n));
  const nodeData = node.data && typeof node.data === "object" ? /** @type {Record<string, unknown>} */ (node.data) : {};
  const nodePrompt = typeof nodeData.prompt === "string" ? nodeData.prompt.trim() : "";

  const lines = [
    "## 当前流程片段（迷雾视图）",
    `- 当前节点：${nodeTitle(node, agentById)}`,
  ];
  if (nodePrompt) {
    lines.push("- 当前节点提示词：");
    lines.push(nodePrompt);
  }

  if (upstream.length) {
    lines.push("- 上游节点：");
    for (const up of upstream) {
      const done = completedSet.has(up.id) ? "（已完成）" : "";
      lines.push(`  - ${nodeTitle(up, agentById)} ${done}`.trimEnd());
    }
  } else {
    lines.push("- 上游节点：无（入口链路）");
  }

  if (subChildren.length) {
    lines.push("- 本步骤结构：主智能体 → spawn 子智能体 → 汇总，**必须在同一轮回复内一次性完成**。");
    lines.push("- 本节点内需用 sessions_spawn 召唤以下子智能体（子智能体不是 handoff 目标）：");
    for (const child of subChildren) {
      lines.push(`  - ${nodeTitle(child, agentById)}`);
    }
    lines.push(`- 子智能体数量必须严格等于 ${subChildren.length}。`);
    lines.push("- 约束：只能召唤以上已列出的子智能体，禁止新增未定义的子智能体。");
    lines.push("- 子智能体全部完成后，在本轮内汇总结果；不要再次召唤同一批子智能体。");
    lines.push("- 禁止把本步骤拆成多轮，也不要 handoff 给自己（同一执行者）。");
    if (segmentHandoff.length) {
      lines.push("- 本步骤（spawn+汇总）全部完成后，必须 handoff 给以下下游智能体节点：");
      for (const dn of segmentHandoff) {
        lines.push(`  - ${nodeTitle(dn, agentById)}`);
      }
    }
  } else {
    lines.push("- 约束：当前节点没有定义子智能体，禁止自行新增子智能体。");
    if (downstreamHandoff.length) {
      lines.push("- 完成本节点后，必须 handoff 给以下下游智能体节点：");
      for (const dn of downstreamHandoff) {
        lines.push(`  - ${nodeTitle(dn, agentById)}`);
      }
    } else {
      const hasOutput = (index.outgoing.get(nodeId) ?? []).some(
        (id) => index.nodeById.get(id)?.type === WORKFLOW_NODE_TYPES.OUTPUT,
      );
      if (hasOutput) {
        lines.push("- 下游交接节点：输出（本节点为流程最后一步）");
      } else {
        lines.push("- 下游交接节点：无（可能接近输出）");
      }
    }
  }

  lines.push("- 执行规则：只基于本节点与相邻节点信息工作，不要假设未展示的远端流程细节。");
  lines.push("- 禁止把已完成的子智能体节点当作下游 handoff 目标。");
  return lines.join("\n");
}

/**
 * @param {{
 *   workflowId: string | null | undefined;
 *   sessionState: WorkflowSessionState | null | undefined;
 *   agentById: Map<string, RuntimeAgentMeta>;
 *   dispatchStartedAt?: number;
 *   mentionedAgentIds?: string[];
 * }} args
 * @returns {WorkflowOrchestrationPlan | null}
 */
export function resolveWorkflowOrchestrationPlan({
  workflowId,
  sessionState,
  agentById,
  dispatchStartedAt = Date.now(),
  mentionedAgentIds = [],
}) {
  const id = typeof workflowId === "string" ? workflowId.trim() : "";
  if (!id) return null;
  const workflow = getWorkflowById(id);
  if (!workflow) return null;
  const index = buildWorkflowGraphIndex(workflow);
  const runtime = sanitizeWorkflowRuntimeState(sessionState?.runtime);
  const completedSet = new Set(
    runtime && runtime.workflowId === id ? runtime.completedNodeIds.filter((nid) => index.nodeById.has(nid)) : [],
  );
  const activeNodeIdsRaw =
    runtime && runtime.workflowId === id
      ? runtime.activeNodeIds.filter((nid) => index.nodeById.has(nid) && !completedSet.has(nid))
      : [];
  const activeNodeIds = collapseFrontierToSegmentEntries(
    index,
    activeNodeIdsRaw.length
      ? normalizeActiveDispatchNodeIds(activeNodeIdsRaw, index, completedSet)
      : resolveDispatchFrontierNodeIds(index, completedSet),
    agentById,
  );
  const targetAgentIds = [
    ...new Set(
      activeNodeIds
        .map((nodeId) => dispatchAgentStudioId(index.nodeById.get(nodeId), agentById))
        .filter(Boolean),
    ),
  ];
  const mentionSet = new Set((mentionedAgentIds ?? []).filter(Boolean));
  const userOverridesWorkflow =
    mentionSet.size > 0 && ![...mentionSet].some((mId) => targetAgentIds.includes(mId));
  const fogByAgentId = {};
  for (const nodeId of activeNodeIds) {
    const node = index.nodeById.get(nodeId);
    const agentId = dispatchAgentStudioId(node, agentById);
    if (!agentId) continue;
    const fog = buildFogForNode(index, nodeId, completedSet, agentById);
    if (!fog) continue;
    fogByAgentId[agentId] = fogByAgentId[agentId] ? `${fogByAgentId[agentId]}\n\n${fog}` : fog;
  }
  const flowFogPrompt = [
    "## 工作流编排约束",
    `- 当前工作流：${workflow.name || workflow.id}`,
    `- 本轮待执行智能体节点数：${activeNodeIds.length}`,
    "- 子智能体节点不是独立轮次：只在父智能体节点内通过 sessions_spawn 执行一次。",
    "- 同一执行者的「主智能体→子智能体→汇总」结构算作一个步骤，必须在同一轮回复内完成，不得拆成 main→main 多轮 handoff。",
    "- 你当前处于迷雾模式：只看到了和你相关的局部节点，不要索要完整流程图。",
    "- 每个智能体节点完成后要对下游智能体节点做明确 handoff，并保持上下文最小化。",
    "- 严格按节点编排执行：禁止创建流程图中未定义的额外智能体/子智能体。",
    "- 禁止跳过流程直接给最终答案，禁止用 web_search 等方式代替节点编排。",
    "- 禁止把已完成的子智能体当作下游 handoff 目标。",
  ].join("\n");

  return {
    workflowId: id,
    requiredAgentIds: [
      ...new Set(
        index.dispatchNodeIds
          .map((nodeId) => dispatchAgentStudioId(index.nodeById.get(nodeId), agentById))
          .filter(Boolean),
      ),
    ],
    targetAgentIds: userOverridesWorkflow ? [] : targetAgentIds,
    flowFogPrompt,
    fogByAgentId,
    runtime: {
      version: 1,
      workflowId: id,
      activeNodeIds,
      waitingAgentIds: targetAgentIds,
      completedNodeIds: [...completedSet],
      dispatchStartedAt: dispatchStartedAt > 0 ? dispatchStartedAt : Date.now(),
    },
  };
}

/**
 * Resolve studio agent records for workflow dispatch ids.
 * @param {string[]} agentIds
 * @param {Map<string, RuntimeAgentMeta>} agentById
 * @returns {RuntimeAgentMeta[]}
 */
export function resolveWorkflowAgents(agentIds, agentById) {
  /** @type {RuntimeAgentMeta[]} */
  const out = [];
  const seen = new Set();
  for (const raw of agentIds ?? []) {
    const agent = resolveWorkflowAgent(raw, agentById);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}

/** @param {WorkflowOrchestrationPlan | null | undefined} workflowPlan */
export function workflowPlanRequiresSubagents(workflowPlan) {
  if (!workflowPlan) return false;
  const fog = `${workflowPlan.flowFogPrompt}\n${Object.values(workflowPlan.fogByAgentId ?? {}).join("\n")}`;
  return fog.includes("sessions_spawn 召唤以下子智能体") || fog.includes("子智能体数量必须严格等于");
}

/**
 * Compact workflow context duplicated onto the user turn (survives system-prompt truncation).
 * @param {WorkflowOrchestrationPlan | null | undefined} workflowPlan
 */
export function buildWorkflowUserTurnContext(workflowPlan) {
  if (!workflowPlan) return "";
  const fogBlocks = Object.values(workflowPlan.fogByAgentId ?? {}).filter(Boolean);
  return [
    "## 工作流执行模式（用户已选择，必须执行）",
    "- 用户已在界面选择工作流，本轮必须严格按节点编排执行，不要当作普通闲聊。",
    "- 禁止跳过流程直接回答；禁止用 web_search 等工具代替流程节点。",
    "- 子智能体节点不是独立轮次，只在当前智能体节点内 sessions_spawn 一次。",
    "- 「主智能体→子智能体→汇总」是同一个步骤，一次回复内完成；完成后 handoff 给下游不同执行者（如 111）。",
    workflowPlan.flowFogPrompt,
    ...fogBlocks,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * All studio agent ids referenced by a workflow graph.
 * @param {string} workflowId
 * @param {Map<string, RuntimeAgentMeta>} agentById
 */
export function resolveWorkflowParticipantIds(workflowId, agentById) {
  const id = String(workflowId ?? "").trim();
  if (!id) return [];
  const workflow = getWorkflowById(id);
  if (!workflow) return [];
  const index = buildWorkflowGraphIndex(workflow);
  const studioIds = [];
  for (const nodeId of index.dispatchNodeIds) {
    const studioId = dispatchAgentStudioId(index.nodeById.get(nodeId), agentById);
    if (studioId) studioIds.push(studioId);
  }
  return [...new Set(studioIds)];
}

/**
 * Advance workflow runtime when current waiting agents have replied.
 * @param {{
 *   workflowId: string | null | undefined;
 *   sessionState: WorkflowSessionState | null | undefined;
 *   messages: Array<{ role?: string; agentId?: string; createdAt?: number }>;
 *   agentById?: Map<string, RuntimeAgentMeta>;
 * }} args
 * @returns {WorkflowSessionRuntimeState | null}
 */
export function advanceWorkflowRuntimeByMessages({ workflowId, sessionState, messages, agentById }) {
  const id = typeof workflowId === "string" ? workflowId.trim() : "";
  if (!id) return null;
  const workflow = getWorkflowById(id);
  if (!workflow) return null;
  const runtime = sanitizeWorkflowRuntimeState(sessionState?.runtime);
  if (!runtime || runtime.workflowId !== id) return runtime;
  if (!runtime.waitingAgentIds.length || !runtime.activeNodeIds.length) return runtime;

  const replied = new Set();
  for (const msg of messages ?? []) {
    if (msg?.role !== "assistant") continue;
    const agentId = typeof msg.agentId === "string" ? msg.agentId : "";
    if (!agentId || !runtime.waitingAgentIds.includes(agentId)) continue;
    const createdAt = typeof msg.createdAt === "number" && Number.isFinite(msg.createdAt) ? msg.createdAt : 0;
    if (createdAt >= runtime.dispatchStartedAt) {
      replied.add(agentId);
    }
  }
  if (replied.size === 0) return runtime;

  const index = buildWorkflowGraphIndex(workflow);
  const activeDispatchIds = normalizeActiveDispatchNodeIds(runtime.activeNodeIds, index, new Set(runtime.completedNodeIds));
  const doneNodeIds = activeDispatchIds.filter((nodeId) => {
    const node = index.nodeById.get(nodeId);
    const agentId = dispatchAgentStudioId(node, agentById);
    return agentId && replied.has(agentId);
  });
  if (!doneNodeIds.length) return runtime;

  let completedSet = expandCompletionWithSegments(
    index,
    new Set(runtime.completedNodeIds),
    doneNodeIds,
    agentById,
  );
  completedSet = autoCompleteRedundantHandoffProxies(index, completedSet);
  const nextActiveNodeIds = collapseFrontierToSegmentEntries(
    index,
    resolveDispatchFrontierNodeIds(index, completedSet).filter((nodeId) => !completedSet.has(nodeId)),
    agentById,
  );
  const nextWaitingAgentIds = [
    ...new Set(
      nextActiveNodeIds
        .map((nodeId) => dispatchAgentStudioId(index.nodeById.get(nodeId), agentById))
        .filter(Boolean),
    ),
  ];
  return {
    version: 1,
    workflowId: id,
    completedNodeIds: [...completedSet],
    activeNodeIds: nextActiveNodeIds,
    waitingAgentIds: nextWaitingAgentIds,
    dispatchStartedAt: nextWaitingAgentIds.length ? Date.now() : runtime.dispatchStartedAt,
  };
}

/**
 * Advance workflow runtime and list agents that should receive an automatic handoff reply.
 * @param {{
 *   workflowId: string | null | undefined;
 *   sessionState: WorkflowSessionState | null | undefined;
 *   messages: Array<{ role?: string; agentId?: string; createdAt?: number }>;
 *   agentById?: Map<string, RuntimeAgentMeta>;
 *   triggerAgentId?: string;
 * }} args
 * @returns {{ runtime: WorkflowSessionRuntimeState; handoffAgentIds: string[] } | null}
 */
export function advanceWorkflowAndCollectHandoffs({
  workflowId,
  sessionState,
  messages,
  agentById,
  triggerAgentId = "",
}) {
  const prev = sanitizeWorkflowRuntimeState(sessionState?.runtime);
  const advanced = advanceWorkflowRuntimeByMessages({ workflowId, sessionState, messages, agentById });
  if (!advanced || !prev) return null;
  if (JSON.stringify(prev) === JSON.stringify(advanced)) return null;
  if (!advanced.waitingAgentIds.length) {
    return { runtime: advanced, handoffAgentIds: [] };
  }
  const trigger = String(triggerAgentId ?? "").trim();
  const activeChanged = prev.activeNodeIds.join("|") !== advanced.activeNodeIds.join("|");
  const handoffAgentIds = advanced.waitingAgentIds.filter((agentId) => {
    if (!trigger) return true;
    if (agentId !== trigger) return true;
    // Same executor on the next node only auto-continues when the active dispatch node changed.
    return activeChanged;
  });
  return { runtime: advanced, handoffAgentIds: activeChanged ? handoffAgentIds : [] };
}
