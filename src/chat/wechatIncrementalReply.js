/** @typedef {import("./streamTimelineMerge.js").AssistantTimelineSegment} AssistantTimelineSegment */

/**
 * Text paragraphs sealed by a following tool/activity gap (same rule as Chat Lab interleaved UI).
 * When `streamComplete`, the trailing text block is included even if no gap follows yet.
 *
 * @param {AssistantTimelineSegment[] | undefined} timeline
 * @param {boolean} streamComplete
 * @returns {Array<{ segmentIndex: number; body: string }>}
 */
export function listWechatSealedTextSegments(timeline, streamComplete) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];

  /** @type {Array<{ segmentIndex: number; body: string }>} */
  const out = [];
  let segmentIndex = 0;

  for (let i = 0; i < timeline.length; i++) {
    const seg = timeline[i];
    if (!seg || seg.kind !== "text") continue;

    const body = String(seg.body ?? "").trim();
    if (!body) {
      segmentIndex++;
      continue;
    }

    let hasToolGapAfter = false;
    for (let j = i + 1; j < timeline.length; j++) {
      const next = timeline[j];
      if (next?.kind === "text") break;
      if (next?.kind === "tool" || next?.kind === "activity") {
        hasToolGapAfter = true;
        break;
      }
    }

    const hasLaterText = timeline.slice(i + 1).some((s) => s?.kind === "text");
    const sealed = hasToolGapAfter || (streamComplete && !hasLaterText);

    if (sealed) {
      out.push({ segmentIndex, body });
    }
    segmentIndex++;
  }

  return out;
}

/**
 * @param {Map<string, Set<number>>} store
 * @param {string} key
 * @param {number} segmentIndex
 */
export function markWechatTextSegmentSent(store, key, segmentIndex) {
  let set = store.get(key);
  if (!set) {
    set = new Set();
    store.set(key, set);
  }
  set.add(segmentIndex);
}

/**
 * @param {Map<string, Set<number>>} store
 * @param {string} key
 * @param {number} segmentIndex
 */
export function wasWechatTextSegmentSent(store, key, segmentIndex) {
  return store.get(key)?.has(segmentIndex) ?? false;
}
