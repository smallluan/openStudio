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
 * Lifecycle terminal activities should render as the final timeline marker even when
 * a late text delta arrives right after `lifecycle:end`.
 * @param {AssistantTimelineSegment | undefined} seg
 */
function isTerminalLifecycleActivitySegment(seg) {
  if (!seg || seg.kind !== "activity") return false;
  const ref = String(seg.refId ?? "");
  return /^lifecycle:[^:]*:(end|error|failed|cancelled|canceled|complete|completed|ok)$/i.test(ref);
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

  // True prefix extensions must always win. Rejecting when `a` already contains
  // the short tail (e.g. repeated words / URL fragments) truncates mid-stream.
  if (b.startsWith(a)) return b;
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
 * Map compact (whitespace-stripped) prefix length back onto raw canonical suffix.
 * Used when timeline segments were joined without spaces but `content_sync` has spaces.
 * @param {string} canonical
 * @param {string} joinedRaw concatenation of prior timeline text segments
 */
function canonicalSuffixAfterCompactJoin(canonical, joinedRaw) {
  const c = typeof canonical === "string" ? canonical : "";
  const normJoined = normalizeCompactText(joinedRaw);
  const normC = normalizeCompactText(c);
  if (!normJoined || !normC.startsWith(normJoined) || normC.length <= normJoined.length) return "";
  let compactSeen = 0;
  let i = 0;
  while (i < c.length && compactSeen < normJoined.length) {
    if (!/\s/.test(c[i])) compactSeen += 1;
    i += 1;
  }
  return c.slice(i);
}

/**
 * When a post-tool text delta is a cumulative snapshot, keep only the new tail.
 * @param {string} prior accumulated prose from earlier timeline text segments
 * @param {string} chunk incoming delta or segment body
 */
function incrementalTextAfterPrior(prior, chunk) {
  const p = typeof prior === "string" ? prior : "";
  let b = typeof chunk === "string" ? chunk : "";
  if (!b.trim()) return b;
  if (!p.trim()) return b;

  if (b.startsWith(p)) return b.slice(p.length).trimStart();
  if (p.startsWith(b) || b === p) return "";

  const normCompactP = normalizeCompactText(p);
  const normCompactB = normalizeCompactText(b);
  if (normCompactP && normCompactB === normCompactP) return "";
  if (normCompactP && normCompactB.startsWith(normCompactP)) {
    return canonicalSuffixAfterCompactJoin(b, p);
  }

  const normP = normalizeCompareText(p);
  const normB = normalizeCompareText(b);
  if (normP && normB === normP) return "";
  if (normP && normB.startsWith(normP)) {
    let rawIdx = 0;
    let normIdx = 0;
    while (rawIdx < b.length && normIdx < normP.length) {
      const ch = b[rawIdx];
      if (/\s/.test(ch)) {
        rawIdx += 1;
        continue;
      }
      normIdx += 1;
      rawIdx += 1;
    }
    while (rawIdx < b.length && /\s/.test(b[rawIdx])) rawIdx += 1;
    return b.slice(rawIdx).trimStart();
  }

  const pin = p.slice(0, Math.min(220, p.length)).trim();
  if (pin.length >= 24) {
    const idx = b.indexOf(pin);
    if (idx >= 0) {
      const tail = b.slice(idx + pin.length).trimStart();
      if (tail && normalizeCompareText(tail) !== normP) return tail;
    }
  }

  // Prior prose may reappear inside a later cumulative snapshot — keep the
  // unmatched suffix instead of dropping the whole post-tool segment.
  if (normP.length >= 24 && normB.includes(normP)) {
    const idx = normB.indexOf(normP);
    if (idx >= 0) {
      let rawIdx = 0;
      let normIdx = 0;
      const target = idx + normP.length;
      while (rawIdx < b.length && normIdx < target) {
        const ch = b[rawIdx];
        if (/\s/.test(ch)) {
          rawIdx += 1;
          continue;
        }
        normIdx += 1;
        rawIdx += 1;
      }
      while (rawIdx < b.length && /\s/.test(b[rawIdx])) rawIdx += 1;
      const tail = b.slice(rawIdx).trimStart();
      if (tail) return tail;
    }
    return "";
  }

  return b;
}

/**
 * Strip cumulative rewrites across interleaved text segments (text → tool → text …).
 * @param {AssistantTimelineSegment[]} list
 */
function dedupeInterleavedCumulativeText(list) {
  if (!Array.isArray(list) || !list.length) return list;
  /** @type {AssistantTimelineSegment[]} */
  const out = [];
  let priorKept = "";
  for (const seg of list) {
    if (seg.kind !== "text") {
      out.push(seg);
      continue;
    }
    const body = incrementalTextAfterPrior(priorKept, String(seg.body ?? ""));
    if (!body.trim()) continue;
    out.push({ kind: "text", body });
    priorKept = mergeAssistantTextChunk(priorKept, body);
  }
  return out;
}

/**
 * Text that belongs in the last timeline prose block after earlier text segments.
 * Returns `null` when the tail cannot be derived safely — callers must keep the
 * existing segment body (never fall back to the full cumulative canonical string,
 * which causes mid-stream "prior + tool + prior+new" flicker).
 *
 * @param {AssistantTimelineSegment[]} list
 * @param {number} textIdx
 * @param {string} canonical
 * @returns {string | null}
 */
function canonicalTailForLastTextSegment(list, textIdx, canonical) {
  const c = typeof canonical === "string" ? canonical : "";
  if (!c.trim()) return c;

  const p = priorTextBeforeIndex(list, textIdx).trimEnd();
  if (!p) return c;
  if (c.startsWith(p)) {
    return c.slice(p.length).trimStart();
  }

  // Tolerant match: whitespace drift between streamed segments and content_sync.
  const normC = normalizeCompareText(c);
  const normP = normalizeCompareText(p);
  if (normP && normC.startsWith(normP)) {
    // Map normalized prefix length back onto raw canonical as best-effort tail.
    let rawIdx = 0;
    let normIdx = 0;
    while (rawIdx < c.length && normIdx < normP.length) {
      const ch = c[rawIdx];
      if (/\s/.test(ch)) {
        rawIdx += 1;
        continue;
      }
      normIdx += 1;
      rawIdx += 1;
    }
    while (rawIdx < c.length && /\s/.test(c[rawIdx])) rawIdx += 1;
    return c.slice(rawIdx).trimStart();
  }

  const pin = p.slice(0, Math.min(220, p.length)).trim();
  if (pin.length >= 40) {
    const idx = c.indexOf(pin);
    if (idx >= 0) {
      const tail = c.slice(idx + pin.length).trimStart();
      // Prefer pin-length slice; full `p.length` can overshoot when whitespace differs.
      if (tail) return tail;
    }
  }

  return null;
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
    const priorForGuard = priorTextBeforeIndex(list, i);
    const hasInterleavingBefore = list.slice(0, i).some((s) => s?.kind !== "text");
    const tail = canonicalTailForLastTextSegment(list, i, c);
    if (tail == null) {
      // Unresolvable tail (common mid-stream while tools interleave). Keep the
      // post-tool segment as streamed — do not expand it to full canonical.
      out.push(seg);
      continue;
    }
    if (typeof tail === "string" && !tail.trim()) {
      // Earlier text segments already cover canonical prose. Keep a distinct
      // post-tool body that is not yet folded into `content` (common while
      // trailing deltas / content_sync race), otherwise the UI flashes then
      // swallows the last prose block.
      const normBody = normalizeCompareText(body);
      const normCanon = normalizeCompareText(c);
      if (normBody && !normCanon.includes(normBody)) {
        out.push(seg);
      }
      continue;
    }
    if (hasInterleavingBefore && priorForGuard.trim()) {
      const normTail = normalizeCompareText(tail);
      const normPrior = normalizeCompareText(priorForGuard);
      const normCanon = normalizeCompareText(c);
      const normBody = normalizeCompareText(body);
      // Guard: never write cumulative body into the post-tool text slot.
      if (normTail === normCanon || (normPrior.length >= 12 && normTail.includes(normPrior))) {
        out.push(seg);
        continue;
      }
      // Last slot was polluted with full cumulative prose — replace with true tail.
      if (
        normBody === normCanon ||
        (normPrior.length >= 12 && normBody.includes(normPrior) && body.length > tail.length)
      ) {
        out.push({ kind: "text", body: tail });
        continue;
      }
    }
    out.push({
      kind: "text",
      body: preferLongerAssistantText(String(seg.body ?? ""), tail),
    });
  }
  return trimTimeline(dedupeInterleavedCumulativeText(dedupeEarlierTextCoveredByLast(out)));
}

/**
 * Ensure interleaved timeline prose is at least as complete as canonical `content`.
 * UI renders timeline segments (not `message.content`) whenever tools are present.
 * @param {AssistantTimelineSegment[] | undefined} list
 * @param {string | undefined} canonical
 */
export function ensureTimelineCoversCanonicalText(list, canonical) {
  const c = typeof canonical === "string" ? canonical : "";
  let tl = Array.isArray(list) ? [...list] : [];
  if (!c.trim()) return tl;
  tl = reconcileTimelineWithCanonicalText(tl, c);

  /** @type {number[]} */
  const textIdxs = [];
  for (let i = 0; i < tl.length; i++) {
    if (tl[i]?.kind === "text") textIdxs.push(i);
  }
  const joined = textIdxs.map((i) => String(tl[i].body ?? "")).join("");
  if (!joined.trim()) {
    return trimTimeline([{ kind: "text", body: c }, ...tl]);
  }

  const normJoined = normalizeCompactText(joined);
  const normC = normalizeCompactText(c);
  // Segments already cover canonical (only whitespace/newline drift) — do not rewrite the last slot.
  if (normJoined === normC) {
    return trimTimeline(tl);
  }

  if (preferLongerAssistantText(joined, c) !== c || c.length <= joined.length) {
    return trimTimeline(tl);
  }

  if (c.startsWith(joined)) {
    const tail = c.slice(joined.length);
    if (tail && textIdxs.length) {
      const last = textIdxs[textIdxs.length - 1];
      tl[last] = { kind: "text", body: String(tl[last].body ?? "") + tail };
    }
    return trimTimeline(tl);
  }

  // Whitespace drift between timeline segments and content_sync — append only the missing suffix.
  if (normC.startsWith(normJoined) && normC.length > normJoined.length && textIdxs.length) {
    const suffix = canonicalSuffixAfterCompactJoin(c, joined);
    if (suffix) {
      const last = textIdxs[textIdxs.length - 1];
      tl[last] = { kind: "text", body: String(tl[last].body ?? "") + suffix };
    }
    return trimTimeline(tl);
  }

  if (textIdxs.length) {
    const last = textIdxs[textIdxs.length - 1];
    const tail = canonicalTailForLastTextSegment(tl, last, c);
    if (typeof tail === "string" && tail.trim()) {
      tl[last] = {
        kind: "text",
        body: preferLongerAssistantText(String(tl[last].body ?? ""), tail),
      };
    }
  }
  return trimTimeline(tl);
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
    list = ensureTimelineCoversCanonicalText(list, c);
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
  let insertIdx = list.length;
  while (insertIdx > 0 && isTerminalLifecycleActivitySegment(list[insertIdx - 1])) {
    insertIdx--;
  }
  const prevAtInsert = list[insertIdx - 1];
  if (prevAtInsert?.kind === "text") {
    const segIdx = insertIdx - 1;
    const priorBefore = priorTextBeforeIndex(list, segIdx);
    const combined = mergeAssistantTextChunk(prevAtInsert.body, delta);
    let body = incrementalTextAfterPrior(priorBefore, combined);
    if (!body.trim()) {
      // Never drop a true growth of the segment body (content can still accumulate).
      if (combined.length > String(prevAtInsert.body ?? "").length) {
        if (priorBefore && combined.startsWith(priorBefore)) {
          body = combined.slice(priorBefore.length).trimStart() || combined;
        } else if (priorBefore.trim()) {
          const compactTail = canonicalSuffixAfterCompactJoin(combined, priorBefore);
          body = compactTail
            ? preferLongerAssistantText(String(prevAtInsert.body ?? ""), compactTail)
            : String(prevAtInsert.body ?? "");
        } else {
          body = combined;
        }
      } else {
        const fromDelta = incrementalTextAfterPrior(priorBefore, delta);
        if (!fromDelta.trim()) return trimTimeline(list);
        body = mergeAssistantTextChunk(String(prevAtInsert.body ?? ""), fromDelta);
        body = incrementalTextAfterPrior(priorBefore, body) || body;
      }
    }
    if (!body.trim()) return trimTimeline(list);
    list[segIdx] = { kind: "text", body };
    return trimTimeline(list);
  }
  const priorText = priorTextBeforeIndex(list, insertIdx);
  let body = incrementalTextAfterPrior(priorText, delta);
  if (!body.trim()) {
    // Cumulative snapshot after a tool: keep unmatched suffix rather than skipping.
    if (delta.trim() && priorText.trim() && normalizeCompareText(delta).includes(normalizeCompareText(priorText))) {
      body = incrementalTextAfterPrior(priorText, delta);
    }
    if (!body.trim()) return trimTimeline(list);
  }
  list.splice(insertIdx, 0, { kind: "text", body });
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
