/** Max rows kept for agent activity (items, plan, command output, …). */
export const MAX_ACTIVITY_LOG = 120;

/**
 * @typedef {{
 *   id: string;
 *   toolName: string;
 *   label?: string;
 *   phase: string;
 *   status?: string;
 *   summary?: string;
 *   seq: number;
 *   args?: Record<string, unknown>;
 *   result?: string;
 *   partialResult?: string;
 *   error?: string;
 *   done?: boolean;
 * }} ToolTraceRow */

/**
 * @typedef {{
 *   id: string;
 *   stream: string;
 *   phase?: string;
 *   title?: string;
 *   text?: string;
 *   seq: number;
 *   toolTrace?: ToolTraceRow[];
 *   nestedActivity?: ActivityRow[];
 *   workerStreaming?: boolean;
 *   subagentRunId?: string;
 *   subagentTask?: string;
 *   assistantTimeline?: import("./streamTimelineMerge.js").AssistantTimelineSegment[];
 * }} ActivityRow */

const DONE_PHASES = new Set(["end", "error", "failed", "cancelled", "canceled", "complete", "completed", "ok"]);

/**
 * Stable row id for a `tool_trace` IPC event (matches {@link mergeToolTrace}).
 * @param {*} evt
 */
export function toolTraceKeyFromEvent(evt) {
  const toolCallId = typeof evt.toolCallId === "string" ? evt.toolCallId.trim() : "";
  const toolName = typeof evt.toolName === "string" ? evt.toolName.trim() : "";
  const seq = typeof evt.seq === "number" ? evt.seq : 0;
  return toolCallId || `anon-${seq}-${toolName || "tool"}`;
}

/**
 * Stable row id for an `agent_activity` IPC event (matches {@link mergeActivityLog}).
 * @param {*} evt
 */
export function activityKeyFromEvent(evt) {
  const stream = typeof evt.stream === "string" ? evt.stream : "";
  const payload = evt.payload && typeof evt.payload === "object" ? evt.payload : {};
  const runId = typeof evt.runId === "string" ? evt.runId.trim() : "";
  const phase = typeof payload.phase === "string" ? payload.phase.trim().toLowerCase() : "";
  const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
  const tc = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
  const seq = typeof evt.seq === "number" ? evt.seq : 0;
  if (stream === "lifecycle") {
    const runPart = runId || itemId || tc || "run";
    if (phase) return `lifecycle:${runPart}:${phase}`;
    return `lifecycle:${runPart}:${seq}`;
  }
  if (stream === "subagent") {
    const subId =
      typeof payload.subagentRunId === "string" && payload.subagentRunId.trim()
        ? payload.subagentRunId.trim()
        : runId || itemId || String(seq);
    return `subagent:${subId}`;
  }
  return `${stream}:${itemId || tc || runId || String(seq)}`;
}

/**
 * @param {ToolTraceRow[] | undefined} prev
 * @param {*} evt raw IPC `tool_trace` event
 * @returns {ToolTraceRow[]}
 */
export function mergeToolTrace(prev, evt) {
  const list = Array.isArray(prev) ? [...prev] : [];
  const key = toolTraceKeyFromEvent(evt);
  const toolCallId = typeof evt.toolCallId === "string" ? evt.toolCallId.trim() : "";
  const toolName = typeof evt.toolName === "string" ? evt.toolName.trim() : "";
  const seq = typeof evt.seq === "number" ? evt.seq : 0;
  const phase = typeof evt.phase === "string" ? evt.phase : "";
  const idx = list.findIndex((r) => r.id === key);
  /** @type {ToolTraceRow} */
  const base = {
    id: key,
    toolName,
    label: typeof evt.label === "string" ? evt.label : "",
    phase,
    status: typeof evt.status === "string" ? evt.status : "",
    summary: typeof evt.summary === "string" ? evt.summary : "",
    seq,
    args: evt.args && typeof evt.args === "object" ? evt.args : undefined,
    result: typeof evt.result === "string" ? evt.result : undefined,
    partialResult: typeof evt.partialResult === "string" ? evt.partialResult : undefined,
    error: typeof evt.error === "string" ? evt.error : undefined,
    done: DONE_PHASES.has(phase.toLowerCase()),
  };
  if (idx < 0) {
    list.push(base);
    return list;
  }
  const prevRow = list[idx];
  list[idx] = {
    ...prevRow,
    ...base,
    args: base.args ?? prevRow.args,
    result: base.result ?? prevRow.result,
    partialResult: base.partialResult ?? prevRow.partialResult,
    error: base.error ?? prevRow.error,
  };
  return list;
}

/**
 * @param {ActivityRow[] | undefined} prev
 * @param {*} evt raw IPC `agent_activity` event
 * @returns {ActivityRow[]}
 */
export function mergeActivityLog(prev, evt) {
  const list = Array.isArray(prev) ? [...prev] : [];
  const stream = typeof evt.stream === "string" ? evt.stream : "";
  const payload = evt.payload && typeof evt.payload === "object" ? evt.payload : {};
  const seq = typeof evt.seq === "number" ? evt.seq : 0;
  const id = activityKeyFromEvent(evt);
  const phase = typeof payload.phase === "string" ? payload.phase : "";
  const title =
    typeof payload.title === "string"
      ? payload.title
      : typeof payload.name === "string"
        ? payload.name
        : stream;
  const text =
    typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.progressText === "string"
        ? payload.progressText
        : typeof payload.output === "string"
          ? payload.output
          : typeof payload.message === "string"
            ? payload.message
            : typeof payload.explanation === "string"
              ? payload.explanation
              : "";
  /** @type {ActivityRow} */
  const row = {
    id,
    stream,
    phase,
    title,
    text,
    seq,
    ...(stream === "subagent"
      ? {
          workerStreaming: Boolean(payload.workerStreaming),
          ...(typeof payload.subagentRunId === "string" && payload.subagentRunId.trim()
            ? { subagentRunId: payload.subagentRunId.trim() }
            : {}),
          ...(typeof payload.subagentTask === "string" && payload.subagentTask.trim()
            ? { subagentTask: payload.subagentTask.trim() }
            : {}),
        }
      : {}),
  };
  const idx = list.findIndex((r) => r.id === id && r.stream === stream);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...row,
      workerStreaming:
        stream === "subagent"
          ? Object.prototype.hasOwnProperty.call(payload, "workerStreaming")
            ? Boolean(payload.workerStreaming)
            : prev.workerStreaming
          : prev.workerStreaming,
    };
  } else list.push(row);
  if (list.length > MAX_ACTIVITY_LOG) return list.slice(-MAX_ACTIVITY_LOG);
  return list;
}

const SPAWN_TOOL_RE = /^(sessions_spawn|session_spawn|spawn_subagent|subagent_spawn)$/i;
const YIELD_TOOL_RE = /^sessions_yield$/i;

/** @param {unknown} name */
export function isSessionsSpawnToolName(name) {
  return SPAWN_TOOL_RE.test(String(name ?? "").trim());
}

/**
 * Short title for Cursor-style subagent step (never the full multi-line task dump).
 * @param {string} [task]
 * @param {string} [label]
 */
export function shortSubagentTitle(task, label) {
  const lab = String(label ?? "").trim();
  // Prefer stable taskName / label (e.g. analyze-project) over the full task dump.
  if (lab && !/^subagent$/i.test(lab) && lab.length <= 96 && !lab.includes("\n")) return lab;
  const first = String(task ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return "Subagent";
  return first.length > 72 ? `${first.slice(0, 71)}…` : first;
}

/**
 * Reject assistant prose so the subtitle stays tool/step-like.
 * @param {string} text
 */
export function looksLikeSubagentToolProgressLine(text) {
  const s = String(text ?? "").trim();
  if (!s || s.length > 140) return false;
  if (/^#{1,6}\s/.test(s) || s.includes("```")) return false;
  if (s.includes("\n\n")) return false;
  if (/[。！？]/.test(s) && s.length > 36) return false;
  if ((s.match(/[.!?。！？]/g) || []).length >= 2 && s.length > 48) return false;
  if (s.startsWith("{") && /status/i.test(s)) return false;
  return true;
}

/**
 * Progress line under the title — tools/steps only, never dump full task / body.
 * @param {{ task?: string; progress?: string; summary?: string; active?: boolean }} opts
 */
export function pickSubagentProgressLine(opts = {}) {
  const task = String(opts.task ?? "").trim();
  const candidates = [opts.progress, opts.summary]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  for (const c of candidates) {
    if (!c) continue;
    if (task && (c === task || task.startsWith(c) || c.startsWith(task.slice(0, 40)))) continue;
    if (!looksLikeSubagentToolProgressLine(c)) continue;
    return c.length > 96 ? `${c.slice(0, 95)}…` : c;
  }
  return "";
}

/** @param {unknown} value */
function parseToolJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return /** @type {Record<string, unknown>} */ (value);
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

/** @param {Record<string, unknown> | null | undefined} args */
function readSpawnArgsFromTool(args) {
  if (!args || typeof args !== "object") return { task: "", label: "" };
  const task = typeof args.task === "string" ? args.task.trim() : "";
  // Prefer taskName (short slug) over label/task for the Cursor-style title.
  const label =
    typeof args.taskName === "string" && args.taskName.trim()
      ? args.taskName.trim()
      : typeof args.label === "string" && args.label.trim()
        ? args.label.trim()
        : "";
  return { task, label };
}

/**
 * True while parallel subagents are still outstanding for the parent turn:
 * - sessions_spawn tool still in-flight, or
 * - spawn returned accepted/running and sessions_yield has not settled yet, or
 * - sessions_yield itself is still in-flight (barrier wait).
 * @param {ToolTraceRow[] | undefined} toolRows
 */
export function toolTraceAwaitsSubagent(toolRows) {
  if (!Array.isArray(toolRows) || !toolRows.length) return false;
  const yieldRows = toolRows.filter((r) => YIELD_TOOL_RE.test(String(r.toolName ?? "").trim()));
  const yieldInFlight = yieldRows.some((r) => {
    if (r.error) return false;
    const phase = String(r.phase ?? "").trim().toLowerCase();
    if (DONE_PHASES.has(phase) || r.done) {
      const resultObj = parseToolJsonObject(r.result) ?? parseToolJsonObject(r.partialResult);
      const st =
        resultObj && typeof resultObj.status === "string" ? resultObj.status.trim().toLowerCase() : "";
      // Mid-turn barrier still running until completed/error with results.
      if (st === "completed" || st === "error" || Array.isArray(resultObj?.results)) return false;
      return false;
    }
    return true;
  });
  if (yieldInFlight) return true;

  const yieldSettled = yieldRows.some((r) => {
    const resultObj = parseToolJsonObject(r.result) ?? parseToolJsonObject(r.partialResult);
    if (!resultObj) return false;
    const st = typeof resultObj.status === "string" ? resultObj.status.trim().toLowerCase() : "";
    return st === "completed" || st === "error" || Array.isArray(resultObj.results);
  });
  if (yieldSettled) return false;

  return toolRows.some((r) => {
    if (!SPAWN_TOOL_RE.test(String(r.toolName ?? "").trim())) return false;
    if (r.error) return false;
    const resultObj = parseToolJsonObject(r.result) ?? parseToolJsonObject(r.partialResult);
    const st =
      resultObj && typeof resultObj.status === "string" ? resultObj.status.trim().toLowerCase() : "";
    // Parallel mode: tool returns quickly with accepted while the child keeps working.
    if (st === "accepted" || st === "running") return true;
    if (st === "completed" || st === "ok" || st === "error" || st === "timeout" || st === "forbidden") {
      return false;
    }
    if (r.done) return false;
    const phase = String(r.phase ?? "").trim().toLowerCase();
    if (DONE_PHASES.has(phase)) return false;
    return true;
  });
}

/**
 * UI fallback: one row per sessions_spawn (not per activity snapshot).
 * @param {ToolTraceRow[] | undefined} toolRows
 * @param {{ streaming?: boolean }} [opts]
 * @returns {ActivityRow[]}
 */
export function deriveSubagentRowsFromToolTrace(toolRows, opts = {}) {
  if (!Array.isArray(toolRows) || !toolRows.length) return [];
  const spawns = toolRows.filter((r) => SPAWN_TOOL_RE.test(String(r.toolName ?? "").trim()));
  const yieldRows = toolRows.filter((r) => YIELD_TOOL_RE.test(String(r.toolName ?? "").trim()));
  const yielded = yieldRows.length > 0;
  if (!spawns.length && !yielded) return [];
  const streaming = Boolean(opts.streaming);

  const yieldSettled = yieldRows.some((y) => {
    const resultObj = parseToolJsonObject(y.result) ?? parseToolJsonObject(y.partialResult);
    if (!resultObj) return false;
    const st = typeof resultObj.status === "string" ? resultObj.status.trim().toLowerCase() : "";
    return st === "completed" || st === "error" || Array.isArray(resultObj.results);
  });
  const yieldInFlight =
    !yieldSettled &&
    yieldRows.some((y) => {
      if (y.error) return false;
      const phase = String(y.phase ?? "").trim().toLowerCase();
      return !(DONE_PHASES.has(phase) || y.done);
    });

  /** @type {ActivityRow[]} */
  const rows = [];
  for (const spawn of spawns) {
    const args = spawn.args && typeof spawn.args === "object" ? spawn.args : {};
    const fromArgs = readSpawnArgsFromTool(/** @type {Record<string, unknown>} */ (args));
    const resultObj =
      parseToolJsonObject(spawn.result) ??
      parseToolJsonObject(spawn.partialResult) ??
      parseToolJsonObject(spawn.summary);
    const batchResults = Array.isArray(resultObj?.results) ? resultObj.results : null;
    const batchArgs = Array.isArray(args.tasks) ? args.tasks : null;
    // Hard-barrier parallel: one sessions_spawn({tasks:[...]}) → one card per child.
    // Show from args.tasks as soon as the tool starts (don't wait for final results).
    if ((batchResults && batchResults.length) || (batchArgs && batchArgs.length)) {
      const count = Math.max(batchResults?.length ?? 0, batchArgs?.length ?? 0);
      for (let i = 0; i < count; i++) {
        const br =
          batchResults && batchResults[i] && typeof batchResults[i] === "object"
            ? /** @type {Record<string, unknown>} */ (batchResults[i])
            : null;
        const ba =
          batchArgs && batchArgs[i] && typeof batchArgs[i] === "object"
            ? /** @type {Record<string, unknown>} */ (batchArgs[i])
            : null;
        const task =
          (br && typeof br.task === "string" ? br.task.trim() : "") ||
          (ba && typeof ba.task === "string" ? ba.task.trim() : "") ||
          "";
        const label =
          (br && typeof br.label === "string" ? br.label.trim() : "") ||
          (ba && typeof ba.taskName === "string" ? ba.taskName.trim() : "") ||
          (ba && typeof ba.label === "string" ? ba.label.trim() : "") ||
          "";
        const status = br && typeof br.status === "string" ? br.status.trim().toLowerCase() : "";
        const childRunId = br && typeof br.runId === "string" ? br.runId.trim() : "";
        const childFinished =
          status === "completed" ||
          status === "ok" ||
          status === "error" ||
          status === "timeout" ||
          status === "forbidden";
        const toolStillRunning =
          Boolean(streaming) &&
          !spawn.error &&
          !spawn.done &&
          !DONE_PHASES.has(String(spawn.phase ?? "").trim().toLowerCase());
        const active =
          Boolean(streaming) &&
          !spawn.error &&
          !childFinished &&
          !yieldSettled &&
          (toolStillRunning || status === "accepted" || status === "running" || !status);
        // Never reuse parent spawn.summary for every child — it cross-contaminates progress.
        rows.push({
          id: `subagent-tool:${spawn.id}:${childRunId || i}`,
          stream: "subagent",
          phase: active ? "running" : "end",
          title: shortSubagentTitle(task, label),
          text: "",
          seq: (spawn.seq ?? 0) + i * 0.001,
          subagentTask: task,
          workerStreaming: active,
          ...(childRunId ? { subagentRunId: childRunId } : {}),
        });
      }
      continue;
    }
    const task =
      fromArgs.task ||
      (resultObj && typeof resultObj.task === "string" ? resultObj.task.trim() : "") ||
      "";
    const label =
      fromArgs.label ||
      (resultObj && typeof resultObj.label === "string" ? resultObj.label.trim() : "") ||
      "";
    const status =
      resultObj && typeof resultObj.status === "string" ? resultObj.status.trim().toLowerCase() : "";
    const childRunId =
      resultObj && typeof resultObj.runId === "string" ? resultObj.runId.trim() : "";
    const childFinished =
      status === "completed" ||
      status === "ok" ||
      status === "error" ||
      status === "timeout" ||
      status === "forbidden";
    // Parallel detach mode: spawn returns accepted while child works; active until yield.
    const childWorking = status === "accepted" || status === "running" || (!status && !spawn.done);
    const active =
      Boolean(streaming) &&
      !spawn.error &&
      !childFinished &&
      !yieldSettled &&
      (childWorking || yieldInFlight || (status !== "accepted" && !spawn.done));
    // Default hard-block: tool in-flight (no terminal status yet) stays active.
    const title = shortSubagentTitle(task, label);
    const progress = pickSubagentProgressLine({
      task,
      progress: typeof spawn.summary === "string" ? spawn.summary : "",
      active,
    });
    rows.push({
      id: `subagent-tool:${spawn.id}`,
      stream: "subagent",
      phase: active ? "running" : "end",
      title,
      text: progress,
      seq: spawn.seq ?? 0,
      subagentTask: task,
      workerStreaming: active,
      ...(childRunId ? { subagentRunId: childRunId } : {}),
    });
  }

  // Legacy yield path (steered continuation). Studio uses mid-turn barrier yield instead.
  if (!rows.length && yielded && streaming) {
    const y = yieldRows[yieldRows.length - 1];
    const resultObj = parseToolJsonObject(y.result) ?? parseToolJsonObject(y.partialResult);
    const msg =
      (typeof y.summary === "string" && y.summary.trim()) ||
      (resultObj && typeof resultObj.message === "string" ? resultObj.message.trim() : "") ||
      "";
    rows.push({
      id: `subagent-yield:${y.id}`,
      stream: "subagent",
      phase: "running",
      title: shortSubagentTitle(msg, "Subagent"),
      text: "",
      seq: y.seq ?? 0,
      subagentTask: msg,
      workerStreaming: true,
    });
  }
  return rows;
}

/**
 * Collapse duplicate activity/tool-derived subagent rows into one card per spawn.
 * @param {ActivityRow[] | undefined} fromLog
 * @param {ActivityRow[] | undefined} fromTools
 * @param {{ streaming?: boolean }} [opts]
 * @returns {ActivityRow[]}
 */
export function coalesceSubagentActivityRows(fromLog, fromTools, opts = {}) {
  const log = Array.isArray(fromLog) ? fromLog : [];
  const tools = Array.isArray(fromTools) ? fromTools : [];
  const streaming = Boolean(opts.streaming);
  if (!log.length && !tools.length) return [];

  /** Prefer tool-derived rows (stable id per spawn); enrich only with matching child activity. */
  if (tools.length) {
    return tools.map((toolRow) => {
      let progress = String(toolRow.text ?? "").trim();
      let workerStreaming = Boolean(toolRow.workerStreaming);
      let phase = toolRow.phase;
      const toolRunId =
        typeof toolRow.subagentRunId === "string" ? toolRow.subagentRunId.trim() : "";
      const toolTitle = String(toolRow.title ?? "").trim().toLowerCase();
      for (const a of log) {
        const actRunId = typeof a.subagentRunId === "string" ? a.subagentRunId.trim() : "";
        const actTitle = String(a.title ?? "").trim().toLowerCase();
        const sameRun = Boolean(toolRunId && actRunId && toolRunId === actRunId);
        const sameTitle =
          Boolean(toolTitle && actTitle) &&
          (toolTitle === actTitle ||
            toolTitle.includes(actTitle) ||
            actTitle.includes(toolTitle));
        // Strict attribution: never paint one child's progress onto another card.
        if (toolRunId && actRunId) {
          if (!sameRun) continue;
        } else if (toolTitle && actTitle) {
          if (!sameTitle) continue;
        } else {
          continue;
        }
        const p = pickSubagentProgressLine({
          task: toolRow.subagentTask || toolRow.title,
          progress: a.text || a.title,
        });
        if (p) progress = p;
        if (a.phase) phase = a.phase;
        const actPhase = String(a.phase ?? "").trim().toLowerCase();
        const actDone =
          DONE_PHASES.has(actPhase) ||
          (Object.prototype.hasOwnProperty.call(a, "workerStreaming") && a.workerStreaming === false);
        // Per-child completion is independent: one child finishing must not wait on siblings
        // or on the parent sessions_spawn tool still being in-flight.
        if (actDone) {
          workerStreaming = false;
          if (!actPhase || !DONE_PHASES.has(actPhase)) phase = "end";
        } else if (streaming && a.workerStreaming) {
          workerStreaming = true;
        }
      }
      if (!streaming) {
        workerStreaming = false;
        phase = "end";
      } else if (!toolRow.workerStreaming && String(toolRow.phase ?? "").toLowerCase() === "end") {
        workerStreaming = false;
        phase = "end";
      }
      return {
        ...toolRow,
        title: shortSubagentTitle(toolRow.subagentTask, toolRow.title),
        text: progress,
        phase,
        workerStreaming,
      };
    });
  }

  // No spawn tool rows — one card per distinct subagent activity id (never collapse all into one).
  const byId = new Map();
  const sorted = [...log].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const row of sorted) {
    const key =
      (typeof row.subagentRunId === "string" && row.subagentRunId.trim()) ||
      String(row.id ?? "").trim() ||
      `anon:${byId.size}`;
    byId.set(key, row);
  }
  return [...byId.values()].map((row) => {
    const task = row.subagentTask || row.title || "";
    const progress = pickSubagentProgressLine({
      task,
      progress: row.text,
    });
    const running = Boolean(streaming && row.workerStreaming);
    return {
      ...row,
      stream: "subagent",
      title: shortSubagentTitle(task, row.title),
      text: progress,
      subagentTask: String(task ?? ""),
      phase: running ? row.phase || "running" : "end",
      workerStreaming: running,
    };
  });
}
