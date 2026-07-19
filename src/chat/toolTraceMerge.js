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
 * Progress line under the title — never dump full task / tool result.
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
    if (c.length > 160) continue;
    if (c.startsWith("{") && c.includes("status")) continue;
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
 * True when sessions_spawn is still in-flight (blocking await / mid-tool).
 * @param {ToolTraceRow[] | undefined} toolRows
 */
export function toolTraceAwaitsSubagent(toolRows) {
  if (!Array.isArray(toolRows) || !toolRows.length) return false;
  return toolRows.some((r) => {
    if (!SPAWN_TOOL_RE.test(String(r.toolName ?? "").trim())) return false;
    if (r.done || r.error) return false;
    const phase = String(r.phase ?? "").trim().toLowerCase();
    if (DONE_PHASES.has(phase)) return false;
    const resultObj = parseToolJsonObject(r.result) ?? parseToolJsonObject(r.partialResult);
    if (resultObj && typeof resultObj.status === "string") {
      const st = resultObj.status.trim().toLowerCase();
      if (st === "completed" || st === "ok" || st === "error" || st === "timeout" || st === "forbidden") {
        return false;
      }
    }
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

  /** @type {ActivityRow[]} */
  const rows = [];
  for (const spawn of spawns) {
    const args = spawn.args && typeof spawn.args === "object" ? spawn.args : {};
    const fromArgs = readSpawnArgsFromTool(/** @type {Record<string, unknown>} */ (args));
    const resultObj =
      parseToolJsonObject(spawn.result) ??
      parseToolJsonObject(spawn.partialResult) ??
      parseToolJsonObject(spawn.summary);
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
    const spawnDone =
      Boolean(spawn.done) ||
      /^(end|complete|completed|ok|result)$/i.test(String(spawn.phase ?? "").trim()) ||
      status === "completed" ||
      status === "ok" ||
      status === "error" ||
      status === "timeout" ||
      status === "forbidden";
    // Only "active" while the parent turn is still streaming and the tool has not finished.
    const active = Boolean(streaming) && !spawnDone && !spawn.error;
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
    });
  }

  // Legacy yield path (disabled in Studio when OPEN_STUDIO_SUBAGENT_AWAIT=1).
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

  /** Prefer tool-derived rows (stable id per spawn); enrich with latest progress from activity log. */
  if (tools.length) {
    return tools.map((toolRow) => {
      let progress = String(toolRow.text ?? "").trim();
      let workerStreaming = Boolean(toolRow.workerStreaming);
      let phase = toolRow.phase;
      for (const a of log) {
        const p = pickSubagentProgressLine({
          task: toolRow.subagentTask || toolRow.title,
          progress: a.text || a.title,
        });
        if (p) progress = p;
        if (streaming && a.workerStreaming) workerStreaming = true;
        if (a.phase) phase = a.phase;
      }
      // If any tool row is done, don't stay "running" from stale activity.
      if (!streaming || (!toolRow.workerStreaming && String(toolRow.phase ?? "").toLowerCase() === "end")) {
        workerStreaming = false;
        if (String(toolRow.phase ?? "").toLowerCase() === "end") phase = "end";
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

  // No spawn tool row — keep a single coalesced activity card.
  const sorted = [...log].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const last = sorted[sorted.length - 1];
  const task =
    sorted.map((r) => r.subagentTask).find((t) => typeof t === "string" && t.trim()) ||
    last.subagentTask ||
    last.title ||
    "";
  const progress =
    [...sorted]
      .reverse()
      .map((r) =>
        pickSubagentProgressLine({
          task,
          progress: r.text,
        }),
      )
      .find(Boolean) || "";
  const anyRunning = sorted.some((r) => r.workerStreaming);
  return [
    {
      ...last,
      id: "subagent:coalesced",
      stream: "subagent",
      title: shortSubagentTitle(task, last.title),
      text: progress,
      subagentTask: String(task ?? ""),
      phase: streaming && anyRunning ? last.phase || "running" : "end",
      workerStreaming: streaming && anyRunning,
    },
  ];
}
