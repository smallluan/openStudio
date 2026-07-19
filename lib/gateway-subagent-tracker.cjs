/**
 * Track OpenClaw subagent turns for a single Studio chat stream.
 *
 * Open Studio parallel barrier:
 *   sessions_spawn* (non-blocking) → sessions_yield (wait ALL) → parent continues same turn
 *
 * Legacy OpenClaw flow:
 *   sessions_spawn → sessions_yield → parent chat.final
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

/**
 * Subagent subtitle should look like a tool/step line, not assistant prose.
 * @param {string} text
 */
function looksLikeSubagentToolProgress(text) {
  const s = String(text ?? "").trim();
  if (!s || s.length > 140) return false;
  if (/^#{1,6}\s/.test(s) || s.includes("```")) return false;
  if (s.includes("\n\n")) return false;
  // Multi-sentence / report-like prose.
  if (/[。！？]/.test(s) && s.length > 36) return false;
  if (/(?:^|[.!?]\s+)[A-Z\u4e00-\u9fff]/.test(s) && s.length > 72 && /\s/.test(s.slice(20))) {
    const sentenceEnds = (s.match(/[.!?。！？]/g) || []).length;
    if (sentenceEnds >= 2) return false;
  }
  if (
    /^(read|write|edit|exec|bash|shell|dir|dir_list|glob|grep|search|list|ls|cat|find|apply_patch|browser|sessions_)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/\b(path|cmd|command|file|cwd|op)\s*[:=]/i.test(s)) return true;
  if (/^[a-z][\w./-]{0,40}\s+/i.test(s) && s.length <= 100) return true;
  // Short status crumbs without paragraph punctuation.
  return s.length <= 72 && !/[。]/.test(s);
}

/**
 * @param {{ toolName?: string; label?: string; summary?: string }} info
 */
function formatChildToolProgressLine(info = {}) {
  const toolName = typeof info.toolName === "string" ? info.toolName.trim() : "";
  const label = typeof info.label === "string" ? info.label.trim() : "";
  const summary = typeof info.summary === "string" ? info.summary.trim() : "";
  const detail = [label, summary].find((v) => v && looksLikeSubagentToolProgress(v)) || label || summary || "";
  let line = "";
  if (toolName && detail) {
    const detailHasTool = detail.toLowerCase().includes(toolName.toLowerCase());
    line = detailHasTool ? detail : `${toolName} · ${detail}`;
  } else {
    line = detail || toolName;
  }
  if (!line || !looksLikeSubagentToolProgress(line)) {
    if (toolName && looksLikeSubagentToolProgress(toolName)) return toolName.slice(0, 120);
    return "";
  }
  return line.slice(0, 120);
}

/**
 * OpenClaw tool results are often `{ content:[{text}], details:{...} }` wrappers.
 * Prefer the inner spawn payload when present.
 * @param {Record<string, unknown> | null} obj
 * @returns {Record<string, unknown> | null}
 */
function unwrapSpawnResultObject(obj) {
  if (!obj) return null;
  if (Array.isArray(obj.results) || typeof obj.runId === "string") return obj;
  const details = obj.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const inner = unwrapSpawnResultObject(/** @type {Record<string, unknown>} */ (details));
    if (inner && (Array.isArray(inner.results) || typeof inner.runId === "string")) return inner;
    if (typeof /** @type {Record<string, unknown>} */ (details).status === "string") {
      return /** @type {Record<string, unknown>} */ (details);
    }
  }
  if (Array.isArray(obj.content)) {
    for (const part of obj.content) {
      if (!part || typeof part !== "object") continue;
      const text = /** @type {Record<string, unknown>} */ (part).text;
      if (typeof text !== "string") continue;
      const parsed = parseJsonObject(text);
      if (!parsed) continue;
      const inner = unwrapSpawnResultObject(parsed);
      if (inner) return inner;
    }
  }
  return obj;
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
 * Parallel hard-block: sessions_spawn({ tasks: [...] }).
 * @param {Record<string, unknown> | null | undefined} args
 * @returns {Array<{ task: string; label: string }>}
 */
function readBatchSpawnArgs(args) {
  if (!args || typeof args !== "object" || !Array.isArray(args.tasks)) return [];
  /** @type {Array<{ task: string; label: string }>} */
  const out = [];
  for (const raw of args.tasks) {
    if (!raw || typeof raw !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const task = typeof row.task === "string" ? row.task.trim() : "";
    if (!task) continue;
    const label =
      typeof row.taskName === "string" && row.taskName.trim()
        ? row.taskName.trim()
        : typeof row.label === "string" && row.label.trim()
          ? row.label.trim()
          : task.slice(0, 80);
    out.push({ task, label });
  }
  return out;
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
  /** Spawn toolCallIds still in-flight (hard-block await / tasks[]). */
  /** @type {Set<string>} */
  const openSpawnToolIds = new Set();
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
    const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
    // Prefer exact pending:${toolCallId}, then next free pending:${toolCallId}:N (tasks[] batch).
    let pendingId = id ? `pending:${id}` : "";
    let pending = pendingId ? children.get(pendingId) : null;
    if (!pending && id) {
      for (const [key, child] of children) {
        if (!key.startsWith(`pending:${id}`) || child.done) continue;
        if (child.toolCallId && findChildByToolCallId(child.toolCallId)) continue;
        pendingId = key;
        pending = child;
        break;
      }
    }
    if (pending && pendingId) children.delete(pendingId);
    registerChild({
      ...reg,
      label: reg.label || pending?.label || "Subagent",
      task: reg.task || pending?.task || "",
      toolCallId: pending?.toolCallId || id,
    });
  };

  /**
   * Mark every child owned by a sessions_spawn toolCallId as done.
   * Covers pending:${id}, pending:${id}:N, and live children with toolCallId `${id}` / `${id}:N`.
   * Critical for tasks[] hard-block so the parent stream can close after chat.final.
   * @param {string} toolCallId
   * @param {string} [progressText]
   */
  const settleSpawnToolChildren = (toolCallId, progressText = "completed") => {
    const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
    if (!id) return;
    for (const [runId, child] of children) {
      if (child.done) continue;
      const tc = typeof child.toolCallId === "string" ? child.toolCallId.trim() : "";
      const related =
        runId === `pending:${id}` ||
        runId.startsWith(`pending:${id}:`) ||
        tc === id ||
        tc.startsWith(`${id}:`);
      if (related) {
        markChildDone(runId, { phase: "end", progressText });
      }
    }
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
    // Premature parent final must not freeze pending:* forever — still claim while placeholders remain.
    if (parentFinalReceived) {
      let hasPending = false;
      for (const [key, child] of children) {
        if (key.startsWith("pending:") && !child.done) {
          hasPending = true;
          break;
        }
      }
      if (!hasPending) return false;
    }

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
      const batchArgs = readBatchSpawnArgs(args);
      const liveForCall = toolCallId ? findChildByToolCallId(toolCallId) : null;
      const pendingId = toolCallId ? `pending:${toolCallId}` : "";
      const pendingDone = Boolean(pendingId && children.get(pendingId)?.done);
      const terminalPhase = TERMINAL_ITEM_PHASES.has(phase);
      const terminalStatus = TERMINAL_ITEM_STATUS.has(status);
      const spawnTerminal = terminalPhase || terminalStatus;
      if (toolCallId && !spawnTerminal) openSpawnToolIds.add(toolCallId);
      // tasks[] hard-block: one tool call owns multiple pending children.
      if (toolCallId && batchArgs.length > 0) {
        for (let i = 0; i < batchArgs.length; i++) {
          const batchPendingId = `pending:${toolCallId}:${i}`;
          const batchToolCallId = `${toolCallId}:${i}`;
          if (findChildByToolCallId(batchToolCallId)) continue;
          if (children.get(batchPendingId)?.done) continue;
          registerChild({
            runId: batchPendingId,
            label: batchArgs[i].label || "Subagent",
            task: batchArgs[i].task,
            toolCallId: batchToolCallId,
            phase: "running",
          });
        }
      } else if (toolCallId && !liveForCall && !pendingDone && !spawnTerminal) {
        // Only create pending:* while this spawn is still in flight.
        registerChild({
          runId: pendingId,
          label: fromArgs.label || "Subagent",
          task: fromArgs.task,
          toolCallId,
          phase: "running",
        });
      }
      const resultObj = unwrapSpawnResultObject(
        parseJsonObject(evt?.result) ??
          parseJsonObject(evt?.partialResult) ??
          parseJsonObject(evt?.summary),
      );
      if (resultObj) {
        const batchResults = Array.isArray(resultObj.results) ? resultObj.results : null;
        const resultStatus =
          typeof resultObj.status === "string" ? resultObj.status.trim().toLowerCase() : "";
        if (batchResults && batchResults.length) {
          for (let i = 0; i < batchResults.length; i++) {
            const row = batchResults[i];
            if (!row || typeof row !== "object") continue;
            const reg = readSpawnRegistration(/** @type {Record<string, unknown>} */ (row));
            if (!reg) continue;
            const batchToolCallId = toolCallId ? `${toolCallId}:${i}` : "";
            if (batchToolCallId) migratePendingChild(toolCallId, { ...reg, toolCallId: batchToolCallId });
            else registerChild(reg);
            // Hard-block tasks[] only returns after children finish — always settle the runId.
            if (reg.runId) {
              markChildDone(reg.runId, { phase: "end", progressText: "completed" });
            }
          }
          // Clear any leftover pending:${toolCallId}:N ghosts so the parent stream can close.
          if (toolCallId) settleSpawnToolChildren(toolCallId, "completed");
        } else {
          const reg = readSpawnRegistration(resultObj);
          if (reg) {
            if (toolCallId) migratePendingChild(toolCallId, { ...reg, toolCallId });
            else registerChild(reg);
            if (reg.done) {
              markChildDone(reg.runId, { phase: "end", progressText: "completed" });
              if (toolCallId) settleSpawnToolChildren(toolCallId, "completed");
            }
          } else if (
            toolCallId &&
            (resultStatus === "completed" || resultStatus === "error" || resultStatus === "timeout")
          ) {
            settleSpawnToolChildren(toolCallId, resultStatus);
          }
        }
      }
      // Fallback: terminal spawn tool row — settle every child owned by this toolCallId
      // (including tasks[] live children with toolCallId `${id}:N`).
      if (toolCallId && spawnTerminal) {
        settleSpawnToolChildren(
          toolCallId,
          (typeof evt?.summary === "string" && evt.summary.trim()) ||
            (typeof evt?.error === "string" && evt.error.trim()) ||
            "completed",
        );
        openSpawnToolIds.delete(toolCallId);
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
      const barrierSettled =
        yieldResultStatus === "completed" ||
        (yieldObj && Array.isArray(yieldObj.results));
      // Open Studio parallel barrier: sessions_yield waited mid-turn and returned results.
      // Do not hold the parent stream for a steered continuation.
      if (barrierSettled && phase !== "start" && phase !== "update") {
        yieldPending = false;
        yieldAt = 0;
        sawContinuationAfterYield = false;
        spawnCalled = true;
        for (const [id, child] of children) {
          if (!child.done) {
            markChildDone(id, {
              phase: yieldResultStatus === "error" ? "error" : "end",
              progressText: child.progressText || "completed",
            });
          }
        }
        if (children.has("yield-awaiting")) {
          markChildDone("yield-awaiting", {
            phase: yieldResultStatus === "error" ? "error" : "end",
          });
        }
        return;
      }
      const yieldFailed =
        Boolean((typeof evt?.error === "string" && evt.error.trim()) || status === "error" || status === "failed") ||
        ["error", "failed", "forbidden", "timeout", "aborted", "cancelled", "canceled"].includes(yieldResultStatus);
      // Failed yield (or legacy disabled) must not keep the stream open.
      if (yieldFailed && !barrierSettled) {
        yieldPending = false;
        yieldAt = 0;
        sawContinuationAfterYield = false;
        if (children.has("yield-awaiting")) {
          markChildDone("yield-awaiting", {
            phase: "end",
            progressText:
              (typeof evt?.error === "string" && evt.error.trim()) ||
              (typeof evt?.summary === "string" && evt.summary.trim()) ||
              "yield failed",
          });
        }
        return;
      }
      // Legacy OpenClaw yield: end turn and wait for steered continuation.
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

    if (stream === "item" || stream === "command_output" || stream === "patch") {
      const phase = typeof d.phase === "string" ? d.phase.trim().toLowerCase() : "";
      const progressText =
        typeof d.progressText === "string"
          ? d.progressText.trim()
          : typeof d.summary === "string"
            ? d.summary.trim()
            : typeof d.title === "string"
              ? d.title.trim()
              : typeof d.name === "string"
                ? d.name.trim()
                : typeof d.command === "string"
                  ? d.command.trim()
                  : "";
      // Subtitle shows tools/steps only — never assistant body / command_output dumps.
      if (progressText && looksLikeSubagentToolProgress(progressText)) {
        child.progressText = progressText.slice(0, 120);
      }
      // Tool/item "end" is NOT the child run finishing — only lifecycle (above) settles the card.
      if (phase && !TERMINAL_ITEM_PHASES.has(phase)) {
        child.phase = phase === "start" || phase === "update" ? "running" : phase;
      } else if (phase) {
        child.phase = "running";
      }
    }
    // stream === "assistant": ignore — body prose must not become the subtitle.
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
    const line = formatChildToolProgressLine(info);
    if (line) child.progressText = line;
    const phase = typeof info.phase === "string" ? info.phase.trim().toLowerCase() : "";
    // A single child tool ending (read/exec/dir) must NOT mark the whole subagent done.
    // Only child lifecycle.end (or spawn/yield settle) completes the card.
    if (phase) {
      child.phase = phase === "start" || phase === "update" || TERMINAL_ITEM_PHASES.has(phase)
        ? "running"
        : phase;
    }
  };

  /**
   * Child chat/body must never drive the subtitle — tools/steps only.
   * Kept as a no-op so stream wiring can stay unchanged.
   * @param {string} _runId
   * @param {string} [_text]
   */
  const noteChildChatProgress = (_runId, _text) => {};

  const forceSettleAllChildren = (progressText = "completed") => {
    for (const [id, child] of children) {
      if (!child.done) markChildDone(id, { phase: "end", progressText });
    }
  };

  const markParentFinal = () => {
    parentFinalReceived = true;
    // Second (or later) final after we already saw continuation → yield wait is over.
    if (yieldPending && sawContinuationAfterYield && !hasActiveChildren()) {
      yieldPending = false;
      // Mark synthetic yield child done so UI can settle.
      if (children.has("yield-awaiting")) {
        markChildDone("yield-awaiting", { phase: "end" });
      } else {
        forceSettleAllChildren();
      }
    }
    // Hard-block / await: spawn tool already returned. Ghost children must not keep the parent
    // stream in "正在撰写回复…". Detach+yield keeps yieldPending; bare registerChild tests omit spawnCalled.
    if (spawnCalled && !yieldPending && openSpawnToolIds.size === 0 && hasActiveChildren()) {
      forceSettleAllChildren();
    }
    noteChildrenCompletionClock();
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
      // Hard-block / await: children finished inside sessions_spawn — do not keep the UI in
      // "正在撰写回复…" for postCompletionGraceMs after parent final.
      const grace = spawnCalled ? 0 : postCompletionGraceMs;
      return Date.now() - allChildrenDoneAt >= grace;
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
  unwrapSpawnResultObject,
  looksLikeSubagentToolProgress,
  formatChildToolProgressLine,
  readSpawnRegistration,
  readSpawnArgs,
  readBatchSpawnArgs,
};
