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
/** Quiet period after `{ type: "done" }` before finalizing — absorbs trailing IPC deltas (resets on each late chunk). */
const STREAM_DONE_GRACE_MS = 450;

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
    /** @type {typeof m} */
    const row = { ...m, content: nextC };
    if (nextT.trim()) row.thinking = nextT;
    else delete row.thinking;
    if (Array.isArray(toolTrace) && toolTrace.length > 0) row.toolTrace = toolTrace;
    else if (Array.isArray(toolTrace) && toolTrace.length === 0) delete row.toolTrace;
    if (Array.isArray(activityLog) && activityLog.length > 0) row.activityLog = activityLog;
    else if (Array.isArray(activityLog) && activityLog.length === 0) delete row.activityLog;
    if (Array.isArray(assistantTimeline) && assistantTimeline.length > 0) row.assistantTimeline = assistantTimeline;
    else if (Array.isArray(assistantTimeline) && assistantTimeline.length === 0) delete row.assistantTimeline;
    return row;
  });
  const title = deriveTitleFromMessages(messages);
  upsertSession(conversationId, title || "…", messages);
}

export function ChatLabStreamingProvider({ children }) {
  const [streamingSessionId, setStreamingSessionIdState] = useState(/** @type {string | null} */ (null));
  const [wechatReplyingSessionId, setWechatReplyingSessionIdState] = useState(/** @type {string | null} */ (null));
  const [slicesTick, setSlicesTick] = useState(0);

  /** @type {import("react").MutableRefObject<Map<string, GatewayStreamSlice>>} */
  const slicesRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
  const persistTimersRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
  const doneGraceTimersRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Set<string>>} */
  const pendingDoneFinalizeRef = useRef(new Set());
  /** @type {import("react").MutableRefObject<Set<string>>} */
  const processingStreamIdsRef = useRef(new Set());

  const bumpSlices = useCallback(() => {
    setSlicesTick((t) => t + 1);
  }, []);

  const syncStreamingSessionId = useCallback(() => {
    const active = [...slicesRef.current.values()].find((s) => s.active);
    setStreamingSessionIdState(active?.conversationId ?? null);
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
      const next = {
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
      const doneTimer = doneGraceTimersRef.current.get(streamId);
      if (doneTimer) {
        clearTimeout(doneTimer);
        doneGraceTimersRef.current.delete(streamId);
      }
      pendingDoneFinalizeRef.current.delete(streamId);
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
      const existing = persistTimersRef.current.get(streamId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        persistTimersRef.current.delete(streamId);
        const s = getSlice(streamId);
        if (!s?.active || !s.conversationId) return;
        persistAssistantMerge(
          s.conversationId,
          s.assistantMessageId,
          s.content,
          s.thinking,
          s.toolTrace ?? [],
          s.activityLog ?? [],
          s.assistantTimeline ?? [],
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
    const cancelPendingDoneFinalize = (streamId) => {
      pendingDoneFinalizeRef.current.delete(streamId);
      const timer = doneGraceTimersRef.current.get(streamId);
      if (timer) {
        clearTimeout(timer);
        doneGraceTimersRef.current.delete(streamId);
      }
    };

    /** @param {string} streamId */
    const rescheduleDoneIfPending = (streamId) => {
      if (!pendingDoneFinalizeRef.current.has(streamId)) return;
      scheduleDoneFinalize(streamId);
    };

    /** @param {string} streamId */
    const scheduleDoneFinalize = (streamId) => {
      pendingDoneFinalizeRef.current.add(streamId);
      if (doneGraceTimersRef.current.has(streamId)) return;
      const sid = streamId;
      const timer = setTimeout(() => {
        doneGraceTimersRef.current.delete(sid);
        pendingDoneFinalizeRef.current.delete(sid);
        const cur = getSlice(sid);
        if (!cur || cur.streamId !== sid) {
          endProcessing(sid);
          return;
        }
        const snap = snapshotSlice(sid);
        flushPersistNow(sid);
        removeSlice(sid);
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
        endProcessing(sid);
      }, STREAM_DONE_GRACE_MS);
      doneGraceTimersRef.current.set(sid, timer);
    };

    const off = bridge.onChatStream((evt) => {
      if (!evt || typeof evt !== "object") return;
      if (!evt.streamId) return;
      const streamId = String(evt.streamId);

      const terminalKind =
        evt.type === "done" || evt.type === "error" || evt.type === "aborted" ? evt.type : null;
      if (terminalKind) {
        const cur = getSlice(streamId);
        if (!cur || cur.streamId !== streamId) return;
      } else if (!processingStreamIdsRef.current.has(streamId)) {
        return;
      }

      switch (evt.type) {
        case "content_sync": {
          cancelPendingDoneFinalize(streamId);
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
          rescheduleDoneIfPending(streamId);
          return;
        }
        case "tool_trace": {
          cancelPendingDoneFinalize(streamId);
          const prev = getSlice(streamId);
          if (!prev || prev.streamId !== streamId) return;
          const toolTrace = mergeToolTrace(prev.toolTrace, evt);
          const assistantTimeline = mergeTimelineToolTrace(prev.assistantTimeline, evt);
          putSlice(streamId, { ...prev, toolTrace, assistantTimeline });
          schedulePersist(streamId);
          rescheduleDoneIfPending(streamId);
          return;
        }
        case "agent_activity": {
          cancelPendingDoneFinalize(streamId);
          const prev = getSlice(streamId);
          if (!prev || prev.streamId !== streamId) return;
          const activityLog = mergeActivityLog(prev.activityLog, evt);
          const assistantTimeline = mergeTimelineAgentActivity(prev.assistantTimeline, evt);
          putSlice(streamId, { ...prev, activityLog, assistantTimeline });
          schedulePersist(streamId);
          rescheduleDoneIfPending(streamId);
          return;
        }
        case "thinking":
          cancelPendingDoneFinalize(streamId);
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
          rescheduleDoneIfPending(streamId);
          return;
        case "text":
          cancelPendingDoneFinalize(streamId);
          if (typeof evt.delta !== "string") return;
          {
            const prev = getSlice(streamId);
            if (!prev || prev.streamId !== streamId) return;
            const assistantTimeline = mergeTimelineTextDelta(prev.assistantTimeline, evt.delta);
            putSlice(streamId, {
              ...prev,
              content: mergeAssistantTextChunk(prev.content ?? "", evt.delta),
              assistantTimeline,
            });
          }
          schedulePersist(streamId);
          rescheduleDoneIfPending(streamId);
          return;
        case "meta":
        case "usage":
          return;
        case "aborted": {
          cancelPendingDoneFinalize(streamId);
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
          cancelPendingDoneFinalize(streamId);
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
          scheduleDoneFinalize(streamId);
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
      for (const timer of doneGraceTimersRef.current.values()) clearTimeout(timer);
      doneGraceTimersRef.current.clear();
      pendingDoneFinalizeRef.current.clear();
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

  const gatewayStreamSlice = useMemo(() => {
    void slicesTick;
    const all = [...slicesRef.current.values()];
    return all.find((s) => s.active) ?? all[0] ?? null;
  }, [slicesTick]);

  const value = useMemo(
    () => ({
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
