import { activityKeyFromEvent, toolTraceKeyFromEvent } from "./toolTraceMerge.js";

/** Max timeline segments (excluding coalesced text/thinking growth). */
export const MAX_ASSISTANT_TIMELINE = 240;

/**
 * Never replace accumulated assistant prose with a shorter gateway snapshot
 * (final `content_sync` can briefly lag behind streamed deltas).
 * @param {string | undefined} prev
 * @param {string | undefined} incoming
 */
export function preferLongerAssistantText(prev, incoming) {
  const a = typeof prev === "string" ? prev : "";
  const b = typeof incoming === "string" ? incoming : "";
  if (!b.trim()) return a;
  if (!a.trim()) return b;
  if (b.length >= a.length && (b.startsWith(a) || a.startsWith(b))) return b;
  if (a.startsWith(b)) return a;
  return a.length >= b.length ? a : b;
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} max
 */
function sharedPrefixLength(a, b, max = 240) {
  const n = Math.min(max, a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} max
 */
function sharedSuffixLength(a, b, max = 240) {
  const n = Math.min(max, a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Normalize whitespace for tolerant duplicate comparisons.
 * @param {string | undefined} s
 */
function normalizeCompareText(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Aggressive compare form for mixed newline/spacing stream artifacts.
 * @param {string | undefined} s
 */
function normalizeCompactText(s) {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Merge streamed assistant prose into an accumulated body.
 * Appends true deltas only; treats duplicate / full snapshots as replace, never `a + b` dup.
 * @param {string | undefined} body
 * @param {string | undefined} delta
 */
export function mergeAssistantTextChunk(body, delta) {
  const a = typeof body === "string" ? body : "";
  const b = typeof delta === "string" ? delta : "";
  if (!b) return a;
  if (!a) return b;
  if (b === a) return a;

  if (b.startsWith(a)) {
    const tail = b.slice(a.length);
    if (tail.trim() && a.includes(tail.trim())) return a;
    return b;
  }
  if (a.startsWith(b)) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  if (a.endsWith(b)) return a;
  if (b.endsWith(a)) return b;
  {
    const suffix = sharedSuffixLength(a.trimEnd(), b.trimEnd(), 180);
    const short = Math.min(a.length, b.length);
    const long = Math.max(a.length, b.length);
    if (suffix >= 6 && short >= 6 && long / short <= 2.2) {
      return b.length >= a.length ? b : a;
    }
  }

  const probeLen = Math.min(200, a.length, b.length);
  if (probeLen >= 20) {
    const probe = a.slice(0, probeLen);
    if (b.includes(probe) && b.length >= a.length * 0.82) return b;
    const probeB = b.slice(0, probeLen);
    if (a.includes(probeB) && a.length >= b.length * 0.82) return a;
  }

  const maxOverlap = Math.min(a.length, b.length, 12_000);
  for (let n = maxOverlap; n >= 20; n--) {
    const tail = a.slice(-n);
    if (b.startsWith(tail)) return a + b.slice(n);
  }

  if (sharedPrefixLength(a, b) >= 24) {
    return b.length >= a.length ? b : a;
  }

  if (b.length > 120 && a.length > 120) {
    return preferLongerAssistantText(a, b);
  }

  // Safety valve: avoid catastrophic duplicated concatenation for long snapshots.
  if (a.length > 80 && b.length > 80) {
    return preferLongerAssistantText(a, b);
  }

  return a + b;
}

/**
 * @param {AssistantTimelineSegment[]} list
 * @param {number} textIdx index of a `text` segment
 */
function priorTextBeforeIndex(list, textIdx) {
  let prior = "";
  for (let i = 0; i < textIdx; i++) {
    if (list[i].kind === "text") prior += String(list[i].body ?? "");
  }
  return prior;
}

/**
 * Text that belongs in the last timeline prose block after earlier text segments.
 * @param {AssistantTimelineSegment[]} list
 * @param {number} textIdx
 * @param {string} canonical
 */
function canonicalTailForLastTextSegment(list, textIdx, canonical) {
  const c = typeof canonical === "string" ? canonical : "";
  if (!c.trim()) return c;

  const p = priorTextBeforeIndex(list, textIdx).trimEnd();
  if (!p) return c;
  if (c.startsWith(p)) {
    const tail = c.slice(p.length).trimStart();
    return tail;
  }

  const pin = p.slice(0, Math.min(220, p.length)).trim();
  if (pin.length >= 40) {
    const idx = c.indexOf(pin);
    if (idx >= 0) {
      const tail = c.slice(idx + p.length).trimStart();
      if (tail) return tail;
    }
  }

  return c;
}

/**
 * When final canonical prose is known, drop earlier micro text fragments that are
 * already covered by the last text segment; otherwise UI can render "fragments + full body".
 * @param {AssistantTimelineSegment[]} list
 */
function dedupeEarlierTextCoveredByLast(list) {
  if (!Array.isArray(list) || list.length < 2) return list;
  let lastTextIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.kind === "text" && String(list[i].body ?? "").trim()) {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx <= 0) return list;
  // If the timeline already contains tool/activity/thinking interleaving before
  // the last prose block, keep all prose segments to preserve narrative order.
  for (let i = 0; i < lastTextIdx; i++) {
    if (list[i]?.kind !== "text") return list;
  }
  const lastBody = String(list[lastTextIdx].body ?? "").trim();
  if (!lastBody) return list;

  return list.filter((seg, idx) => {
    if (idx >= lastTextIdx) return true;
    if (seg.kind !== "text") return true;
    const body = String(seg.body ?? "").trim();
    if (!body) return false;
    return !lastBody.includes(body);
  });
}

/**
 * Drop earlier text segments already contained in the final canonical body (keeps tools between).
 * @param {AssistantTimelineSegment[]} list
 * @param {string} canonical
 */
export function reconcileTimelineWithCanonicalText(list, canonical) {
  const c = typeof canonical === "string" ? canonical : "";
  if (!c.trim() || !Array.isArray(list) || !list.length) return list;

  const textCount = list.filter((s) => s.kind === "text").length;
  if (textCount <= 1) {
    return list.map((seg) =>
      seg.kind === "text" ? { kind: "text", body: preferLongerAssistantText(seg.body, c) } : seg,
    );
  }

  /** @type {AssistantTimelineSegment[]} */
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const seg = list[i];
    if (seg.kind !== "text") {
      out.push(seg);
      continue;
    }
    const body = String(seg.body ?? "").trim();
    const hasLaterText = list.slice(i + 1).some((s) => s.kind === "text");
    if (hasLaterText) {
      let nextTextIdx = -1;
      for (let j = i + 1; j < list.length; j++) {
        if (list[j]?.kind === "text") {
          nextTextIdx = j;
          break;
        }
      }
      let hasInterleaving = false;
      if (nextTextIdx > i + 1) {
        for (let j = i + 1; j < nextTextIdx; j++) {
          if (list[j]?.kind !== "text") {
            hasInterleaving = true;
            break;
          }
        }
      }
      if (!hasInterleaving && body.length >= 40 && c.includes(body)) continue;
      out.push(seg);
      continue;
    }
    {
      const prior = priorTextBeforeIndex(list, i);
      const normPrior = normalizeCompareText(prior);
      const normBody = normalizeCompareText(body);
      const normCanon = normalizeCompareText(c);
      const compactPrior = normalizeCompactText(prior);
      const compactCanon = normalizeCompactText(c);
      const hasInterleavingBefore = list.slice(0, i).some((s) => s?.kind !== "text");
      // Interleaved timeline already covers canonical prose; drop terminal full-body echo.
      if (
        hasInterleavingBefore &&
        normPrior &&
        normBody &&
        normCanon &&
        normBody === normCanon &&
        (normCanon.includes(normPrior) || (compactPrior && compactCanon.includes(compactPrior)))
      ) {
        continue;
      }
    }
    const tail = canonicalTailForLastTextSegment(list, i, c);
    if (typeof tail === "string" && !tail.trim()) {
      // Earlier text segments already cover canonical prose; avoid emitting
      // one final full-body text block that duplicates the whole narrative.
      continue;
    }
    out.push({
      kind: "text",
      body: preferLongerAssistantText(String(seg.body ?? ""), tail),
    });
  }
  return trimTimeline(dedupeEarlierTextCoveredByLast(out));
}

/**
 * Align timeline prose with a terminal `content_sync` without shortening prior deltas.
 * @param {AssistantTimelineSegment[] | undefined} prev
 * @param {string | undefined} content
 * @param {string | undefined} thinking
 */
export function mergeTimelineContentSync(prev, content, thinking) {
  let list = Array.isArray(prev) ? [...prev] : [];
  const c = typeof content === "string" ? content : "";
  const th = typeof thinking === "string" ? thinking : "";

  if (c.trim()) {
    list = reconcileTimelineWithCanonicalText(list, c);
  }

  if (th.trim()) {
    const last = list[list.length - 1];
    if (last?.kind === "thinking") {
      list[list.length - 1] = { kind: "thinking", body: preferLongerAssistantText(last.body, th) };
    } else {
      list.push({ kind: "thinking", body: th });
    }
  }

  return trimTimeline(list);
}

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
    list[list.length - 1] = { kind: "text", body: mergeAssistantTextChunk(last.body, delta) };
    return trimTimeline(list);
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
    list[list.length - 1] = { kind: "thinking", body: mergeAssistantTextChunk(last.body, delta) };
    return trimTimeline(list);
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
