/**
 * @param {string | undefined} rawPhase
 */
export function isCompletedActivityPhase(rawPhase) {
  const phase = String(rawPhase ?? "").trim().toLowerCase();
  if (!phase) return false;
  return (
    phase === "end" ||
    phase === "done" ||
    phase === "complete" ||
    phase === "completed" ||
    phase === "ok" ||
    phase === "success" ||
    phase === "lifecycle-end" ||
    phase === "lifecycle_end"
  );
}

/** @param {string | undefined} refId */
export function isTerminalLifecycleRef(refId) {
  const ref = String(refId ?? "");
  return /^lifecycle:[^:]*:(end|error|failed|cancelled|canceled|complete|completed|ok)$/i.test(ref);
}

/** @param {import("./toolTraceMerge.js").ActivityRow | null | undefined} row */
export function activityRowLifecycleTerminal(row) {
  if (!row || typeof row !== "object") return false;
  const stream = String(row.stream ?? "").trim().toLowerCase();
  const phase = String(row.phase ?? "").trim().toLowerCase();
  if (stream === "lifecycle" && isCompletedActivityPhase(phase)) return true;
  if ((stream === "lifecycle_end" || stream === "lifecycle-end") && !phase) return true;
  if (isTerminalLifecycleRef(row.id)) return true;
  return false;
}

/** @param {import("./toolTraceMerge.js").ActivityRow[] | undefined} nestedActivity */
export function orchestrationNestedLifecycleEnded(nestedActivity) {
  if (!Array.isArray(nestedActivity) || !nestedActivity.length) return false;
  return nestedActivity.some(
    (r) =>
      activityRowLifecycleTerminal(r) ||
      (Array.isArray(r.nestedActivity) && orchestrationNestedLifecycleEnded(r.nestedActivity)),
  );
}

/** @param {import("./streamTimelineMerge.js").AssistantTimelineSegment[] | undefined} timeline */
export function orchestrationTimelineLifecycleEnded(timeline) {
  if (!Array.isArray(timeline) || !timeline.length) return false;
  return timeline.some((seg) => seg?.kind === "activity" && isTerminalLifecycleRef(seg.refId));
}

/**
 * @param {Record<string, unknown>} message
 * @param {{
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 *   active?: boolean;
 * } | undefined} slice
 */
export function workerMessageLifecycleEnded(message, slice) {
  const activityLog = Array.isArray(slice?.activityLog)
    ? slice.activityLog
    : Array.isArray(message.activityLog)
      ? message.activityLog
      : [];
  const assistantTimeline = Array.isArray(slice?.assistantTimeline)
    ? slice.assistantTimeline
    : Array.isArray(message.assistantTimeline)
      ? message.assistantTimeline
      : [];
  return (
    orchestrationNestedLifecycleEnded(activityLog) ||
    orchestrationTimelineLifecycleEnded(assistantTimeline)
  );
}
