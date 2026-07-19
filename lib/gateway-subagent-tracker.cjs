/**
 * Track OpenClaw subagent turns for a single Studio chat stream.
 *
 * Typical OpenClaw flow:
 *   sessions_spawn (task) → sessions_yield → parent chat.final
 *   child runs in background → completion steers parent continuation (new runId, same session)
 */

const SPAWN_TOOL_RE = /^(sessions_spawn|session_spawn|spawn_subagent|subagent_spawn)$/i;
const YIELD_TOOL_RE = /^sessions_yield$/i;
const TERMINAL_LIFE_PHASES = new Set(["end", "error", "failed", "cancelled", "canceled", "complete", "completed"]);
const TERMINAL_ITEM_PHASES = new Set(["end", "error", "failed", "cancelled", "canceled", "complete", "completed"]);
const TERMINAL_ITEM_STATUS = new Set(["completed", "complete", "failed", "error", "cancelled", "canceled", "aborted"]);
const DEFAULT_YIELD_HOLD_MS = 600_000;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function normalizeRunId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {unknown} value */
function isSpawnToolName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return Boolean(name && SPAWN_TOOL_RE.test(name));
}

/** @param {unknown} value */
function isYieldToolName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return Boolean(name && YIELD_TOOL_RE.test(name));
}

/** @param {Record<string, unknown> | null | undefined} args */
function readSpawnArgs(args) {
  if (!args || typeof args !== "object") return { task: "", label: "" };
  const task = typeof args.task === "string" ? args.task.trim() : "";
  const label =
    typeof args.label === "string"
      ? args.label.trim()
      : typeof args.taskName === "string"
        ? args.taskName.trim()
        : task
          ? task.slice(0, 80)
          : "";
  return { task, label: label || (task ? task.slice(0, 80) : "Subagent") };
}

/**
 * @param {Record<string, unknown>} obj
 */
function readSpawnRegistration(obj) {
  const runId = normalizeRunId(obj.runId);
  if (!runId) return null;
  const status = typeof obj.status === "string" ? obj.status.trim().toLowerCase() : "";
  const terminal = ["completed", "ok", "error", "timeout", "forbidden"].includes(status);
  if (status && status !== "accepted" && status !== "running" && !terminal) return null;
  const task = typeof obj.task === "string" ? obj.task.trim() : "";
  const label =
    typeof obj.label === "string"
      ? obj.label.trim()
      : typeof obj.taskName === "string"
        ? obj.taskName.trim()
        : task
          ? task.slice(0, 80)
          : "Subagent";
  return {
    runId,
    label,
    task,
    childSessionKey:
      typeof obj.childSessionKey === "string" ? obj.childSessionKey.trim() : "",
    done: terminal,
  };
}

/**
 * @param {{
 *   parentRunId?: string;
 *   postCompletionGraceMs?: number;
 *   yieldHoldMs?: number;
 * }} [opts]
 */
function createGatewaySubagentTracker(opts = {}) {
  let parentRunId = normalizeRunId(opts.parentRunId);
  let parentFinalReceived = false;
  let yieldPending = false;
  let spawnCalled = false;
  let sawContinuationAfterYield = false;
  let yieldAt = 0;
  let allChildrenDoneAt = 0;
  const postCompletionGraceMs =
    typeof opts.postCompletionGraceMs === "number" && opts.postCompletionGraceMs >= 0
      ? opts.postCompletionGraceMs
      : 45_000;
  const yieldHoldMs =
    typeof opts.yieldHoldMs === "number" && opts.yieldHoldMs >= 0
      ? opts.yieldHoldMs
      : DEFAULT_YIELD_HOLD_MS;

  /** @type {Set<string>} */
  const linkedRunIds = new Set();
  /** @type {Map<string, { runId: string; label: string; task: string; childSessionKey: string; done: boolean; phase: string; progressText: string; toolCallId?: string }>} */
  const children = new Map();

  const registerParentRunId = (runId) => {
    const id = normalizeRunId(runId);
    if (!id) return;
    parentRunId = id;
    linkedRunIds.add(id);
  };

  const registerChild = (entry) => {
    const runId = normalizeRunId(entry?.runId);
    if (!runId) return false;
    linkedRunIds.add(runId);
    const prev = children.get(runId);
    // Never resurrect a completed child (late "accepted" / duplicate spawn rows).
    const nextDone = Boolean(prev?.done) || Boolean(entry?.done);
    const nextPhase = nextDone
      ? entry?.phase && TERMINAL_LIFE_PHASES.has(String(entry.phase).toLowerCase())
        ? String(entry.phase).toLowerCase()
        : prev?.phase && TERMINAL_LIFE_PHASES.has(String(prev.phase).toLowerCase())
          ? prev.phase
          : entry?.phase || prev?.phase || "end"
      : entry?.phase || prev?.phase || "running";
    children.set(runId, {
      runId,
      label: entry.label || prev?.label || "Subagent",
      task: entry.task || prev?.task || "",
      childSessionKey: entry.childSessionKey || prev?.childSessionKey || "",
      done: nextDone,
      phase: nextPhase,
      progressText: entry.progressText || prev?.progressText || "",
      toolCallId: entry.toolCallId || prev?.toolCallId,
    });
    if (nextDone) noteChildrenCompletionClock();
    else allChildrenDoneAt = 0;
    return true;
  };

  /** @param {string} toolCallId */
  const findChildByToolCallId = (toolCallId) => {
    const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
    if (!id) return null;
    for (const child of children.values()) {
      if (child.toolCallId === id && !String(child.runId).startsWith("pending:")) return child;
    }
    return null;
  };

  const migratePendingChild = (toolCallId, reg) => {
    const pendingId = `pending:${toolCallId}`;
    const pending = children.get(pendingId);
    if (pending) children.delete(pendingId);
    registerChild({
      ...reg,
      label: reg.label || pending?.label || "Subagent",
      task: reg.task || pending?.task || "",
      toolCallId,
    });
  };

  const markChildDone = (runId, patch = {}) => {
    const id = normalizeRunId(runId);
    if (!id) return;
    const prev = children.get(id) ?? {
      runId: id,
      label: "Subagent",
      task: "",
      childSessionKey: "",
      done: false,
      phase: "running",
      progressText: "",
    };
    children.set(id, {
      ...prev,
      ...patch,
      done: true,
      phase: patch.phase || prev.phase || "end",
    });
    noteChildrenCompletionClock();
  };

  const noteChildrenCompletionClock = () => {
    if (hasActiveChildren()) {
      allChildrenDoneAt = 0;
      return;
    }
    if (!allChildrenDoneAt && children.size > 0) {
      allChildrenDoneAt = Date.now();
    }
  };

  const hasActiveChildren = () => {
    for (const child of children.values()) {
      if (!child.done) return true;
    }
    return false;
  };

  const isKnownChildRun = (runId) => {
    const id = normalizeRunId(runId);
    return Boolean(id && children.has(id));
  };

  const isTrackedChildRun = (runId) => {
    const id = normalizeRunId(runId);
    return Boolean(id && children.has(id) && !children.get(id)?.done);
  };

  /**
   * @param {string} runId
   * @param {string} currentParentRunId
   */
  /**
   * Claim a live child runId for an in-flight sessions_spawn (pending:* placeholder).
   * Used when child events arrive on a different sessionKey before the tool result.
   * @param {string} runId
   * @param {string} [currentParentRunId]
   * @param {{ sessionKey?: string; parentSessionKey?: string }} [claimOpts]
   */
  const tryClaimChildRun = (runId, currentParentRunId, claimOpts = {}) => {
    const id = normalizeRunId(runId);
    if (!id) return false;
    if (children.has(id)) return true;
    const parentId = normalizeRunId(currentParentRunId) || parentRunId;
    if (parentId && id === parentId) return false;
    if (parentFinalReceived) return false;

    const eventSessionKey =
      typeof claimOpts?.sessionKey === "string" ? claimOpts.sessionKey.trim() : "";
    const parentSessionKey =
      typeof claimOpts?.parentSessionKey === "string" ? claimOpts.parentSessionKey.trim() : "";
    // Shared WS: only claim frames from a different session that looks like a subagent.
    // Otherwise unrelated concurrent runs can steal pending:* and leave a ghost child forever.
    if (parentSessionKey) {
      if (!eventSessionKey || eventSessionKey === parentSessionKey) return false;
      if (!/subagent/i.test(eventSessionKey)) return false;
    }

    /** @type {{ label: string; task: string; toolCallId?: string } | null} */
    let fromPending = null;
    for (const [key, child] of children) {
      if (key.startsWith("pending:") && !child.done) {
        // Prefer a pending whose live child is not already registered.
        if (child.toolCallId && findChildByToolCallId(child.toolCallId)) continue;
        fromPending = {
          label: child.label || "Subagent",
          task: child.task || "",
          toolCallId: child.toolCallId,
        };
        children.delete(key);
        break;
      }
    }
    if (!fromPending) return false;
    registerChild({
      runId: id,
      label: fromPending.label,
      task: fromPending.task,
      toolCallId: fromPending.toolCallId,
      childSessionKey: eventSessionKey,
      phase: "running",
    });
    return true;
  };

  const acceptsRunId = (runId, currentParentRunId) => {
    const id = normalizeRunId(runId);
    if (!id) return true;
    if (children.has(id)) return true;
    if (linkedRunIds.has(id)) return true;
    const parentId = normalizeRunId(currentParentRunId) || parentRunId;
    if (parentId && id === parentId) return true;
    // Legacy yield path: parent continuation arrives with a new runId on the same session.
    if (parentFinalReceived && (yieldPending || children.size > 0)) {
      linkedRunIds.add(id);
      return true;
    }
    return false;
  };

  const noteContinuationActivity = () => {
    if (parentFinalReceived && yieldPending) {
      sawContinuationAfterYield = true;
    }
  };

  /**
   * @param {*} evt tool_trace IPC payload
   */
  const noteToolTrace = (evt) => {
    const toolName = typeof evt?.toolName === "string" ? evt.toolName.trim() : "";
    const toolCallId = typeof evt?.toolCallId === "string" ? evt.toolCallId.trim() : "";
    const phase = typeof evt?.phase === "string" ? evt.phase.trim().toLowerCase() : "";
    const status = typeof evt?.status === "string" ? evt.status.trim().toLowerCase() : "";

    if (isSpawnToolName(toolName)) {
      spawnCalled = true;
      const args = evt?.args && typeof evt.args === "object" ? evt.args : null;
      const fromArgs = readSpawnArgs(args);
      const liveForCall = toolCallId ? findChildByToolCallId(toolCallId) : null;
      const pendingId = toolCallId ? `pending:${toolCallId}` : "";
      const pendingDone = Boolean(pendingId && children.get(pendingId)?.done);
      // Only create pending:* while this spawn is still in flight. Late tool updates must not
      // reopen a ghost placeholder after the live child (or pending) already completed.
      if (toolCallId && !liveForCall && !pendingDone) {
        registerChild({
          runId: pendingId,
          label: fromArgs.label || "Subagent",
          task: fromArgs.task,
          toolCallId,
          phase: "running",
        });
      }
      const resultObj =
        parseJsonObject(evt?.result) ??
        parseJsonObject(evt?.partialResult) ??
        parseJsonObject(evt?.summary);
      if (resultObj) {
        const reg = readSpawnRegistration(resultObj);
        if (reg) {
          if (toolCallId) migratePendingChild(toolCallId, { ...reg, toolCallId });
          else registerChild(reg);
          if (reg.done) {
            markChildDone(reg.runId, { phase: "end", progressText: "completed" });
            if (toolCallId && children.has(pendingId)) {
              markChildDone(pendingId, { phase: "end", progressText: "completed" });
            }
          }
        }
      }
      // Fallback: some gateways emit terminal spawn tool rows without a JSON run result.
      // In that case, clear pending:* so the parent stream can close.
      if (toolCallId) {
        const terminalPhase = TERMINAL_ITEM_PHASES.has(phase);
        const terminalStatus = TERMINAL_ITEM_STATUS.has(status);
        if (terminalPhase || terminalStatus) {
          if (children.has(pendingId)) {
            markChildDone(pendingId, {
              phase: terminalPhase ? phase : terminalStatus ? status : "end",
              progressText:
                (typeof evt?.summary === "string" && evt.summary.trim()) ||
                (typeof evt?.error === "string" && evt.error.trim()) ||
                "completed",
            });
          }
          const live = findChildByToolCallId(toolCallId);
          if (live && !live.done) {
            markChildDone(live.runId, {
              phase: terminalPhase ? phase : terminalStatus ? status : "end",
              progressText:
                (typeof evt?.summary === "string" && evt.summary.trim()) ||
                (typeof evt?.error === "string" && evt.error.trim()) ||
                live.progressText ||
                "completed",
            });
          }
        }
      }
      return;
    }

    if (isYieldToolName(toolName)) {
      const yieldObj =
        parseJsonObject(evt?.result) ??
        parseJsonObject(evt?.partialResult) ??
        parseJsonObject(evt?.summary);
      const yieldResultStatus =
        yieldObj && typeof yieldObj.status === "string" ? yieldObj.status.trim().toLowerCase() : "";
      const yieldFailed =
        Boolean((typeof evt?.error === "string" && evt.error.trim()) || status === "error" || status === "failed") ||
        ["error", "failed", "forbidden", "timeout", "aborted", "cancelled", "canceled"].includes(yieldResultStatus);
      // sessions_yield tool can be intentionally disabled in Studio; don't hold the stream on failed calls.
      if (yieldFailed) {
        yieldPending = false;
        yieldAt = 0;
        sawContinuationAfterYield = false;
        if (children.has("yield-awaiting")) {
          markChildDone("yield-awaiting", {
            phase: "end",
            progressText:
              (typeof evt?.error === "string" && evt.error.trim()) ||
              (typeof evt?.summary === "string" && evt.summary.trim()) ||
              "yield disabled",
          });
        }
        return;
      }
      // sessions_yield is the authoritative "wait for subagents" signal.
      yieldPending = true;
      spawnCalled = true;
      yieldAt = Date.now();
      sawContinuationAfterYield = false;
      const yieldMsg =
        (typeof evt?.summary === "string" && evt.summary.trim()) ||
        (yieldObj && typeof yieldObj.message === "string" ? yieldObj.message.trim() : "") ||
        "Waiting for subagent results";
      if (!children.size) {
        registerChild({
          runId: "yield-awaiting",
          label: "Subagent",
          task: yieldMsg,
          phase: "running",
          progressText: yieldMsg,
        });
      } else {
        for (const child of children.values()) {
          if (!child.done) {
            child.phase = "running";
            child.progressText = child.progressText || yieldMsg;
          }
        }
      }
    }
  };

  /**
   * @param {any} p gateway agent payload
   */
  const noteAgentPayload = (p) => {
    const runId = normalizeRunId(p?.runId);
    if (!runId) return;

    // Parent continuation frames (assistant/tool on a new run after yield).
    if (parentFinalReceived && yieldPending && !isKnownChildRun(runId)) {
      noteContinuationActivity();
    }

    const child = children.get(runId);
    if (!child || child.done) return;

    const stream = typeof p.stream === "string" ? p.stream : "";
    const d = p.data && typeof p.data === "object" ? p.data : {};

    if (stream === "lifecycle") {
      const phase = typeof d.phase === "string" ? d.phase.trim().toLowerCase() : "";
      if (phase && TERMINAL_LIFE_PHASES.has(phase)) {
        markChildDone(runId, {
          phase,
          progressText:
            typeof d.errorMessage === "string" && d.errorMessage.trim()
              ? d.errorMessage.trim()
              : child.progressText,
        });
      } else if (phase) {
        child.phase = phase;
      }
      return;
    }

    if (stream === "item" || stream === "command_output" || stream === "patch" || stream === "assistant") {
      const phase = typeof d.phase === "string" ? d.phase.trim().toLowerCase() : "";
      const status = typeof d.status === "string" ? d.status.trim().toLowerCase() : "";
      const progressText =
        typeof d.progressText === "string"
          ? d.progressText.trim()
          : typeof d.summary === "string"
            ? d.summary.trim()
            : typeof d.title === "string"
              ? d.title.trim()
              : typeof d.name === "string"
                ? d.name.trim()
                : typeof d.output === "string"
                  ? d.output.trim()
                  : typeof d.command === "string"
                    ? d.command.trim()
                    : "";
      // Never use long assistant prose as the one-line progress.
      if (progressText && progressText.length <= 160 && !progressText.includes("\n\n")) {
        child.progressText = progressText.slice(0, 120);
      }
      if (phase) child.phase = phase;
      if (
        (phase && TERMINAL_ITEM_PHASES.has(phase)) ||
        (status && TERMINAL_ITEM_STATUS.has(status))
      ) {
        markChildDone(runId, { phase: phase || status || "end", progressText: child.progressText });
      }
    }
  };

  /**
   * Mid-turn progress from a child tool call (never forwarded as parent tool_trace).
   * @param {string} runId
   * @param {{ toolName?: string; label?: string; summary?: string; phase?: string }} info
   */
  const noteChildToolProgress = (runId, info = {}) => {
    const id = normalizeRunId(runId);
    const child = children.get(id);
    if (!child || child.done) return;
    const line =
      (typeof info.label === "string" && info.label.trim()) ||
      (typeof info.summary === "string" && info.summary.trim()) ||
      (typeof info.toolName === "string" && info.toolName.trim()) ||
      "";
    if (line && line.length <= 160) child.progressText = line.slice(0, 120);
    const phase = typeof info.phase === "string" ? info.phase.trim().toLowerCase() : "";
    if (phase && TERMINAL_ITEM_PHASES.has(phase)) {
      markChildDone(id, { phase, progressText: child.progressText });
    } else if (phase) {
      child.phase = phase === "start" || phase === "update" ? "running" : phase;
    }
  };

  /**
   * Optional short progress hint from child chat (never merged into parent content).
   * @param {string} runId
   * @param {string} [text]
   */
  const noteChildChatProgress = (runId, text) => {
    const id = normalizeRunId(runId);
    const child = children.get(id);
    if (!child || child.done) return;
    const lines = String(text ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const last = lines[lines.length - 1];
    // Only short status-like lines — skip report paragraphs.
    if (last.length > 120 || last.length < 4) return;
    if (/^#{1,6}\s/.test(last) || last.includes("```")) return;
    child.progressText = last;
  };

  const markParentFinal = () => {
    parentFinalReceived = true;
    noteChildrenCompletionClock();
    // Second (or later) final after we already saw continuation → yield wait is over.
    if (yieldPending && sawContinuationAfterYield && !hasActiveChildren()) {
      yieldPending = false;
      // Mark synthetic yield child done so UI can settle.
      if (children.has("yield-awaiting")) {
        markChildDone("yield-awaiting", { phase: "end" });
      } else {
        for (const [id, child] of children) {
          if (!child.done) markChildDone(id, { phase: "end" });
        }
      }
    }
  };

  const awaitingSubagentWork = () => {
    if (hasActiveChildren()) return true;
    // Hold after yield until continuation finishes (or timeout).
    if (yieldPending) return true;
    return false;
  };

  const canFinishStream = () => {
    if (!parentFinalReceived) return false;
    if (yieldPending) {
      // Still waiting for steered continuation.
      if (!sawContinuationAfterYield) {
        return Boolean(yieldAt && Date.now() - yieldAt > yieldHoldMs);
      }
      // Continuation arrived and this final closed it — settle even if synthetic children linger.
      return true;
    }
    if (hasActiveChildren()) return false;
    if (children.size > 0) {
      if (!allChildrenDoneAt) return false;
      return Date.now() - allChildrenDoneAt >= postCompletionGraceMs;
    }
    return true;
  };

  const shouldHoldStreamOpen = () => {
    if (!parentFinalReceived) return false;
    if (!awaitingSubagentWork()) return false;
    return !canFinishStream();
  };

  /** @param {string} childRunId */
  const buildSubagentActivityPayload = (childRunId) => {
    const child = children.get(normalizeRunId(childRunId));
    if (!child) return null;
    const phase = child.done ? child.phase || "end" : child.phase || "running";
    return {
      phase,
      title: child.label || "Subagent",
      summary: child.progressText || child.task || "",
      progressText: child.progressText || "",
      subagentRunId: child.runId,
      subagentTask: child.task,
      workerStreaming: !child.done,
    };
  };

  const snapshotActivityPayloads = () => {
    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    for (const child of children.values()) {
      const payload = buildSubagentActivityPayload(child.runId);
      if (payload) rows.push(payload);
    }
    return rows;
  };

  return {
    registerParentRunId,
    registerChild,
    noteToolTrace,
    noteAgentPayload,
    noteChildToolProgress,
    noteChildChatProgress,
    noteContinuationActivity,
    markParentFinal,
    acceptsRunId,
    tryClaimChildRun,
    isTrackedChildRun,
    isKnownChildRun,
    hasActiveChildren,
    shouldHoldStreamOpen,
    canFinishStream,
    buildSubagentActivityPayload,
    snapshotActivityPayloads,
    get parentRunId() {
      return parentRunId;
    },
    get yieldPending() {
      return yieldPending;
    },
    get spawnCalled() {
      return spawnCalled;
    },
    get childCount() {
      return children.size;
    },
  };
}

module.exports = {
  SPAWN_TOOL_RE,
  YIELD_TOOL_RE,
  createGatewaySubagentTracker,
  isSpawnToolName,
  isYieldToolName,
  parseJsonObject,
  readSpawnRegistration,
  readSpawnArgs,
};
