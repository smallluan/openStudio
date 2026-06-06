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

/** @typedef {Record<string, GatewayStreamSlice>} GatewayStreamMap */

/** @typedef {{
 *   streamingSessionId: string | null;
 *   gatewayStreamSlice: GatewayStreamSlice | null;
 *   gatewayStreams: GatewayStreamMap;
 *   isSessionStreaming: (conversationId: string) => boolean;
 *   setWechatReplyingSessionId: (conversationId: string | null) => void;
 *   clearWechatReplyingSessionId: (conversationId: string) => void;
 *   beginGatewayStream: (args: {
 *     conversationId: string;
 *     streamId: string;
 *     assistantMessageId: string;
 *   }) => void;
 *   resetGatewayStream: (streamId: string) => void;
 * }} ChatLabStreamingApi */

/** @type {import("react").Context<ChatLabStreamingApi | null>} */
const ChatLabStreamingContext = createContext(null);

const PERSIST_MS = 420;
/** Delay before treating `done` as final — some gateways flush one last delta right after signalling end */
const STREAM_DONE_GRACE_MS = 1600;

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

/** @param {GatewayStreamMap} map */
function cloneStreamMap(map) {
  return { ...map };
}

export function ChatLabStreamingProvider({ children }) {
  const [gatewayStreams, setGatewayStreams] = useState(/** @type {GatewayStreamMap} */ ({}));
  const [wechatReplyingSessionIds, setWechatReplyingSessionIds] = useState(
    /** @type {Set<string>} */ (() => new Set()),
  );

  const streamsRef = useRef(/** @type {GatewayStreamMap} */ ({}));
  /** @type {import("react").MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
  const persistTimersRef = useRef(new Map());
  /** @type {import("react").MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
  const doneGraceTimersRef = useRef(new Map());

  useEffect(() => {
    streamsRef.current = gatewayStreams;
  }, [gatewayStreams]);

  const syncStreamsState = useCallback(() => {
    setGatewayStreams(cloneStreamMap(streamsRef.current));
  }, []);

  const setWechatReplyingSessionId = useCallback((conversationId) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    setWechatReplyingSessionIds((prev) => {
      if (prev.has(cid)) return prev;
      const next = new Set(prev);
      next.add(cid);
      return next;
    });
  }, []);

  const clearWechatReplyingSessionId = useCallback((conversationId) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    setWechatReplyingSessionIds((prev) => {
      if (!prev.has(cid)) return prev;
      const next = new Set(prev);
      next.delete(cid);
      return next;
    });
  }, []);

  const isSessionStreaming = useCallback(
    (conversationId) => {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid) return false;
      if (wechatReplyingSessionIds.has(cid)) return true;
      for (const slice of Object.values(streamsRef.current)) {
        if (slice.active && slice.conversationId === cid) return true;
      }
      return false;
    },
    [wechatReplyingSessionIds, gatewayStreams],
  );

  const streamingSessionId = useMemo(() => {
    for (const slice of Object.values(gatewayStreams)) {
      if (slice.active && slice.conversationId) return slice.conversationId;
    }
    for (const cid of wechatReplyingSessionIds) return cid;
    return null;
  }, [gatewayStreams, wechatReplyingSessionIds]);

  const gatewayStreamSlice = useMemo(() => {
    const active = Object.values(gatewayStreams).filter((s) => s.active);
    return active.length > 0 ? active[active.length - 1] : null;
  }, [gatewayStreams]);

  const beginGatewayStream = useCallback(
    (args) => {
      const persistTimer = persistTimersRef.current.get(args.streamId);
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimersRef.current.delete(args.streamId);
      }
      const doneTimer = doneGraceTimersRef.current.get(args.streamId);
      if (doneTimer) {
        clearTimeout(doneTimer);
        doneGraceTimersRef.current.delete(args.streamId);
      }
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
      streamsRef.current = { ...streamsRef.current, [args.streamId]: next };
      syncStreamsState();
    },
    [syncStreamsState],
  );

  const resetGatewayStream = useCallback(
    (streamId) => {
      if (!streamsRef.current[streamId]) return;
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
      const next = { ...streamsRef.current };
      delete next[streamId];
      streamsRef.current = next;
      syncStreamsState();
    },
    [syncStreamsState],
  );

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.onChatStream) return undefined;

    /** @param {string} streamId @param {GatewayStreamSlice} slice */
    const schedulePersist = (streamId, slice) => {
      const existing = persistTimersRef.current.get(streamId);
      if (existing) clearTimeout(existing);
      persistTimersRef.current.set(
        streamId,
        setTimeout(() => {
          persistTimersRef.current.delete(streamId);
          const cur = streamsRef.current[streamId];
          if (!cur?.active || !cur.conversationId) return;
          persistAssistantMerge(
            cur.conversationId,
            cur.assistantMessageId,
            cur.content,
            cur.thinking,
            cur.toolTrace ?? [],
            cur.activityLog ?? [],
            cur.assistantTimeline ?? [],
          );
        }, PERSIST_MS),
      );
    };

    /** @param {string} streamId */
    const flushPersistNow = (streamId) => {
      const persistTimer = persistTimersRef.current.get(streamId);
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimersRef.current.delete(streamId);
      }
      const s = streamsRef.current[streamId];
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
    const clearStream = (streamId) => {
      if (!streamsRef.current[streamId]) return;
      const next = { ...streamsRef.current };
      delete next[streamId];
      streamsRef.current = next;
      syncStreamsState();
    };

    /** @param {string} streamId */
    const snapshotSlice = (streamId) => {
      const s = streamsRef.current[streamId];
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
      const timer = doneGraceTimersRef.current.get(streamId);
      if (timer != null) {
        clearTimeout(timer);
        doneGraceTimersRef.current.delete(streamId);
      }
    };

    /** @param {string} streamId */
    const scheduleDoneFinalize = (streamId) => {
      if (doneGraceTimersRef.current.has(streamId)) return;
      doneGraceTimersRef.current.set(
        streamId,
        setTimeout(() => {
          doneGraceTimersRef.current.delete(streamId);
          const cur = streamsRef.current[streamId];
          if (!cur) return;
          const snap = snapshotSlice(streamId);
          flushPersistNow(streamId);
          clearStream(streamId);
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("done"),
                  streamId,
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
        }, STREAM_DONE_GRACE_MS),
      );
    };

    /** @param {string} streamId @param {GatewayStreamSlice} next */
    const commitStream = (streamId, next) => {
      streamsRef.current = { ...streamsRef.current, [streamId]: next };
      syncStreamsState();
    };

    const off = bridge.onChatStream((evt) => {
      if (!evt || typeof evt !== "object") return;
      const streamId = typeof evt.streamId === "string" ? evt.streamId : "";
      if (!streamId) return;

      const terminalKind =
        evt.type === "done" || evt.type === "error" || evt.type === "aborted" ? evt.type : null;
      if (terminalKind) {
        if (!streamsRef.current[streamId]) return;
      } else if (!streamsRef.current[streamId]) {
        return;
      }

      switch (evt.type) {
        case "content_sync": {
          cancelPendingDoneFinalize(streamId);
          const prev = streamsRef.current[streamId];
          if (!prev) return;
          const content = preferLongerAssistantText(
            prev.content ?? "",
            typeof evt.content === "string" ? evt.content : "",
          );
          const thinking = preferLongerAssistantText(
            prev.thinking ?? "",
            typeof evt.thinking === "string" ? evt.thinking : "",
          );
          const assistantTimeline = mergeTimelineContentSync(prev.assistantTimeline, content, thinking);
          commitStream(streamId, { ...prev, content, thinking, assistantTimeline });
          schedulePersist(streamId, prev);
          return;
        }
        case "tool_trace": {
          cancelPendingDoneFinalize(streamId);
          const prev = streamsRef.current[streamId];
          if (!prev) return;
          const toolTrace = mergeToolTrace(prev.toolTrace, evt);
          const assistantTimeline = mergeTimelineToolTrace(prev.assistantTimeline, evt);
          commitStream(streamId, { ...prev, toolTrace, assistantTimeline });
          schedulePersist(streamId, prev);
          return;
        }
        case "agent_activity": {
          cancelPendingDoneFinalize(streamId);
          const prev = streamsRef.current[streamId];
          if (!prev) return;
          const activityLog = mergeActivityLog(prev.activityLog, evt);
          const assistantTimeline = mergeTimelineAgentActivity(prev.assistantTimeline, evt);
          commitStream(streamId, { ...prev, activityLog, assistantTimeline });
          schedulePersist(streamId, prev);
          return;
        }
        case "thinking":
          cancelPendingDoneFinalize(streamId);
          if (typeof evt.delta !== "string") return;
          {
            const prev = streamsRef.current[streamId];
            if (!prev) return;
            const assistantTimeline = mergeTimelineThinkingDelta(prev.assistantTimeline, evt.delta);
            commitStream(streamId, {
              ...prev,
              thinking: mergeAssistantTextChunk(prev.thinking ?? "", evt.delta),
              assistantTimeline,
            });
          }
          schedulePersist(streamId, streamsRef.current[streamId]);
          return;
        case "text":
          cancelPendingDoneFinalize(streamId);
          if (typeof evt.delta !== "string") return;
          {
            const prev = streamsRef.current[streamId];
            if (!prev) return;
            const assistantTimeline = mergeTimelineTextDelta(prev.assistantTimeline, evt.delta);
            commitStream(streamId, {
              ...prev,
              content: mergeAssistantTextChunk(prev.content ?? "", evt.delta),
              assistantTimeline,
            });
          }
          schedulePersist(streamId, streamsRef.current[streamId]);
          return;
        case "meta":
        case "usage":
          return;
        case "aborted": {
          cancelPendingDoneFinalize(streamId);
          const snap = snapshotSlice(streamId);
          flushPersistNow(streamId);
          clearStream(streamId);
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("aborted"),
                  streamId,
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
          return;
        }
        case "error": {
          cancelPendingDoneFinalize(streamId);
          const snap = snapshotSlice(streamId);
          const raw = String(evt.message ?? "");
          flushPersistNow(streamId);
          clearStream(streamId);
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("error"),
                  streamId,
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
    };
  }, [syncStreamsState]);

  const value = useMemo(
    () => ({
      streamingSessionId,
      gatewayStreamSlice,
      gatewayStreams,
      isSessionStreaming,
      setWechatReplyingSessionId,
      clearWechatReplyingSessionId,
      beginGatewayStream,
      resetGatewayStream,
    }),
    [
      streamingSessionId,
      gatewayStreamSlice,
      gatewayStreams,
      isSessionStreaming,
      setWechatReplyingSessionId,
      clearWechatReplyingSessionId,
      beginGatewayStream,
      resetGatewayStream,
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
      gatewayStreamSlice: null,
      gatewayStreams: {},
      isSessionStreaming: () => false,
      setWechatReplyingSessionId: () => {},
      clearWechatReplyingSessionId: () => {},
      beginGatewayStream: () => {},
      resetGatewayStream: () => {},
    };
  }
  return ctx;
}

/** @param {string} conversationId */
export function useGatewayStreamSlice(conversationId) {
  const { gatewayStreams } = useChatLabStreaming();
  return useMemo(() => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return null;
    const active = Object.values(gatewayStreams).filter((s) => s.active && s.conversationId === cid);
    return active.length > 0 ? active[active.length - 1] : null;
  }, [gatewayStreams, conversationId]);
}
