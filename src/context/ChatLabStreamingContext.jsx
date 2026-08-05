import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deriveTitleFromMessages,
  getSession,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import {
  ensureTimelineCoversCanonicalText,
  mergeTimelineAgentActivity,
  mergeAssistantTextChunk,
  mergeTimelineContentSync,
  mergeTimelineTextDelta,
  mergeTimelineThinkingDelta,
  mergeTimelineToolTrace,
  preferLongerAssistantText,
} from "../chat/streamTimelineMerge.js";
import { mergeActivityLog, mergeToolTrace } from "../chat/toolTraceMerge.js";

/** @typedef {import("../chat/toolTraceMerge.js").ToolTraceRow} ToolTraceRow */
/** @typedef {import("../chat/toolTraceMerge.js").ActivityRow} ActivityRow */
/** @typedef {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment} AssistantTimelineSegment */

/** @typedef {{
 *   streamingSessionIds: Set<string>;
 *   streamingSessionId: string | null;
 *   wechatReplyingSessionId: string | null;
 *   gatewayStreamSlice: GatewayStreamSlice | null;
 *   slicesTick: number;
 *   listGatewayStreamSlices: (conversationId?: string) => GatewayStreamSlice[];
 *   beginGatewayStream: (args: {
 *     conversationId: string;
 *     streamId: string;
 *     assistantMessageId: string;
 *   }) => void;
 *   resetGatewayStream: (streamId: string) => void;
 *   setWechatReplyingSessionId: (conversationId: string) => void;
 *   clearWechatReplyingSessionId: (conversationId: string) => void;
 * }} ChatLabStreamingApi */

/** @typedef {{
 *   conversationId: string;
 *   streamId: string;
 *   assistantMessageId: string;
 *   content: string;
 *   thinking: string;
 *   active: boolean;
 *   toolTrace?: ToolTraceRow[];
 *   activityLog?: ActivityRow[];
 *   assistantTimeline?: AssistantTimelineSegment[];
 * }} GatewayStreamSlice */

/** @type {import("react").Context<ChatLabStreamingApi | null>} */
const ChatLabStreamingContext = createContext(null);

const PERSIST_MS = 420;
/** Brief post-`done` merge window for trailing IPC (text / tool_trace / content_sync); does not keep streaming UI active. */
const STREAM_DONE_TRAILING_MERGE_MS = 500;

/**
 * Collect all currently-active streaming conversationIds from the slice map.
 * @param {Map<string, GatewayStreamSlice>} slices
 * @returns {Set<string>}
 */
function collectActiveSessionIds(slices) {
  const ids = new Set();
  for (const s of slices.values()) {
    if (s.active && s.conversationId) ids.add(s.conversationId);
  }
  return ids;
}

/**
 * @param {string} conversationId
 * @param {string} assistantMessageId
 * @param {string} content
 * @param {string} thinking
 * @param {ToolTraceRow[] | undefined} toolTrace
 * @param {ActivityRow[] | undefined} activityLog
 * @param {AssistantTimelineSegment[] | undefined} assistantTimeline
 */
function persistAssistantMerge(
  conversationId,
  assistantMessageId,
  content,
  thinking,
  toolTrace,
  activityLog,
  assistantTimeline,
) {
  const rec = getSession(conversationId);
  if (!rec) return;
  const messages = rec.messages.map((m) => {
    if (m.id !== assistantMessageId) return m;
    const prevC = String(m.content ?? "");
    const prevT = String(m.thinking ?? "");
    const incC = typeof content === "string" ? content : "";
    const incT = typeof thinking === "string" ? thinking : "";
    const nextC = preferLongerAssistantText(prevC, incC);
    const nextT = preferLongerAssistantText(prevT, incT);
    const nextTl =
      Array.isArray(assistantTimeline) && assistantTimeline.length > 0
        ? ensureTimelineCoversCanonicalText(assistantTimeline, nextC)
        : assistantTimeline;
    /** @type {typeof m} */
    const row = { ...m, content: nextC };
    if (nextT.trim()) row.thinking = nextT;
    else delete row.thinking;
    if (Array.isArray(toolTrace) && toolTrace.length > 0) row.toolTrace = toolTrace;
    else if (Array.isArray(toolTrace) && toolTrace.length === 0) delete row.toolTrace;
    if (Array.isArray(activityLog) && activityLog.length > 0) row.activityLog = activityLog;
    else if (Array.isArray(activityLog) && activityLog.length === 0) delete row.activityLog;
    if (Array.isArray(nextTl) && nextTl.length > 0) row.assistantTimeline = nextTl;
    else if (Array.isArray(assistantTimeline) && assistantTimeline.length === 0) delete row.assistantTimeline;
    return row;
  });
  const title = deriveTitleFromMessages(messages);
  upsertSession(conversationId, title || "…", messages);
}

export function ChatLabStreamingProvider({ children }) {
  const [streamingSessionIds, setStreamingSessionIdsState] = useState(() => new Set());
  const [wechatReplyingSessionId, setWechatReplyingSessionIdState] = useState(/** @type {string | null} */ (null));
  const [slicesTick, setSlicesTick] = useState(0);

  /** @type {import("react").MutableRefObject<Map<string, GatewayStreamSlice>>} */
  const slicesRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
  const persistTimersRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
  const trailingMergeTimersRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Set<string>>} */
  const processingStreamIdsRef = useRef(new Set());

  const bumpSlices = useCallback(() => {
    setSlicesTick((t) => t + 1);
  }, []);

  const syncStreamingSessionId = useCallback(() => {
    setStreamingSessionIdsState(collectActiveSessionIds(slicesRef.current));
  }, []);

  const listGatewayStreamSlices = useCallback(
    /** @param {string} [conversationId] */
    (conversationId) => {
      const all = [...slicesRef.current.values()];
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid) return all;
      return all.filter((s) => s.conversationId === cid);
    },
    [],
  );

  const beginGatewayStream = useCallback(
    (args) => {
      processingStreamIdsRef.current.add(args.streamId);
      setWechatReplyingSessionIdState((cur) => (cur === args.conversationId ? null : cur));
      const existing = slicesRef.current.get(args.streamId);
      const next = existing
        ? {
            ...existing,
            conversationId: args.conversationId,
            streamId: args.streamId,
            assistantMessageId: args.assistantMessageId,
            active: true,
          }
        : {
            conversationId: args.conversationId,
            streamId: args.streamId,
            assistantMessageId: args.assistantMessageId,
            content: "",
            thinking: "",
            toolTrace: [],
            activityLog: [],
            assistantTimeline: [],
            active: true,
          };
      slicesRef.current.set(args.streamId, next);
      bumpSlices();
      syncStreamingSessionId();
    },
    [bumpSlices, syncStreamingSessionId],
  );

  const resetGatewayStream = useCallback(
    (streamId) => {
      if (!processingStreamIdsRef.current.has(streamId) && !slicesRef.current.has(streamId)) return;
      const persistTimer = persistTimersRef.current.get(streamId);
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimersRef.current.delete(streamId);
      }
      const trailingTimer = trailingMergeTimersRef.current.get(streamId);
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingMergeTimersRef.current.delete(streamId);
      }
      processingStreamIdsRef.current.delete(streamId);
      slicesRef.current.delete(streamId);
      bumpSlices();
      syncStreamingSessionId();
    },
    [bumpSlices, syncStreamingSessionId],
  );

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.onChatStream) return undefined;

    /** @param {string} streamId */
    const getSlice = (streamId) => slicesRef.current.get(streamId) ?? null;

    /** @param {string} streamId @param {GatewayStreamSlice} slice */
    const putSlice = (streamId, slice) => {
      slicesRef.current.set(streamId, slice);
      bumpSlices();
    };

    /** @param {string} streamId */
    const removeSlice = (streamId) => {
      slicesRef.current.delete(streamId);
      bumpSlices();
    };

    /** @param {string} streamId */
    const schedulePersist = (streamId) => {
      const s = getSlice(streamId);
      if (!s?.conversationId) return;
      if (!s.active) {
        persistAssistantMerge(
          s.conversationId,
          s.assistantMessageId,
          s.content,
          s.thinking,
          s.toolTrace ?? [],
          s.activityLog ?? [],
          s.assistantTimeline ?? [],
        );
        return;
      }
      const existing = persistTimersRef.current.get(streamId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        persistTimersRef.current.delete(streamId);
        const cur = getSlice(streamId);
        if (!cur?.conversationId) return;
        if (!cur.active && !trailingMergeTimersRef.current.has(streamId)) return;
        persistAssistantMerge(
          cur.conversationId,
          cur.assistantMessageId,
          cur.content,
          cur.thinking,
          cur.toolTrace ?? [],
          cur.activityLog ?? [],
          cur.assistantTimeline ?? [],
        );
      }, PERSIST_MS);
      persistTimersRef.current.set(streamId, timer);
    };

    /** @param {string} streamId */
    const flushPersistNow = (streamId) => {
      const existing = persistTimersRef.current.get(streamId);
      if (existing) {
        clearTimeout(existing);
        persistTimersRef.current.delete(streamId);
      }
      const s = getSlice(streamId);
      if (!s?.conversationId) return;
      persistAssistantMerge(
        s.conversationId,
        s.assistantMessageId,
        s.content,
        s.thinking,
        s.toolTrace ?? [],
        s.activityLog ?? [],
        s.assistantTimeline ?? [],
      );
    };

    /** @param {string} streamId */
    const endProcessing = (streamId) => {
      processingStreamIdsRef.current.delete(streamId);
      syncStreamingSessionId();
    };

    /** @param {string} streamId */
    const snapshotSlice = (streamId) => {
      const s = getSlice(streamId);
      if (!s) {
        return {
          conversationId: "",
          assistantMessageId: "",
          content: "",
          thinking: "",
          toolTrace: [],
          activityLog: [],
          assistantTimeline: [],
        };
      }
      return {
        conversationId: s.conversationId,
        assistantMessageId: s.assistantMessageId,
        content: s.content ?? "",
        thinking: s.thinking ?? "",
        toolTrace: s.toolTrace ?? [],
        activityLog: s.activityLog ?? [],
        assistantTimeline: s.assistantTimeline ?? [],
      };
    };

    /** @param {string} streamId */
    const scheduleTrailingSliceCleanup = (streamId) => {
      const existing = trailingMergeTimersRef.current.get(streamId);
      if (existing) clearTimeout(existing);
      const sid = streamId;
      const timer = setTimeout(() => {
        trailingMergeTimersRef.current.delete(sid);
        flushPersistNow(sid);
        removeSlice(sid);
      }, STREAM_DONE_TRAILING_MERGE_MS);
      trailingMergeTimersRef.current.set(sid, timer);
    };

    /** @param {string} streamId */
    const bumpTrailingSliceCleanup = (streamId) => {
      if (!trailingMergeTimersRef.current.has(streamId)) return;
      scheduleTrailingSliceCleanup(streamId);
    };

    /** @param {string} streamId */
    const clearTrailingSliceCleanup = (streamId) => {
      const timer = trailingMergeTimersRef.current.get(streamId);
      if (timer) {
        clearTimeout(timer);
        trailingMergeTimersRef.current.delete(streamId);
      }
    };

    /** @param {string} streamId */
    const finalizeDoneNow = (streamId) => {
      const cur = getSlice(streamId);
      if (!cur || cur.streamId !== streamId) {
        endProcessing(streamId);
        return;
      }
      const assistantTimeline = ensureTimelineCoversCanonicalText(
        cur.assistantTimeline ?? [],
        cur.content ?? "",
      );
      putSlice(streamId, { ...cur, active: false, assistantTimeline });
      syncStreamingSessionId();
      const snap = snapshotSlice(streamId);
      flushPersistNow(streamId);
      try {
        window.dispatchEvent(
          new CustomEvent("openstudio-gateway-chat-terminal", {
            detail: {
              kind: /** @type {const} */ ("done"),
              conversationId: snap.conversationId,
              assistantMessageId: snap.assistantMessageId,
              content: snap.content,
              thinking: snap.thinking,
              toolTrace: snap.toolTrace ?? [],
              activityLog: snap.activityLog ?? [],
              assistantTimeline: snap.assistantTimeline ?? [],
            },
          }),
        );
      } catch {
        /* ignore */
      }
      endProcessing(streamId);
      scheduleTrailingSliceCleanup(streamId);
    };

    /** @param {string} streamId @param {Record<string, unknown>} evt */
    const ensureSliceForStream = (streamId, evt) => {
      const prev = getSlice(streamId);
      if (prev) return prev;
      const assistantMessageId =
        typeof evt.assistantMessageId === "string" ? evt.assistantMessageId.trim() : "";
      const conversationId = typeof evt.conversationId === "string" ? evt.conversationId.trim() : "";
      if (!assistantMessageId || !conversationId) return null;
      processingStreamIdsRef.current.add(streamId);
      const created = {
        conversationId,
        streamId,
        assistantMessageId,
        content: "",
        thinking: "",
        toolTrace: [],
        activityLog: [],
        assistantTimeline: [],
        active: true,
      };
      putSlice(streamId, created);
      return created;
    };

    const off = bridge.onChatStream((evt) => {
      if (!evt || typeof evt !== "object") return;
      if (!evt.streamId) return;
      const streamId = String(evt.streamId);

      const terminalKind =
        evt.type === "done" || evt.type === "error" || evt.type === "aborted" ? evt.type : null;
      if (terminalKind) {
        const cur = getSlice(streamId) ?? ensureSliceForStream(streamId, evt);
        if (!cur || cur.streamId !== streamId) return;
      } else if (!processingStreamIdsRef.current.has(streamId)) {
        if (!ensureSliceForStream(streamId, evt)) return;
      }

      switch (evt.type) {
        case "content_sync": {
          const prev = getSlice(streamId);
          if (!prev || prev.streamId !== streamId) return;
          const content = preferLongerAssistantText(
            prev.content ?? "",
            typeof evt.content === "string" ? evt.content : "",
          );
          const thinking = preferLongerAssistantText(
            prev.thinking ?? "",
            typeof evt.thinking === "string" ? evt.thinking : "",
          );
          const assistantTimeline = mergeTimelineContentSync(prev.assistantTimeline, content, thinking);
          putSlice(streamId, { ...prev, content, thinking, assistantTimeline });
          schedulePersist(streamId);
          bumpTrailingSliceCleanup(streamId);
          return;
        }
        case "tool_trace": {
          const prev = getSlice(streamId);
          if (!prev || prev.streamId !== streamId) return;
          const toolTrace = mergeToolTrace(prev.toolTrace, evt);
          const assistantTimeline = mergeTimelineToolTrace(prev.assistantTimeline, evt);
          putSlice(streamId, { ...prev, toolTrace, assistantTimeline });
          schedulePersist(streamId);
          bumpTrailingSliceCleanup(streamId);
          return;
        }
        case "agent_activity": {
          const prev = getSlice(streamId);
          if (!prev || prev.streamId !== streamId) return;
          const activityLog = mergeActivityLog(prev.activityLog, evt);
          const assistantTimeline = mergeTimelineAgentActivity(prev.assistantTimeline, evt);
          putSlice(streamId, { ...prev, activityLog, assistantTimeline });
          schedulePersist(streamId);
          bumpTrailingSliceCleanup(streamId);
          return;
        }
        case "thinking":
          if (typeof evt.delta !== "string") return;
          {
            const prev = getSlice(streamId);
            if (!prev || prev.streamId !== streamId) return;
            const assistantTimeline = mergeTimelineThinkingDelta(prev.assistantTimeline, evt.delta);
            putSlice(streamId, {
              ...prev,
              thinking: mergeAssistantTextChunk(prev.thinking ?? "", evt.delta),
              assistantTimeline,
            });
          }
          schedulePersist(streamId);
          bumpTrailingSliceCleanup(streamId);
          return;
        case "text":
          if (typeof evt.delta !== "string") return;
          {
            const prev = getSlice(streamId);
            if (!prev || prev.streamId !== streamId) return;
            const content = mergeAssistantTextChunk(prev.content ?? "", evt.delta);
            const assistantTimeline = ensureTimelineCoversCanonicalText(
              mergeTimelineTextDelta(prev.assistantTimeline, evt.delta),
              content,
            );
            putSlice(streamId, {
              ...prev,
              content,
              assistantTimeline,
            });
          }
          schedulePersist(streamId);
          bumpTrailingSliceCleanup(streamId);
          return;
        case "meta":
        case "usage":
          return;
        case "aborted": {
          clearTrailingSliceCleanup(streamId);
          const snap = snapshotSlice(streamId);
          flushPersistNow(streamId);
          removeSlice(streamId);
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("aborted"),
                  conversationId: snap.conversationId,
                  assistantMessageId: snap.assistantMessageId,
                  content: snap.content,
                  thinking: snap.thinking,
                  toolTrace: snap.toolTrace ?? [],
                  activityLog: snap.activityLog ?? [],
                  assistantTimeline: snap.assistantTimeline ?? [],
                },
              }),
            );
          } catch {
            /* ignore */
          }
          endProcessing(streamId);
          return;
        }
        case "error": {
          clearTrailingSliceCleanup(streamId);
          const snap = snapshotSlice(streamId);
          const raw = String(evt.message ?? "");
          flushPersistNow(streamId);
          removeSlice(streamId);
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("error"),
                  conversationId: snap.conversationId,
                  assistantMessageId: snap.assistantMessageId,
                  message: raw,
                  content: snap.content,
                  thinking: snap.thinking,
                  toolTrace: snap.toolTrace ?? [],
                  activityLog: snap.activityLog ?? [],
                  assistantTimeline: snap.assistantTimeline ?? [],
                },
              }),
            );
          } catch {
            /* ignore */
          }
          endProcessing(streamId);
          return;
        }
        case "done": {
          finalizeDoneNow(streamId);
          return;
        }
        default:
          return;
      }
    });

    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
      for (const timer of persistTimersRef.current.values()) clearTimeout(timer);
      persistTimersRef.current.clear();
      for (const timer of trailingMergeTimersRef.current.values()) clearTimeout(timer);
      trailingMergeTimersRef.current.clear();
    };
  }, [bumpSlices, syncStreamingSessionId]);

  const setWechatReplyingSessionId = useCallback((conversationId) => {
    const cid = String(conversationId ?? "").trim();
    if (!cid) return;
    setWechatReplyingSessionIdState(cid);
  }, []);

  const clearWechatReplyingSessionId = useCallback((conversationId) => {
    const cid = String(conversationId ?? "").trim();
    setWechatReplyingSessionIdState((cur) => (cur === cid ? null : cur));
  }, []);

  /** Backwards-compatible single-value accessor: returns the first active streaming session id, or null. */
  const streamingSessionId = useMemo(() => {
    for (const id of streamingSessionIds) return id;
    return null;
  }, [streamingSessionIds]);

  const gatewayStreamSlice = useMemo(() => {
    void slicesTick;
    const all = [...slicesRef.current.values()];
    return all.find((s) => s.active) ?? all[0] ?? null;
  }, [slicesTick]);

  const value = useMemo(
    () => ({
      streamingSessionIds,
      streamingSessionId,
      wechatReplyingSessionId,
      gatewayStreamSlice,
      slicesTick,
      listGatewayStreamSlices,
      beginGatewayStream,
      resetGatewayStream,
      setWechatReplyingSessionId,
      clearWechatReplyingSessionId,
    }),
    [
      streamingSessionIds,
      streamingSessionId,
      wechatReplyingSessionId,
      gatewayStreamSlice,
      slicesTick,
      listGatewayStreamSlices,
      beginGatewayStream,
      resetGatewayStream,
      setWechatReplyingSessionId,
      clearWechatReplyingSessionId,
    ],
  );

  return <ChatLabStreamingContext.Provider value={value}>{children}</ChatLabStreamingContext.Provider>;
}

/** @returns {ChatLabStreamingApi} */
export function useChatLabStreaming() {
  const ctx = useContext(ChatLabStreamingContext);
  if (!ctx) {
    return {
      streamingSessionIds: new Set(),
      streamingSessionId: null,
      wechatReplyingSessionId: null,
      gatewayStreamSlice: null,
      slicesTick: 0,
      listGatewayStreamSlices: () => [],
      beginGatewayStream: () => {},
      resetGatewayStream: () => {},
      setWechatReplyingSessionId: () => {},
      clearWechatReplyingSessionId: () => {},
    };
  }
  return ctx;
}

/** @param {string} conversationId */
export function useGatewayStreamSlices(conversationId) {
  const { listGatewayStreamSlices, slicesTick } = useChatLabStreaming();
  return useMemo(() => {
    void slicesTick;
    return listGatewayStreamSlices(conversationId);
  }, [conversationId, listGatewayStreamSlices, slicesTick]);
}

/** @param {string} conversationId */
export function useGatewayStreamSlice(conversationId) {
  const slices = useGatewayStreamSlices(conversationId);
  return slices.length === 1 ? slices[0] : slices.find((s) => s.active) ?? slices[0] ?? null;
}
