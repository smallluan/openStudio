import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export const CHAT_HISTORY_ROW_PUSH_MS = 280;
export const CHAT_HISTORY_ROW_ENTER_MS = 340;
export const CHAT_HISTORY_ROW_LEAVE_MS = 260;
export const CHAT_HISTORY_ROW_COLLAPSE_MS = 280;

/** @typedef {'idle' | 'enter-push' | 'enter-push-active' | 'enter-in' | 'leave-out' | 'leave-collapse'} RowMotionPhase */

/**
 * Animate chat-history rows when sessions are added/removed/reordered in storage.
 * Add/remove detection uses the full session list; display list may be filtered.
 *
 * @param {import("../../chat/chatSessionsStore.js").ChatSessionRecord[]} allSessions
 * @param {import("../../chat/chatSessionsStore.js").ChatSessionRecord[]} filteredSessions
 */
export function useChatHistoryListMotion(allSessions, filteredSessions) {
  const allIdsKey = allSessions.map((s) => s.id).join("\0");
  const filteredIdsKey = filteredSessions.map((s) => s.id).join("\0");
  const filteredIdSet = useMemo(() => new Set(filteredSessions.map((s) => s.id)), [filteredIdsKey]);

  const prevAllIdsRef = useRef(/** @type {string[]} */ ([]));
  const prevFilteredIdsRef = useRef(/** @type {string[]} */ ([]));
  const prevAllSessionsRef = useRef(allSessions);
  const firstPaintRef = useRef(true);
  const rowRefsRef = useRef(/** @type {Map<string, HTMLElement>} */ (new Map()));
  const topsRef = useRef(/** @type {Map<string, number>} */ (new Map()));
  const timersRef = useRef(/** @type {Set<number>} */ (new Set()));
  const reducedMotionRef = useRef(false);

  const [motionById, setMotionById] = useState(() => new Map(/** @type {[string, RowMotionPhase][]} */ ([])));
  /** @type {[Array<{ session: import("../../chat/chatSessionsStore.js").ChatSessionRecord; index: number }>, import("react").Dispatch<import("react").SetStateAction<Array<{ session: import("../../chat/chatSessionsStore.js").ChatSessionRecord; index: number }>>>]} */
  const [leavingRows, setLeavingRows] = useState([]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current.clear();
    },
    [],
  );

  const schedule = useCallback((fn, ms) => {
    if (reducedMotionRef.current) {
      fn();
      return undefined;
    }
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  const patchMotion = useCallback((ids, phase) => {
    if (ids.length === 0) return;
    setMotionById((m) => {
      const n = new Map(m);
      for (const id of ids) n.set(id, phase);
      return n;
    });
  }, []);

  const clearMotion = useCallback((ids) => {
    if (ids.length === 0) return;
    setMotionById((m) => {
      const n = new Map(m);
      for (const id of ids) n.delete(id);
      return n;
    });
  }, []);

  const recordTops = useCallback(() => {
    const next = new Map();
    for (const [id, el] of rowRefsRef.current) {
      next.set(id, el.getBoundingClientRect().top);
    }
    topsRef.current = next;
  }, []);

  const flipRows = useCallback((prevIds, nextIds, skipIds) => {
    if (reducedMotionRef.current) return;
    const skip = skipIds ?? new Set();
    for (const id of nextIds) {
      if (skip.has(id)) continue;
      const prevIdx = prevIds.indexOf(id);
      const nextIdx = nextIds.indexOf(id);
      if (prevIdx === -1 || prevIdx === nextIdx) continue;
      const el = rowRefsRef.current.get(id);
      const prevTop = topsRef.current.get(id);
      if (!el || prevTop == null) continue;
      const newTop = el.getBoundingClientRect().top;
      const dy = prevTop - newTop;
      if (Math.abs(dy) < 0.5) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "";
          el.style.transform = "";
        });
      });
    }
  }, []);

  const startEnterSlide = useCallback(
    (ids) => {
      if (ids.length === 0) return;
      patchMotion(ids, "enter-in");
      schedule(() => clearMotion(ids), CHAT_HISTORY_ROW_ENTER_MS);
    },
    [clearMotion, patchMotion, schedule],
  );

  useLayoutEffect(() => {
    const allIds = allSessions.map((s) => s.id);
    const filteredIds = filteredSessions.map((s) => s.id);
    const prevAllIds = prevAllIdsRef.current;
    const prevFilteredIds = prevFilteredIdsRef.current;
    const prevAllSessions = prevAllSessionsRef.current;
    const prevFilteredSet = new Set(prevFilteredIds);

    if (firstPaintRef.current) {
      firstPaintRef.current = false;
      prevAllIdsRef.current = allIds;
      prevFilteredIdsRef.current = filteredIds;
      prevAllSessionsRef.current = allSessions;
      recordTops();
      return;
    }

    const prevSet = new Set(prevAllIds);
    const nextSet = new Set(allIds);
    const added = allIds.filter((id) => !prevSet.has(id));
    const removed = prevAllIds.filter((id) => !nextSet.has(id));
    const addedInView = added.filter((id) => filteredIdSet.has(id));
    const removedInView = removed.filter((id) => prevFilteredSet.has(id));
    const promotedInView = allIds.filter((id) => {
      if (!prevSet.has(id) || added.includes(id)) return false;
      if (!filteredIdSet.has(id)) return false;
      return allIds.indexOf(id) < prevAllIds.indexOf(id);
    });

    if (reducedMotionRef.current) {
      prevAllIdsRef.current = allIds;
      prevFilteredIdsRef.current = filteredIds;
      prevAllSessionsRef.current = allSessions;
      recordTops();
      return;
    }

    const animatingIds = new Set([...addedInView, ...removedInView, ...promotedInView]);

    if (removedInView.length > 0) {
      const prevMap = new Map(prevAllSessions.map((s) => [s.id, s]));
      setLeavingRows((rows) => {
        const existing = new Set(rows.map((r) => r.session.id));
        const extra = removedInView
          .filter((id) => !existing.has(id))
          .map((id) => ({
            session: /** @type {typeof allSessions[0]} */ (prevMap.get(id)),
            index: prevAllIds.indexOf(id),
          }))
          .filter((r) => r.session);
        return extra.length ? [...rows, ...extra] : rows;
      });
      patchMotion(removedInView, "leave-out");
      for (const id of removedInView) {
        schedule(() => {
          setMotionById((m) => {
            const n = new Map(m);
            if (n.get(id) === "leave-out") n.set(id, "leave-collapse");
            return n;
          });
        }, CHAT_HISTORY_ROW_LEAVE_MS);
        schedule(() => {
          setLeavingRows((rows) => rows.filter((r) => r.session.id !== id));
          clearMotion([id]);
        }, CHAT_HISTORY_ROW_LEAVE_MS + CHAT_HISTORY_ROW_COLLAPSE_MS);
      }
    }

    if (addedInView.length > 0) {
      patchMotion(addedInView, "enter-push");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setMotionById((m) => {
            const n = new Map(m);
            for (const id of addedInView) {
              if (n.get(id) === "enter-push") n.set(id, "enter-push-active");
            }
            return n;
          });
        });
      });
      for (const id of addedInView) {
        schedule(() => startEnterSlide([id]), CHAT_HISTORY_ROW_PUSH_MS);
      }
    } else if (promotedInView.length > 0) {
      startEnterSlide(promotedInView);
    }

    flipRows(prevAllIds, allIds, animatingIds);

    prevAllIdsRef.current = allIds;
    prevFilteredIdsRef.current = filteredIds;
    prevAllSessionsRef.current = allSessions;
    recordTops();
  }, [
    allIdsKey,
    allSessions,
    clearMotion,
    filteredIdSet,
    filteredIdsKey,
    filteredSessions,
    flipRows,
    patchMotion,
    recordTops,
    schedule,
    startEnterSlide,
  ]);

  const displaySessions = useMemo(() => {
    const liveIds = new Set(filteredSessions.map((s) => s.id));
    /** @type {typeof filteredSessions} */
    const merged = [...filteredSessions];
    const leaving = leavingRows.filter((r) => r.session && !liveIds.has(r.session.id));
    const sortedLeaving = [...leaving].sort((a, b) => a.index - b.index);
    for (const { session, index } of sortedLeaving) {
      const insertAt = Math.min(Math.max(0, index), merged.length);
      merged.splice(insertAt, 0, session);
    }
    return merged;
  }, [filteredSessions, leavingRows]);

  const registerRowRef = useCallback((id, node) => {
    if (node) rowRefsRef.current.set(id, node);
    else rowRefsRef.current.delete(id);
  }, []);

  const getRowMotion = useCallback((id) => motionById.get(id) ?? "idle", [motionById]);

  return { displaySessions, getRowMotion, registerRowRef };
};
