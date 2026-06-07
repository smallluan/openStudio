/**

 * Orchestration UI is rendered as a single main-agent bubble using the existing

 * ActivityChainPanel ("步骤 N 条") — worker outputs are tucked, not separate bubbles.

 */



/**

 * @param {unknown} m

 * @param {{ orchestrationRun?: import("./orchestration.js").OrchestrationRun | null; mainAgentId?: string | null }} ctx

 * @returns {boolean}

 */

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
    return sessionRun?.runId && sessionRun.status !== "failed" ? sessionRun : null;
  }

  const msgRunIds = marked
    .map((m) => (typeof m.orchestrationRunId === "string" ? m.orchestrationRunId.trim() : ""))
    .filter(Boolean);
  const dominantRunId = msgRunIds[0] || "";

  if (sessionRun?.runId && sessionRun.status !== "failed") {
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
  if (run?.status === "failed") return false;

  // Any assistant output scoped to the active run belongs inside the anchor timeline.
  if (
    run &&
    run.status !== "failed" &&
    row.role === "assistant" &&
    messageBelongsToOrchestrationRun(m, run)
  ) {
    return true;
  }

  if (!isOrchestrationMarkedMessage(m, ctx.mainAgentId ?? null)) return false;

  if (run && run.status !== "failed" && messageBelongsToOrchestrationRun(m, run)) return true;

  // Session store may lag behind live runner events — still tuck marked rows while orchestration mode is on.
  if (orchestrationMode) return true;

  // Legacy / repaired rows without run metadata but clearly orchestration content.
  if (isLegacyOrchestrationEventMessage(m, ctx.mainAgentId ?? null)) return true;
  if (isLegacyWorkerOrchMessage(m)) return true;

  return false;
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

  for (const m of messages) {

    if (!messageBelongsToOrchestrationRun(m, run)) continue;

    if (m.messageKind === "orchestration_internal") latestInternal = m;

    if (m.orchestrationPhase === "rollup") rollupMsg = m;

    if (m.orchestrationPhase === "pm_research" && m.agentId) {

      pmByAgent.set(String(m.agentId), m);

    }

    if (typeof m.orchestrationTaskId === "string" && m.orchestrationTaskId) {

      const arr = byTask.get(m.orchestrationTaskId) ?? [];

      arr.push(m);

      byTask.set(m.orchestrationTaskId, arr);

    }

  }

  return { pmByAgent, byTask, rollupMsg, latestInternal };

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

    if (content) textParts.push(content);

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

 */

function workerDetailsForEvent(key, eventMsg, indexed) {

  if (key === "pm_start" && eventMsg.orchestrationWorkerId) {

    const pm = indexed.pmByAgent.get(String(eventMsg.orchestrationWorkerId));

    return mergeWorkerMessageDetails(pm ? [pm] : []);

  }

  if (

    (key === "task_start" ||

      key === "task_done" ||

      key === "review_passed" ||

      key === "review_rework" ||

      key === "review_blocked") &&

    eventMsg.orchestrationTaskId

  ) {

    const parts = indexed.byTask.get(String(eventMsg.orchestrationTaskId)) ?? [];

    return mergeWorkerMessageDetails(parts);

  }

  if (key === "rollup" && indexed.rollupMsg) {

    return mergeWorkerMessageDetails([indexed.rollupMsg]);

  }

  if ((key === "synthesizing_plan" || key === "awaiting_approval") && indexed.latestInternal) {

    return mergeWorkerMessageDetails([indexed.latestInternal]);

  }

  return mergeWorkerMessageDetails([]);

}



/**

 * @param {Array<Record<string, unknown>>} messages

 * @param {import("./orchestration.js").OrchestrationRun} run

 * @param {{ streaming?: boolean; mainAgentId?: string | null }} opts

 * @returns {import("../chat/toolTraceMerge.js").ActivityRow[]}

 */

export function buildOrchestrationActivityLog(messages, run, opts = {}) {
  const mainAgentId = opts.mainAgentId ?? null;
  const indexed = indexOrchestrationMessages(messages, run);

  const events = messages.filter((m) => {
    const isEvent =
      m.messageKind === "orchestration_event" || isLegacyOrchestrationEventMessage(m, mainAgentId);
    return isEvent && messageBelongsToOrchestrationRun(m, run);
  });

  /** @type {import("../chat/toolTraceMerge.js").ActivityRow[]} */

  const rows = [];

  let seq = 0;

  for (let i = 0; i < events.length; i++) {

    const m = events[i];

    const title = String(m.content ?? "").trim();

    if (!title) continue;

    const key = typeof m.orchestrationEventKey === "string" ? m.orchestrationEventKey : "";

    const detail = workerDetailsForEvent(key, m, indexed);

    const isLast = i === events.length - 1;

    const leadBusy = isLast && Boolean(opts.streaming) && !detail.workerStreaming;

    let text = detail.text;

    if (text && normalizeOrchLabel(text) === normalizeOrchLabel(title)) {

      text = "";

    }

    rows.push({

      id: String(m.id),

      stream: "orchestration",

      phase: detail.workerStreaming || leadBusy ? "running" : "end",

      title,

      text,

      toolTrace: detail.toolTrace.length ? detail.toolTrace : undefined,

      nestedActivity: detail.nestedActivity.length ? detail.nestedActivity : undefined,

      assistantTimeline: detail.assistantTimeline.length ? detail.assistantTimeline : undefined,

      workerStreaming: detail.workerStreaming,

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
      phase === "pm_research" ||
      phase === "development" ||
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

export function buildOrchestrationAnchorMessage(messages, run, mainAgent, opts = {}) {

  const workerStreaming = anyOrchestrationWorkerStreaming(messages, run);

  const activityLog = buildOrchestrationActivityLog(messages, run, {
    streaming: Boolean(opts.streaming || workerStreaming),
    mainAgentId: mainAgent.id,
  });

  const indexed = indexOrchestrationMessages(messages, run);

  const rollupText = String(indexed.rollupMsg?.content ?? "").trim();



  let content = "";

  if (run.status === "completed" && rollupText) {

    content = rollupText;

  }



  return {

    id: `orch-anchor-${run.runId}`,

    role: /** @type {const} */ ("assistant"),

    agentId: mainAgent.id,

    messageKind: /** @type {const} */ ("orchestration_anchor"),

    content,

    activityLog,

    streaming: Boolean(opts.streaming || workerStreaming),

    createdAt: run.startedAt,

  };

}


