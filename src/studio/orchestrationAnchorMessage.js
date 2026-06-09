import { resolveOrchestrationEventTitle } from "./orchestrationEventLabel.js";
import { preferLongerAssistantText } from "../chat/streamTimelineMerge.js";

/**
 * @param {unknown} m
 * @param {import("./orchestration.js").OrchestrationRun | null | undefined} run
 */
export function messageBelongsToOrchestrationRun(m, run) {
  if (!m || typeof m !== "object" || !run) return false;
  const row = /** @type {Record<string, unknown>} */ (m);
  const runId = run.runId;
  if (typeof row.orchestrationRunId === "string" && row.orchestrationRunId) {
    if (row.orchestrationRunId === runId) return true;
    // Stale/mismatched run id on old rows — fall back to timestamp window.
    if (typeof run.startedAt === "number" && typeof row.createdAt === "number") {
      return row.createdAt >= run.startedAt;
    }
    return false;
  }
  if (typeof run.startedAt === "number" && typeof row.createdAt === "number") {
    return row.createdAt >= run.startedAt;
  }
  return false;
}

/** Status-line orchestration events saved before messageKind existed. */
const LEGACY_ORCH_EVENT_RE =
  /^(?:调度已启动|主智能体正在|计划已|已将\s+\*\*|已完成\s+\*\*|调度流程已完成|调度失败|调度已继续|需要产品经理|未找到产品经理|已分发给|已将调研|Orchestration started|Lead agent is|Plan (?:ready|accepted|rejected)|Assigned\s+\*\*|Completed\s+\*\*|Orchestration completed)/i;

/** @param {unknown} m @param {string | null | undefined} mainAgentId */
function isLegacyOrchestrationEventMessage(m, mainAgentId) {
  if (!m || typeof m !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (m);
  if (row.messageKind) return false;
  if (row.role !== "assistant") return false;
  if (mainAgentId && row.agentId && row.agentId !== mainAgentId) return false;
  const text = String(row.content ?? "").trim();
  if (!text || text.length > 600) return false;
  if (Array.isArray(row.toolTrace) && row.toolTrace.length) return false;
  if (Array.isArray(row.assistantTimeline) && row.assistantTimeline.length) return false;
  return LEGACY_ORCH_EVENT_RE.test(text);
}

/** @param {unknown} m */
function isLegacyWorkerOrchMessage(m) {
  if (!m || typeof m !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (m);
  if (row.orchestrationPhase) return true;
  if (row.orchestrationTaskId) return true;
  const text = String(row.content ?? "").trim();
  return /^我来完成\s*Phase\s*\d+/i.test(text) || /^I(?:'ll| will)\s+(?:complete|work on)\s+Phase\s*\d+/i.test(text);
}

/** @param {import("../chat/chatSessionsStore.js").ChatSessionRecord | null | undefined} rec */
export function isOrchestrationSessionBusy(rec) {
  if (!rec?.orchestrationMode || !rec?.orchestration) return false;
  return ["planning", "revising", "running", "awaiting_approval", "paused"].includes(rec.orchestration.status);
}

/** @param {unknown} m */
/**
 * @param {unknown} m
 * @param {string | null | undefined} [mainAgentId]
 */
function isOrchestrationMarkedMessage(m, mainAgentId = null) {
  if (!m || typeof m !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (m);
  if (
    row.messageKind === "orchestration_event" ||
    row.messageKind === "orchestration_internal" ||
    row.messageKind === "orchestration_plan"
  ) {
    return true;
  }
  if (typeof row.orchestrationRunId === "string" && row.orchestrationRunId.trim()) return true;
  if (typeof row.orchestrationTaskId === "string" && row.orchestrationTaskId.trim()) return true;
  const phase = row.orchestrationPhase;
  if (
    phase === "triage" ||
    phase === "pm_research" ||
    phase === "development" ||
    phase === "work" ||
    phase === "review" ||
    phase === "rollup"
  ) {
    return true;
  }
  if (isLegacyOrchestrationEventMessage(m, mainAgentId)) return true;
  if (isLegacyWorkerOrchMessage(m)) return true;
  return false;
}

/**
 * Upgrade legacy rows so tucking / activity log work after reload.
 * @param {Array<Record<string, unknown>>} messages
 * @param {string | null | undefined} mainAgentId
 */
export function normalizeMessagesForOrchestrationUi(messages, mainAgentId = null) {
  let changed = false;
  const out = messages.map((m) => {
    if (m.messageKind === "orchestration_event" || m.messageKind === "orchestration_internal") {
      return m;
    }
    if (!m.messageKind && isLegacyOrchestrationEventMessage(m, mainAgentId)) {
      changed = true;
      return { ...m, messageKind: /** @type {const} */ ("orchestration_event") };
    }
    if (isLegacyWorkerOrchMessage(m) && !m.orchestrationPhase) {
      changed = true;
      return { ...m, orchestrationPhase: /** @type {const} */ ("development") };
    }
    return m;
  });
  return { messages: out, changed };
}

/**
 * @param {Array<Record<string, unknown>>} messages
 */
export function hasOrchestrationTimelineMessages(messages, mainAgentId = null) {
  return messages.some((m) => isOrchestrationMarkedMessage(m, mainAgentId));
}

/**
 * Rebuild a minimal run from persisted messages when session.orchestration was lost.
 * @param {Array<Record<string, unknown>>} messages
 * @param {import("./orchestration.js").OrchestrationRun | null | undefined} sessionRun
 * @returns {import("./orchestration.js").OrchestrationRun | null}
 */
export function inferOrchestrationRunFromMessages(messages, sessionRun = null, mainAgentId = null) {
  const marked = messages.filter((m) => isOrchestrationMarkedMessage(m, mainAgentId));
  if (!marked.length) return sessionRun?.runId ? sessionRun : null;

  const runIds = marked
    .map((m) => (typeof m.orchestrationRunId === "string" ? m.orchestrationRunId.trim() : ""))
    .filter(Boolean);
  const runId =
    runIds[0] ||
    (typeof marked[0].id === "string" ? `inferred_${marked[0].id}` : `inferred_${Date.now()}`);

  const times = marked
    .map((m) => (typeof m.createdAt === "number" ? m.createdAt : NaN))
    .filter((n) => Number.isFinite(n));
  const startedAt = times.length ? Math.min(...times) : Date.now();

  const events = messages.filter((m) => m.messageKind === "orchestration_event");
  const lastKey =
    events.length && typeof events[events.length - 1].orchestrationEventKey === "string"
      ? events[events.length - 1].orchestrationEventKey
      : "";

  /** @type {import("./orchestration.js").OrchestrationRunStatus} */
  let status = "running";
  if (lastKey === "completed") status = "completed";
  else if (lastKey === "failed") status = "failed";
  else if (lastKey === "awaiting_approval") status = "awaiting_approval";
  else if (lastKey === "plan_revising") status = "revising";
  else if (lastKey === "started" || lastKey === "analyzing" || lastKey === "synthesizing_plan") {
    status = "planning";
  } else if (lastKey === "resumed") status = "running";

  const planFromMsg = messages.find(
    (m) => m.messageKind === "orchestration_plan" && m.orchestrationPlan,
  );

  return {
    runId,
    status,
    userRequirement: sessionRun?.userRequirement || "",
    plan:
      sessionRun?.plan ||
      (planFromMsg?.orchestrationPlan
        ? /** @type {import("./orchestration.js").OrchestrationPlan} */ (planFromMsg.orchestrationPlan)
        : null),
    activeTaskId: sessionRun?.activeTaskId ?? null,
    reviewResults: sessionRun?.reviewResults ?? {},
    startedAt,
    updatedAt: sessionRun?.updatedAt ?? (times.length ? Math.max(...times) : startedAt),
  };
}

/**
 * @param {import("./orchestration.js").OrchestrationRun | null | undefined} sessionRun
 * @param {Array<Record<string, unknown>>} messages
 */
export function resolveOrchestrationRunForTimeline(sessionRun, messages, mainAgentId = null) {
  const marked = messages.filter((m) => isOrchestrationMarkedMessage(m, mainAgentId));
  if (!marked.length) {
    return sessionRun?.runId ? sessionRun : null;
  }

  const msgRunIds = marked
    .map((m) => (typeof m.orchestrationRunId === "string" ? m.orchestrationRunId.trim() : ""))
    .filter(Boolean);
  const dominantRunId = msgRunIds[0] || "";

  if (sessionRun?.runId) {
    if (!dominantRunId || dominantRunId === sessionRun.runId) return sessionRun;
  }

  return inferOrchestrationRunFromMessages(messages, sessionRun ?? null, mainAgentId);
}

export function isOrchestrationTuckedMessage(m, ctx = {}) {
  if (!m || typeof m !== "object") return false;

  const row = /** @type {Record<string, unknown>} */ (m);
  const run = ctx.orchestrationRun;
  const orchestrationMode = Boolean(ctx.orchestrationMode);

  if (row.messageKind === "orchestration_anchor") return false;
  if (row.role === "user") return false;
  if (row.messageKind === "orchestration_plan") return false;

  // Any assistant output scoped to the active run belongs inside the anchor timeline.
  if (
    run &&
    row.role === "assistant" &&
    messageBelongsToOrchestrationRun(m, run)
  ) {
    return true;
  }

  if (!isOrchestrationMarkedMessage(m, ctx.mainAgentId ?? null)) return false;

  if (run && messageBelongsToOrchestrationRun(m, run)) return true;

  // Session store may lag behind live runner events — still tuck marked rows while orchestration mode is on.
  if (orchestrationMode) return true;

  // Legacy / repaired rows without run metadata but clearly orchestration content.
  if (isLegacyOrchestrationEventMessage(m, ctx.mainAgentId ?? null)) return true;
  if (isLegacyWorkerOrchMessage(m)) return true;

  return false;
}



/**
 * Overlay live gateway stream slices onto tucked orchestration worker rows so the
 * anchor activity log reflects partial model output before React message sync.
 * @param {Array<Record<string, unknown>>} messages
 * @param {Array<{
 *   active?: boolean;
 *   assistantMessageId?: string;
 *   content?: string;
 *   thinking?: string;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }>} slices
 */
export function overlayGatewayStreamSlicesOnMessages(messages, slices) {
  if (!Array.isArray(messages) || !Array.isArray(slices) || !slices.length) return messages;

  /** @type {Map<string, (typeof slices)[number]>} */
  const byAssistantId = new Map();
  for (const s of slices) {
    const id = typeof s?.assistantMessageId === "string" ? s.assistantMessageId.trim() : "";
    if (!id) continue;
    const hasTimeline = Array.isArray(s.assistantTimeline) && s.assistantTimeline.length > 0;
    const hasActivity = Array.isArray(s.activityLog) && s.activityLog.length > 0;
    if (
      !s.active &&
      !String(s.content ?? "").trim() &&
      !String(s.thinking ?? "").trim() &&
      !hasTimeline &&
      !hasActivity
    ) {
      continue;
    }
    byAssistantId.set(id, s);
  }
  if (!byAssistantId.size) return messages;

  let changed = false;
  const out = messages.map((m) => {
    const id = String(m.id ?? "");
    const slice = byAssistantId.get(id);
    if (!slice) return m;
    changed = true;
    const content = preferLongerAssistantText(String(m.content ?? ""), String(slice.content ?? ""));
    const thinking = preferLongerAssistantText(String(m.thinking ?? ""), String(slice.thinking ?? ""));
    const prevTimeline = Array.isArray(m.assistantTimeline) ? m.assistantTimeline : [];
    const sliceTimeline = Array.isArray(slice.assistantTimeline) ? slice.assistantTimeline : [];
    const assistantTimeline =
      sliceTimeline.length >= prevTimeline.length ? sliceTimeline : prevTimeline;
    /** @type {Record<string, unknown>} */
    const row = {
      ...m,
      content,
      thinking,
      streaming: slice.active ? true : m.streaming,
    };
    if (assistantTimeline.length) row.assistantTimeline = assistantTimeline;
    if (Array.isArray(slice.toolTrace) && slice.toolTrace.length) row.toolTrace = slice.toolTrace;
    if (Array.isArray(slice.activityLog) && slice.activityLog.length) row.activityLog = slice.activityLog;
    return row;
  });
  return changed ? out : messages;
}



/**

 * @param {Array<Record<string, unknown>>} messages

 */

function indexOrchestrationMessages(messages, run) {

  /** @type {Map<string, Record<string, unknown>>} */

  const pmByAgent = new Map();

  /** @type {Map<string, Array<Record<string, unknown>>>} */

  const byTask = new Map();

  /** @type {Record<string, unknown> | null} */

  let rollupMsg = null;

  /** @type {Record<string, unknown> | null} */

  let latestInternal = null;

  /** @type {Record<string, unknown> | null} */

  let triageInternal = null;

  /** @type {Record<string, unknown> | null} */

  let synthInternal = null;

  /** @type {Array<Record<string, unknown>>} */
  const triageByOrder = [];

  /** @type {Array<Record<string, unknown>>} */
  const synthByOrder = [];

  for (const m of messages) {

    if (!messageBelongsToOrchestrationRun(m, run)) continue;

    if (m.messageKind === "orchestration_internal") {
      latestInternal = m;
      if (m.orchestrationPhase === "triage") triageInternal = m;
      else if (m.orchestrationPhase === "plan_synthesis") synthInternal = m;
    }

    if (m.orchestrationPhase === "triage") triageByOrder.push(m);
    if (m.orchestrationPhase === "plan_synthesis") synthByOrder.push(m);

    if (m.orchestrationPhase === "rollup") rollupMsg = m;

    if (
      m.messageKind !== "orchestration_event" &&
      (m.orchestrationPhase === "pm_research" || m.orchestrationPhase === "pre_research") &&
      m.agentId
    ) {

      pmByAgent.set(String(m.agentId), m);

    }

    if (
      typeof m.orchestrationTaskId === "string" &&
      m.orchestrationTaskId &&
      m.messageKind !== "orchestration_event"
    ) {

      const arr = byTask.get(m.orchestrationTaskId) ?? [];

      arr.push(m);

      byTask.set(m.orchestrationTaskId, arr);

    }

  }

  const byCreatedAt = (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  triageByOrder.sort(byCreatedAt);
  synthByOrder.sort(byCreatedAt);

  return {
    pmByAgent,
    byTask,
    rollupMsg,
    latestInternal,
    triageInternal,
    synthInternal,
    triageByOrder,
    synthByOrder,
  };

}



/** @param {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} timeline */
function timelinePlainText(timeline) {
  if (!Array.isArray(timeline)) return "";
  /** @type {string[]} */
  const parts = [];
  for (const seg of timeline) {
    if (!seg || typeof seg !== "object") continue;
    const body = typeof seg.content === "string" ? seg.content.trim() : "";
    if (body) parts.push(body);
  }
  return parts.join("\n\n");
}

/** @param {string} s */
function normalizeOrchLabel(s) {

  return String(s ?? "")

    .replace(/\*\*/g, "")

    .replace(/\s+/g, " ")

    .trim();

}



/**

 * @param {Array<Record<string, unknown>>} parts

 */

function mergeWorkerMessageDetails(parts) {

  /** @type {Map<string, import("../chat/toolTraceMerge.js").ToolTraceRow>} */

  const toolMap = new Map();

  /** @type {import("../chat/toolTraceMerge.js").ActivityRow[]} */

  const nestedActivity = [];

  let workerStreaming = false;

  const textParts = /** @type {string[]} */ ([]);

  /** @type {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */

  let assistantTimeline = [];



  for (const p of parts) {

    if (p.streaming) workerStreaming = true;

    const content = String(p.content ?? "").trim();

    const thinking = String(p.thinking ?? "").trim();

    if (content) textParts.push(content);
    if (thinking && thinking !== content) textParts.push(thinking);

    if (Array.isArray(p.toolTrace)) {

      for (const row of p.toolTrace) {

        if (row && typeof row === "object" && row.id) toolMap.set(String(row.id), row);

      }

    }

    if (Array.isArray(p.activityLog)) {

      for (const row of p.activityLog) {

        if (row && typeof row === "object") nestedActivity.push(row);

      }

    }

    if (Array.isArray(p.assistantTimeline) && p.assistantTimeline.length >= assistantTimeline.length) {

      assistantTimeline = /** @type {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */ (

        p.assistantTimeline

      );

    }

  }



  const toolTrace = [...toolMap.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  nestedActivity.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  if (!textParts.length && assistantTimeline.length) {
    const fromTimeline = timelinePlainText(assistantTimeline);
    if (fromTimeline) textParts.push(fromTimeline);
  }

  return {

    text: textParts.join("\n\n"),

    toolTrace,

    nestedActivity,

    assistantTimeline,

    workerStreaming,

  };

}



/**
 * @param {string | undefined} key
 * @param {Record<string, unknown>} eventMsg
 * @param {ReturnType<typeof indexOrchestrationMessages>} indexed
 * @param {{ triage: number; plan_synthesis: number }} phaseSlots
 * @returns {{ detail: ReturnType<typeof mergeWorkerMessageDetails>; boundMessageId: string | null }}
 */
function workerDetailsForEvent(key, eventMsg, indexed, phaseSlots) {
  /** @type {Record<string, unknown> | null} */
  let boundMessage = null;

  if (key === "analyzing") {
    boundMessage = indexed.triageByOrder[phaseSlots.triage] ?? indexed.triageByOrder.at(-1) ?? indexed.triageInternal;
    if (boundMessage) {
      phaseSlots.triage += 1;
      return {
        detail: mergeWorkerMessageDetails([boundMessage]),
        boundMessageId: String(boundMessage.id ?? "") || null,
      };
    }
  }

  if (key === "pre_task_start" || key === "task_assigned") {
    // Assignment rows are one-shot status updates:
    // no detail payload and never rebound to worker output.
    return { detail: mergeWorkerMessageDetails([]), boundMessageId: null };
  }

  if (key === "pm_start" && eventMsg.orchestrationWorkerId) {

    boundMessage = indexed.pmByAgent.get(String(eventMsg.orchestrationWorkerId)) ?? null;

    return {
      detail: mergeWorkerMessageDetails(boundMessage ? [boundMessage] : []),
      boundMessageId: boundMessage ? String(boundMessage.id ?? "") || null : null,
    };

  }

  if (

    (key === "pre_task_running" ||
      key === "task_start" ||
      key === "pre_task_done" ||
      key === "task_done" ||
      key === "review_passed" ||
      key === "review_rework" ||
      key === "review_blocked") &&

    eventMsg.orchestrationTaskId

  ) {

    const parts = indexed.byTask.get(String(eventMsg.orchestrationTaskId)) ?? [];
    boundMessage = parts[parts.length - 1] ?? null;

    return {
      detail: mergeWorkerMessageDetails(parts),
      boundMessageId: boundMessage ? String(boundMessage.id ?? "") || null : null,
    };

  }

  if (key === "rollup" && indexed.rollupMsg) {

    boundMessage = indexed.rollupMsg;

    return {
      detail: mergeWorkerMessageDetails([indexed.rollupMsg]),
      boundMessageId: String(indexed.rollupMsg.id ?? "") || null,
    };

  }

  if (key === "synthesizing_plan") {
    boundMessage = indexed.synthByOrder[phaseSlots.plan_synthesis] ?? null;
    if (boundMessage) {
      phaseSlots.plan_synthesis += 1;
      return {
        detail: mergeWorkerMessageDetails([boundMessage]),
        boundMessageId: String(boundMessage.id ?? "") || null,
      };
    }
  }

  if (key === "awaiting_approval") {
    boundMessage = indexed.synthByOrder.at(-1) ?? indexed.synthInternal ?? null;
    if (boundMessage) {
      return {
        detail: mergeWorkerMessageDetails([boundMessage]),
        boundMessageId: String(boundMessage.id ?? "") || null,
      };
    }
  }

  return { detail: mergeWorkerMessageDetails([]), boundMessageId: null };

}

/**
 * @param {ReturnType<typeof mergeWorkerMessageDetails>} detail
 * @returns {Record<string, unknown>}
 */
function detailAsMessageLike(detail) {
  return {
    content: detail.text,
    thinking: "",
    assistantTimeline: detail.assistantTimeline,
    toolTrace: detail.toolTrace,
    activityLog: detail.nestedActivity,
    streaming: detail.workerStreaming,
  };
}

/** @type {Record<string, string>} */
const ORCH_EVENT_PHASE = {
  analyzing: "triage",
  synthesizing_plan: "plan_synthesis",
  awaiting_approval: "plan_approval",
};

/** Event keys whose steps stay open until a matching terminal task event. */
const ORCH_TASK_OPEN_KEYS = new Set(["task_start", "review_rework", "pre_task_running"]);

/** Event keys that close an open task step. */
const ORCH_TASK_CLOSE_KEYS = new Set([
  "task_done",
  "pre_task_done",
  "review_passed",
  "review_blocked",
]);

/** Assignment-only events that should complete immediately. */
const ORCH_ASSIGNMENT_KEYS = new Set(["task_assigned", "pre_task_start"]);

/** Orchestration steps whose streamed output belongs under the main-agent step row (not the side panel). */
export const ORCH_MAIN_LEAD_STEP_KEYS = new Set(["analyzing", "synthesizing_plan", "rollup"]);

/**
 * @param {Array<Record<string, unknown>>} events
 * @param {import("./orchestration.js").OrchestrationRun} run
 * @returns {Set<string>}
 */
function buildOpenOrchestrationTaskIds(events, run) {
  /** @type {Set<string>} */
  const open = new Set();
  for (const m of events) {
    const key = typeof m.orchestrationEventKey === "string" ? m.orchestrationEventKey : "";
    const taskId =
      typeof m.orchestrationTaskId === "string" && m.orchestrationTaskId.trim()
        ? m.orchestrationTaskId.trim()
        : "";
    if (!taskId) continue;
    if (ORCH_TASK_OPEN_KEYS.has(key)) open.add(taskId);
    if (ORCH_TASK_CLOSE_KEYS.has(key)) open.delete(taskId);
  }
  if (run?.plan?.tasks) {
    for (const task of run.plan.tasks) {
      if (task.status === "in_progress") open.add(task.id);
    }
  }
  if (Array.isArray(run?.activeTaskIds)) {
    for (const id of run.activeTaskIds) {
      if (typeof id === "string" && id.trim()) open.add(id.trim());
    }
  }
  return open;
}

/**
 * @param {string} key
 * @param {string} taskId
 * @param {Set<string>} openTaskIds
 * @param {ReturnType<typeof mergeWorkerMessageDetails>} detail
 * @param {{ orchestrationBusy?: boolean; isLast?: boolean }} opts
 */
function resolveOrchestrationStepPhase(key, taskId, openTaskIds, detail, opts = {}) {
  const runPaused = opts.runStatus === "paused";
  if (detail.workerStreaming && !runPaused) return "running";
  if (ORCH_ASSIGNMENT_KEYS.has(key)) {
    if (taskId && openTaskIds.has(taskId) && !runPaused) return "running";
    return "end";
  }
  if (taskId && openTaskIds.has(taskId)) return runPaused ? "end" : "running";
  const leadKeys = new Set([
    "analyzing",
    "synthesizing_plan",
    "awaiting_approval",
    "pre_task_running",
    "rollup",
  ]);
  if (leadKeys.has(key) && opts.isLast && opts.orchestrationBusy) return "running";
  if (ORCH_TASK_OPEN_KEYS.has(key) && opts.isLast && opts.orchestrationBusy) return "running";
  return "end";
}

/**
 * @param {Array<Record<string, unknown>>} messages
 * @param {import("./orchestration.js").OrchestrationRun} run
 * @param {ReturnType<typeof indexOrchestrationMessages>} indexed
 */
function resolveFailedOrchestrationError(messages, run, indexed) {
  const triageMsg = indexed.triageInternal ?? indexed.triageByOrder.at(-1);
  const triageErr =
    triageMsg && typeof triageMsg.error === "string" ? triageMsg.error.trim() : "";
  if (triageErr) return triageErr;

  const failedEvent = messages.find(
    (m) =>
      m.messageKind === "orchestration_event" &&
      m.orchestrationEventKey === "failed" &&
      messageBelongsToOrchestrationRun(m, run),
  );
  const payload = failedEvent?.orchestrationEventPayload;
  if (payload && typeof payload === "object" && typeof payload.message === "string") {
    return payload.message.trim();
  }
  return "";
}

/**
 * Merge all live gateway slices tied to a task's worker messages.
 * @param {ReturnType<typeof mergeWorkerMessageDetails>} detail
 * @param {Array<{
 *   active?: boolean;
 *   assistantMessageId?: string;
 *   content?: string;
 *   thinking?: string;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }>} liveSlices
 * @param {string | null | undefined} boundMessageId
 * @param {ReturnType<typeof indexOrchestrationMessages>} indexed
 * @param {string} taskId
 */
function enrichDetailWithTaskLiveSlices(detail, liveSlices, boundMessageId, indexed, taskId) {
  let next = detail;
  const messageIds = new Set();
  const boundId = typeof boundMessageId === "string" ? boundMessageId.trim() : "";
  if (boundId) messageIds.add(boundId);
  if (taskId) {
    for (const part of indexed.byTask.get(taskId) ?? []) {
      const id = String(part.id ?? "").trim();
      if (id) messageIds.add(id);
    }
  }
  for (const msgId of messageIds) {
    next = mergeDetailFromLiveSlice(next, liveSlices, msgId, { requireActive: true });
    if (!next.workerStreaming && !next.text && !next.assistantTimeline.length) {
      next = mergeDetailFromLiveSlice(next, liveSlices, msgId, { requireActive: false });
    }
  }
  return next;
}

/**
 * Merge a live gateway slice into worker detail when ids match.
 * @param {ReturnType<typeof mergeWorkerMessageDetails>} detail
 * @param {Array<{
 *   active?: boolean;
 *   assistantMessageId?: string;
 *   content?: string;
 *   thinking?: string;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }>} liveSlices
 * @param {string | null | undefined} boundMessageId
 * @param {{ requireActive?: boolean }} [opts]
 */
function mergeDetailFromLiveSlice(detail, liveSlices, boundMessageId, opts = {}) {
  const requireActive = opts.requireActive !== false;
  const boundId = typeof boundMessageId === "string" ? boundMessageId.trim() : "";
  if (!boundId || !Array.isArray(liveSlices) || !liveSlices.length) return detail;

  for (const s of liveSlices) {
    if (requireActive && !s?.active) continue;
    const msgId = typeof s.assistantMessageId === "string" ? s.assistantMessageId.trim() : "";
    if (!msgId || msgId !== boundId) continue;
    return mergeWorkerMessageDetails([
      detailAsMessageLike(detail),
      {
        content: s.content,
        thinking: s.thinking,
        assistantTimeline: s.assistantTimeline,
        toolTrace: s.toolTrace,
        activityLog: s.activityLog,
        streaming: Boolean(s.active),
      },
    ]);
  }
  return detail;
}

/**
 * Attach live gateway slice to the tail step when ids match (or phase fallback before worker row exists).
 * @param {string | undefined} key
 * @param {ReturnType<typeof mergeWorkerMessageDetails>} detail
 * @param {Array<{
 *   active?: boolean;
 *   assistantMessageId?: string;
 *   content?: string;
 *   thinking?: string;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }>} liveSlices
 * @param {{ isLast?: boolean; boundMessageId?: string | null; run?: import("./orchestration.js").OrchestrationRun | null }} opts
 */
function augmentDetailFromLiveSlice(key, detail, liveSlices, opts = {}) {
  if (!opts.isLast) return detail;
  if (!Array.isArray(liveSlices) || !liveSlices.length) return detail;

  const leadKeys = new Set([
    "analyzing",
    "synthesizing_plan",
    "awaiting_approval",
    "pre_task_running",
    "task_start",
    "review_rework",
  ]);
  if (!leadKeys.has(String(key ?? ""))) return detail;

  const boundId = typeof opts.boundMessageId === "string" ? opts.boundMessageId.trim() : "";
  if (boundId) {
    return mergeDetailFromLiveSlice(detail, liveSlices, boundId, { requireActive: true });
  }

  const expectedPhase = ORCH_EVENT_PHASE[String(key ?? "")];
  const currentPhase = typeof opts.run?.currentPhase === "string" ? opts.run.currentPhase : "";
  if (!expectedPhase || currentPhase !== expectedPhase) return detail;

  const active = liveSlices.find((s) => s?.active);
  if (!active) return detail;

  return mergeWorkerMessageDetails([
    detailAsMessageLike(detail),
    {
      content: active.content,
      thinking: active.thinking,
      assistantTimeline: active.assistantTimeline,
      toolTrace: active.toolTrace,
      activityLog: active.activityLog,
      streaming: true,
    },
  ]);
}



/**

 * @param {Array<Record<string, unknown>>} messages

 * @param {import("./orchestration.js").OrchestrationRun} run

 * @param {{ streaming?: boolean; mainAgentId?: string | null }} opts

 * @returns {import("../chat/toolTraceMerge.js").ActivityRow[]}

 */

export function buildOrchestrationActivityLog(messages, run, opts = {}) {
  const mainAgentId = opts.mainAgentId ?? null;
  const t = typeof opts.t === "function" ? opts.t : null;
  const agentLabels =
    opts.agentLabels instanceof Map ? opts.agentLabels : /** @type {Map<string, string>} */ (new Map());
  const liveSlices = Array.isArray(opts.liveSlices) ? opts.liveSlices : [];
  const indexed = indexOrchestrationMessages(messages, run);

  const events = messages.filter((m) => {
    const isEvent =
      m.messageKind === "orchestration_event" || isLegacyOrchestrationEventMessage(m, mainAgentId);
    return isEvent && messageBelongsToOrchestrationRun(m, run);
  });

  /** @type {import("../chat/toolTraceMerge.js").ActivityRow[]} */

  const rows = [];

  let seq = 0;

  /** @type {{ triage: number; plan_synthesis: number }} */
  const phaseSlots = { triage: 0, plan_synthesis: 0 };
  const openTaskIds = buildOpenOrchestrationTaskIds(events, run);
  const orchestrationBusy = Boolean(opts.streaming);

  for (let i = 0; i < events.length; i++) {

    const m = events[i];

    const key = typeof m.orchestrationEventKey === "string" ? m.orchestrationEventKey : "";
    const taskId =
      typeof m.orchestrationTaskId === "string" && m.orchestrationTaskId.trim()
        ? m.orchestrationTaskId.trim()
        : "";

    let title = String(m.content ?? "").trim();
    if (t && key) {
      title = resolveOrchestrationEventTitle(t, m, run, agentLabels);
    }

    if (!title) continue;

    const isLast = i === events.length - 1;

    const { detail: boundDetail, boundMessageId } = workerDetailsForEvent(key, m, indexed, phaseSlots);
    let detail = enrichDetailWithTaskLiveSlices(
      boundDetail,
      liveSlices,
      boundMessageId,
      indexed,
      taskId,
    );

    const stepStillOpen =
      (taskId && openTaskIds.has(taskId)) ||
      (ORCH_TASK_OPEN_KEYS.has(key) && !ORCH_TASK_CLOSE_KEYS.has(key));

    if (
      (isLast || stepStillOpen) &&
      !detail.workerStreaming &&
      !detail.text &&
      !detail.assistantTimeline.length
    ) {
      detail = augmentDetailFromLiveSlice(key, detail, liveSlices, {
        isLast: isLast || stepStillOpen,
        boundMessageId,
        run,
      });
    }

    let text = detail.text;

    if (text && normalizeOrchLabel(text) === normalizeOrchLabel(title)) {

      text = "";

    }

    const stepPhase = resolveOrchestrationStepPhase(key, taskId, openTaskIds, detail, {
      orchestrationBusy,
      isLast,
      runStatus: run?.status,
    });

    const stepInterrupted =
      run?.status === "paused" &&
      ((taskId && openTaskIds.has(taskId)) ||
        (ORCH_TASK_OPEN_KEYS.has(key) && stepPhase === "end" && !ORCH_TASK_CLOSE_KEYS.has(key)));

    rows.push({

      id: String(m.id),

      stream: "orchestration",

      phase: stepPhase,

      title,

      orchestrationEventKey: key,
      orchestrationAssignment: ORCH_ASSIGNMENT_KEYS.has(key),
      orchestrationStepTitleOnly: !ORCH_MAIN_LEAD_STEP_KEYS.has(key),
      orchestrationLeadStep: ORCH_MAIN_LEAD_STEP_KEYS.has(key),
      ...(stepInterrupted ? { orchestrationInterrupted: true } : {}),

      text,

      toolTrace: detail.toolTrace.length ? detail.toolTrace : undefined,

      nestedActivity: detail.nestedActivity.length ? detail.nestedActivity : undefined,

      assistantTimeline: detail.assistantTimeline.length ? detail.assistantTimeline : undefined,

      workerStreaming: detail.workerStreaming || (stepPhase === "running" && orchestrationBusy && stepStillOpen),

      seq: seq++,

    });

  }

  return rows;

}



/**

 * @param {Array<Record<string, unknown>>} messages

 */

function anyOrchestrationWorkerStreaming(messages, run) {

  return messages.some((m) => {

    if (!m.streaming) return false;

    if (!messageBelongsToOrchestrationRun(m, run)) return false;

    if (m.messageKind === "orchestration_internal") return true;

    const phase = m.orchestrationPhase;

    return (
      phase === "triage" ||
      phase === "pre_research" ||
      phase === "plan_synthesis" ||
      phase === "pm_research" ||
      phase === "development" ||
      phase === "work" ||
      phase === "review" ||
      phase === "rollup"
    );

  });

}



/**

 * @param {Array<Record<string, unknown>>} messages

 * @param {import("./orchestration.js").OrchestrationRun} run

 * @param {import("./agents.js").LobsterAgent} mainAgent

 * @param {{ streaming?: boolean }} opts

 */

/**
 * Title of the current orchestration step for dock idle state (matches main anchor list).
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} activityLog
 * @param {{ busy?: boolean; fallback?: string }} [opts]
 */
export function resolveOrchestrationCurrentStepTitle(activityLog, opts = {}) {
  const fallback = String(opts.fallback ?? "").trim();
  if (!Array.isArray(activityLog) || !activityLog.length) {
    return opts.busy ? fallback : fallback;
  }
  const running = activityLog.filter(
    (r) =>
      !r.orchestrationInterrupted &&
      (String(r.phase ?? "") === "running" || Boolean(r.workerStreaming)),
  );
  const pick = running.length ? running[running.length - 1] : activityLog[activityLog.length - 1];
  const title = String(pick?.title ?? "").trim();
  return title || fallback;
}

export function buildOrchestrationAnchorMessage(messages, run, mainAgent, opts = {}) {
  const liveSlices = Array.isArray(opts.liveSlices) ? opts.liveSlices : [];
  const mergedMessages = overlayGatewayStreamSlicesOnMessages(messages, liveSlices);
  const workerStreaming = anyOrchestrationWorkerStreaming(mergedMessages, run);
  const activityLog = buildOrchestrationActivityLog(mergedMessages, run, {
    streaming: Boolean(opts.streaming || workerStreaming),
    mainAgentId: mainAgent.id,
    t: opts.t,
    agentLabels: opts.agentLabels,
    liveSlices,
  });

  const indexed = indexOrchestrationMessages(mergedMessages, run);

  const rollupText = String(indexed.rollupMsg?.content ?? "").trim();

  let content = "";
  if (run.status === "completed" && rollupText) {
    content = rollupText;
  }

  const failed = run.status === "failed";
  const error = failed ? resolveFailedOrchestrationError(mergedMessages, run, indexed) : undefined;
  const streaming = failed
    ? false
    : Boolean(opts.streaming || workerStreaming);

  return {
    id: `orch-anchor-${run.runId}`,
    role: /** @type {const} */ ("assistant"),
    agentId: mainAgent.id,
    messageKind: /** @type {const} */ ("orchestration_anchor"),
    content,
    activityLog,
    streaming,
    ...(error ? { error } : {}),
    createdAt: run.startedAt,
  };
}


