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
  const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
  const tc = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
  const seq = typeof evt.seq === "number" ? evt.seq : 0;
  return `${stream}:${itemId || tc || String(seq)}`;
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
  const row = { id, stream, phase, title, text, seq };
  const idx = list.findIndex((r) => r.id === id && r.stream === stream);
  if (idx >= 0) list[idx] = { ...list[idx], ...row };
  else list.push(row);
  if (list.length > MAX_ACTIVITY_LOG) return list.slice(-MAX_ACTIVITY_LOG);
  return list;
}
