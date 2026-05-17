import { activityKeyFromEvent, toolTraceKeyFromEvent } from "./toolTraceMerge.js";

/** Max timeline segments (excluding coalesced text/thinking growth). */
export const MAX_ASSISTANT_TIMELINE = 240;

/**
 * Ordered assistant reply segments (text / thinking interleaved with tool & activity refs).
 * @typedef {{ kind: "text"; body: string }} AssistantTimelineTextSegment
 * @typedef {{ kind: "thinking"; body: string }} AssistantTimelineThinkingSegment
 * @typedef {{ kind: "tool"; refId: string }} AssistantTimelineToolSegment
 * @typedef {{ kind: "activity"; refId: string }} AssistantTimelineActivitySegment
 * @typedef {AssistantTimelineTextSegment | AssistantTimelineThinkingSegment | AssistantTimelineToolSegment | AssistantTimelineActivitySegment} AssistantTimelineSegment
 */

/**
 * @param {AssistantTimelineSegment[] | undefined} prev
 * @param {string} delta
 */
export function mergeTimelineTextDelta(prev, delta) {
  if (typeof delta !== "string" || !delta) return Array.isArray(prev) ? prev : [];
  const list = Array.isArray(prev) ? [...prev] : [];
  const last = list[list.length - 1];
  if (last?.kind === "text") {
    list[list.length - 1] = { kind: "text", body: last.body + delta };
    return list;
  }
  list.push({ kind: "text", body: delta });
  return trimTimeline(list);
}

/**
 * @param {AssistantTimelineSegment[] | undefined} prev
 * @param {string} delta
 */
export function mergeTimelineThinkingDelta(prev, delta) {
  if (typeof delta !== "string" || !delta) return Array.isArray(prev) ? prev : [];
  const list = Array.isArray(prev) ? [...prev] : [];
  const last = list[list.length - 1];
  if (last?.kind === "thinking") {
    list[list.length - 1] = { kind: "thinking", body: last.body + delta };
    return list;
  }
  list.push({ kind: "thinking", body: delta });
  return trimTimeline(list);
}

/**
 * @param {AssistantTimelineSegment[] | undefined} prev
 * @param {*} evt raw `tool_trace`
 */
export function mergeTimelineToolTrace(prev, evt) {
  const key = toolTraceKeyFromEvent(evt);
  if (!key) return Array.isArray(prev) ? prev : [];
  const list = Array.isArray(prev) ? [...prev] : [];
  if (list.some((s) => s.kind === "tool" && s.refId === key)) return list;
  list.push({ kind: "tool", refId: key });
  return trimTimeline(list);
}

/**
 * @param {AssistantTimelineSegment[] | undefined} prev
 * @param {*} evt raw `agent_activity`
 */
export function mergeTimelineAgentActivity(prev, evt) {
  const id = activityKeyFromEvent(evt);
  if (!id) return Array.isArray(prev) ? prev : [];
  const list = Array.isArray(prev) ? [...prev] : [];
  if (list.some((s) => s.kind === "activity" && s.refId === id)) return list;
  list.push({ kind: "activity", refId: id });
  return trimTimeline(list);
}

/** @param {AssistantTimelineSegment[]} list */
function trimTimeline(list) {
  if (list.length <= MAX_ASSISTANT_TIMELINE) return list;
  return list.slice(-MAX_ASSISTANT_TIMELINE);
}
