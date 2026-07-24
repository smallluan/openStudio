import {
  areSubagentCardsSettled,
  coalesceSubagentActivityRows,
  deriveSubagentRowsFromToolTrace,
  toolTraceAwaitsSubagent,
} from "../chat/toolTraceMerge.js";
import { getWorkflowById, resolveWorkflowAgent } from "./workflowRuntimeRegistry.js";
import { WORKFLOW_NODE_TYPES } from "./workflowTypes.js";

const COMPLETED_PHASES = new Set(["end", "complete", "completed", "ok", "result", "done"]);
const SPAWN_TOOL_RE = /sessions?_spawn/i;

/** @param {unknown} phase */
function isCompletedActivityPhase(phase) {
  return COMPLETED_PHASES.has(String(phase ?? "").trim().toLowerCase());
}

/** @param {import("../chat/toolTraceMerge.js").ActivityRow | undefined} row */
function isSubagentRowRunning(row) {
  if (!row) return false;
  if (Boolean(row.workerStreaming)) return true;
  const phase = String(row.phase ?? "").trim().toLowerCase();
  return phase === "running";
}

/**
 * @param {Record<string, unknown>} message
 * @returns {import("../chat/toolTraceMerge.js").ActivityRow[]}
 */
function collectSubagentRows(message) {
  const activityRows = Array.isArray(message.activityLog) ? message.activityLog : [];
  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const streaming = Boolean(message.streaming);
  const fromLog = activityRows.filter((r) => String(r.stream ?? "").toLowerCase() === "subagent");
  const fromTools = deriveSubagentRowsFromToolTrace(toolRows, { streaming });
  return coalesceSubagentActivityRows(fromLog, fromTools, { streaming });
}

/** @param {Record<string, unknown>} message */
function isSubagentBusyMessage(message) {
  if (!message?.streaming) return false;
  const activityRows = Array.isArray(message.activityLog) ? message.activityLog : [];
  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const parentLifecycleEnded = activityRows.some(
    (r) =>
      String(r.stream ?? "").toLowerCase() === "lifecycle" && isCompletedActivityPhase(r.phase),
  );
  if (parentLifecycleEnded) return false;

  const subRows = collectSubagentRows(message);
  if (subRows.length && areSubagentCardsSettled(subRows)) return false;
  if (subRows.some(isSubagentRowRunning)) return true;
  return toolTraceAwaitsSubagent(toolRows, { subagentCards: subRows });
}

/** @param {Record<string, unknown>} message */
function hasSubagentSpawnStarted(message) {
  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  if (toolRows.some((r) => SPAWN_TOOL_RE.test(String(r.toolName ?? "").trim()))) return true;
  return collectSubagentRows(message).length > 0;
}

/** @param {unknown} value */
function normalizeMatchToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

/**
 * @param {import("@xyflow/react").Node} node
 * @param {import("../chat/toolTraceMerge.js").ActivityRow} row
 */
function matchSubAgentNodeToRow(node, row) {
  const data = node.data && typeof node.data === "object" ? /** @type {Record<string, unknown>} */ (node.data) : {};
  const label = normalizeMatchToken(data.label);
  const task = normalizeMatchToken(data.task);
  const title = normalizeMatchToken(row.title);
  const subTask = normalizeMatchToken(row.subagentTask);

  if (label && title && (label === title || label.includes(title) || title.includes(label))) return true;
  if (label && subTask && (label === subTask || subTask.includes(label) || label.includes(subTask))) return true;
  if (task && subTask && (task === subTask || subTask.includes(task) || task.includes(subTask))) return true;
  if (task && title && (task === title || task.includes(title) || title.includes(task))) return true;
  return false;
}

/**
 * @param {import("@xyflow/react").Node[]} nodes
 */
function sortSubAgentNodesByLayout(nodes) {
  return [...nodes].sort((a, b) => {
    const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
    if (Math.abs(dy) > 8) return dy;
    return (a.position?.x ?? 0) - (b.position?.x ?? 0);
  });
}

/**
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[]} rows
 */
function sortSubagentRows(rows) {
  return [...rows].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
}

/**
 * @param {import("@xyflow/react").Node[]} childNodes
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[]} rows
 * @param {{ runningOnly?: boolean }} [opts]
 */
function matchSubAgentNodesToRows(childNodes, rows, opts = {}) {
  const filtered = opts.runningOnly ? rows.filter(isSubagentRowRunning) : rows;
  /** @type {string[]} */
  const matched = [];
  const seen = new Set();
  const unmatchedRows = [...filtered];
  const unmatchedNodes = [...childNodes];

  for (const row of filtered) {
    const nodeIdx = unmatchedNodes.findIndex((n) => matchSubAgentNodeToRow(n, row));
    if (nodeIdx < 0) continue;
    const node = unmatchedNodes[nodeIdx];
    unmatchedNodes.splice(nodeIdx, 1);
    const rowIdx = unmatchedRows.indexOf(row);
    if (rowIdx >= 0) unmatchedRows.splice(rowIdx, 1);
    if (!seen.has(node.id)) {
      seen.add(node.id);
      matched.push(node.id);
    }
  }

  if (!matched.length && filtered.length === 1 && childNodes.length === 1) {
    matched.push(childNodes[0].id);
    return matched;
  }

  if (unmatchedRows.length && unmatchedNodes.length === unmatchedRows.length) {
    const orderedNodes = sortSubAgentNodesByLayout(unmatchedNodes);
    const orderedRows = sortSubagentRows(unmatchedRows);
    for (let i = 0; i < orderedRows.length; i++) {
      const node = orderedNodes[i];
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      matched.push(node.id);
    }
  }

  return matched;
}

/**
 * @param {string} parentId
 * @param {import("@xyflow/react").Node[]} nodes
 * @param {import("@xyflow/react").Edge[]} edges
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
 * @param {import("@xyflow/react").Node[]} childNodes
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[]} subRows
 * @param {{ runningOnly?: boolean }} [opts]
 */
function resolveSubAgentHighlightIds(childNodes, subRows, opts = {}) {
  const matched = matchSubAgentNodesToRows(childNodes, subRows, opts);
  if (matched.length) return matched;

  const rows = opts.runningOnly ? subRows.filter(isSubagentRowRunning) : subRows;
  if (!rows.length) return [];

  if (childNodes.length && rows.length === childNodes.length) {
    const orderedNodes = sortSubAgentNodesByLayout(childNodes);
    const orderedRows = sortSubagentRows(rows);
    return orderedNodes
      .filter((_, i) => !opts.runningOnly || isSubagentRowRunning(orderedRows[i]))
      .map((n) => n.id);
  }

  if (opts.runningOnly) {
    return sortSubAgentNodesByLayout(childNodes)
      .slice(0, rows.length)
      .map((n) => n.id);
  }

  return childNodes.map((n) => n.id);
}

/**
 * @param {Array<Record<string, unknown>>} messages
 * @param {string} workflowId
 * @param {string} dispatchNodeId
 * @param {Map<string, { id: string; name?: string; gatewayAgentId?: string }>} agentById
 */
function findStreamingAssistantForDispatch(messages, workflowId, dispatchNodeId, agentById) {
  const workflow = getWorkflowById(workflowId);
  if (!workflow) return null;
  const dispatchNode = (workflow.nodes ?? []).find((n) => n.id === dispatchNodeId);
  const data =
    dispatchNode?.data && typeof dispatchNode.data === "object"
      ? /** @type {Record<string, unknown>} */ (dispatchNode.data)
      : {};
  const rawAgentId = typeof data.agentId === "string" ? data.agentId.trim() : "";
  const resolvedAgent = rawAgentId ? resolveWorkflowAgent(rawAgentId, agentById) : null;

  /** @type {Record<string, unknown>[]} */
  const streamingAssistants = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.streaming) continue;
    streamingAssistants.push(m);

    const nodeId = typeof m.workflowNodeId === "string" ? m.workflowNodeId.trim() : "";
    if (nodeId && nodeId === dispatchNodeId) return m;

    const speakerId = typeof m.agentId === "string" ? m.agentId.trim() : "";
    if (resolvedAgent && speakerId === resolvedAgent.id) return m;
  }

  const withSpawn = streamingAssistants.filter((m) => hasSubagentSpawnStarted(m));
  if (withSpawn.length === 1) return withSpawn[0];
  if (streamingAssistants.length === 1) return streamingAssistants[0];
  return withSpawn[0] ?? null;
}

/**
 * @typedef {{
 *   activeHighlightIds: string[];
 *   focusNodeIds: string[];
 *   dispatchNodeIds: string[];
 *   settledSubAgentIds: string[];
 *   hasLiveSignal: boolean;
 * }} WorkflowLiveExecution
 */

/**
 * Resolve which graph nodes should be highlighted/focused from runtime + live chat signals.
 * @param {{
 *   workflowId?: string | null;
 *   runtime?: import("./workflowRuntimeRegistry.js").WorkflowSessionRuntimeState | null;
 *   messages?: Array<Record<string, unknown>>;
 *   agentById?: Map<string, { id: string; name?: string; gatewayAgentId?: string }>;
 * }} args
 * @returns {WorkflowLiveExecution}
 */
export function resolveWorkflowLiveExecution({
  workflowId,
  runtime,
  messages = [],
  agentById = new Map(),
}) {
  const wfId = String(workflowId ?? "").trim();
  const dispatchIds = (runtime?.activeNodeIds ?? []).filter(Boolean);
  if (!wfId || !dispatchIds.length) {
    return {
      activeHighlightIds: [],
      focusNodeIds: [],
      dispatchNodeIds: dispatchIds,
      settledSubAgentIds: [],
      hasLiveSignal: false,
    };
  }

  const workflow = getWorkflowById(wfId);
  if (!workflow) {
    return {
      activeHighlightIds: [],
      focusNodeIds: [],
      dispatchNodeIds: dispatchIds,
      settledSubAgentIds: [],
      hasLiveSignal: false,
    };
  }

  const nodes = workflow.nodes ?? [];
  const edges = workflow.edges ?? [];
  /** @type {Set<string>} */
  const activeHighlightIds = new Set();
  /** @type {Set<string>} */
  const focusNodeIds = new Set();
  /** @type {Set<string>} */
  const settledSubAgentIds = new Set();
  let hasLiveSignal = false;

  for (const dispatchId of dispatchIds) {
    const childIds = collectSubAgentChildIds(dispatchId, nodes, edges);
    const childNodes = childIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
    const streamingMsg = findStreamingAssistantForDispatch(messages, wfId, dispatchId, agentById);

    if (streamingMsg && isSubagentBusyMessage(streamingMsg)) {
      hasLiveSignal = true;
      const subRows = collectSubagentRows(streamingMsg);
      let highlightIds = resolveSubAgentHighlightIds(childNodes, subRows, { runningOnly: true });
      if (!highlightIds.length && hasSubagentSpawnStarted(streamingMsg)) {
        highlightIds = resolveSubAgentHighlightIds(childNodes, subRows, { runningOnly: false });
      }
      if (!highlightIds.length && childIds.length) {
        highlightIds = childIds;
      }
      for (const id of highlightIds) {
        activeHighlightIds.add(id);
        focusNodeIds.add(id);
      }
      continue;
    }

    if (
      streamingMsg &&
      hasSubagentSpawnStarted(streamingMsg) &&
      childIds.length &&
      !isSubagentBusyMessage(streamingMsg)
    ) {
      for (const id of childIds) settledSubAgentIds.add(id);
    }

    if (streamingMsg) hasLiveSignal = true;
    activeHighlightIds.add(dispatchId);
    focusNodeIds.add(dispatchId);
  }

  return {
    activeHighlightIds: [...activeHighlightIds],
    focusNodeIds: [...focusNodeIds],
    dispatchNodeIds: dispatchIds,
    settledSubAgentIds: [...settledSubAgentIds],
    hasLiveSignal,
  };
}
