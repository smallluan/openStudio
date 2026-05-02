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

/** @typedef {{
 *   streamingSessionId: string | null;
 *   gatewayStreamSlice: GatewayStreamSlice | null;
 *   beginGatewayStream: (args: {
 *     conversationId: string;
 *     streamId: string;
 *     assistantMessageId: string;
 *   }) => void;
 *   resetGatewayStream: (streamId: string) => void;
 * }} ChatLabStreamingApi */

/** @typedef {{
 *   conversationId: string;
 *   streamId: string;
 *   assistantMessageId: string;
 *   content: string;
 *   thinking: string;
 *   active: boolean;
 * }} GatewayStreamSlice */

/** @type {import("react").Context<ChatLabStreamingApi | null>} */
const ChatLabStreamingContext = createContext(null);

const PERSIST_MS = 420;

/**
 * @param {string} conversationId
 * @param {string} assistantMessageId
 * @param {string} content
 * @param {string} thinking
 */
function persistAssistantMerge(conversationId, assistantMessageId, content, thinking) {
  const rec = getSession(conversationId);
  if (!rec) return;
  const messages = rec.messages.map((m) => {
    if (m.id !== assistantMessageId) return m;
    const prevC = String(m.content ?? "");
    const prevT = String(m.thinking ?? "");
    const incC = typeof content === "string" ? content : "";
    const incT = typeof thinking === "string" ? thinking : "";
    const nextC = incC.trim().length > 0 || prevC.trim().length === 0 ? incC : prevC;
    const nextT = incT.trim().length > 0 || prevT.trim().length === 0 ? incT : prevT;
    /** @type {typeof m} */
    const row = { ...m, content: nextC };
    if (nextT.trim()) row.thinking = nextT;
    else delete row.thinking;
    return row;
  });
  const flat = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    ...(m.thinking ? { thinking: m.thinking } : {}),
  }));
  const title = deriveTitleFromMessages(flat);
  upsertSession(conversationId, title || "…", messages);
}

export function ChatLabStreamingProvider({ children }) {
  const [streamingSessionId, setStreamingSessionIdState] = useState(/** @type {string | null} */ (null));
  const [gatewayStreamSlice, setGatewayStreamSlice] = useState(/** @type {GatewayStreamSlice | null} */ (null));

  const sliceRef = useRef(/** @type {GatewayStreamSlice | null} */ (null));
  const persistTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  /** Active gateway stream id; keeps matching `done`/`error` after a terminal clears React slice (main always sends `done`). */
  const processingStreamIdRef = useRef(/** @type {string | null} */ (null));

  useEffect(() => {
    sliceRef.current = gatewayStreamSlice;
  }, [gatewayStreamSlice]);

  useEffect(() => {
    if (gatewayStreamSlice?.active && gatewayStreamSlice.conversationId) {
      setStreamingSessionIdState(gatewayStreamSlice.conversationId);
    } else {
      setStreamingSessionIdState(null);
    }
  }, [gatewayStreamSlice?.active, gatewayStreamSlice?.conversationId]);

  const beginGatewayStream = useCallback((args) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    processingStreamIdRef.current = args.streamId;
    const next = {
      conversationId: args.conversationId,
      streamId: args.streamId,
      assistantMessageId: args.assistantMessageId,
      content: "",
      thinking: "",
      active: true,
    };
    sliceRef.current = next;
    setGatewayStreamSlice(next);
  }, []);

  const resetGatewayStream = useCallback((streamId) => {
    if (processingStreamIdRef.current !== streamId) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    processingStreamIdRef.current = null;
    sliceRef.current = null;
    setGatewayStreamSlice(null);
  }, []);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.onChatStream) return undefined;

    const schedulePersist = () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        const s = sliceRef.current;
        if (!s?.active || !s.conversationId) return;
        persistAssistantMerge(s.conversationId, s.assistantMessageId, s.content, s.thinking);
      }, PERSIST_MS);
    };

    const flushPersistNow = () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const s = sliceRef.current;
      if (!s?.conversationId) return;
      persistAssistantMerge(s.conversationId, s.assistantMessageId, s.content, s.thinking);
    };

    const clearSlice = () => {
      sliceRef.current = null;
      setGatewayStreamSlice(null);
    };

    const endProcessing = (streamId) => {
      if (processingStreamIdRef.current === streamId) processingStreamIdRef.current = null;
    };

    /** Read stream buffer for terminal handlers — must stay in sync without waiting for React batching. */
    const snapshotSlice = () => {
      const s = sliceRef.current;
      if (!s) {
        return {
          conversationId: "",
          assistantMessageId: "",
          content: "",
          thinking: "",
        };
      }
      return {
        conversationId: s.conversationId,
        assistantMessageId: s.assistantMessageId,
        content: s.content ?? "",
        thinking: s.thinking ?? "",
      };
    };

    const off = bridge.onChatStream((evt) => {
      if (!evt || typeof evt !== "object") return;
      if (!evt.streamId) return;

      const terminalKind =
        evt.type === "done" || evt.type === "error" || evt.type === "aborted" ? evt.type : null;
      if (terminalKind) {
        const cur = sliceRef.current;
        if (!cur || cur.streamId !== evt.streamId) return;
      } else if (evt.streamId !== processingStreamIdRef.current) {
        return;
      }

      switch (evt.type) {
        case "content_sync": {
          const prev = sliceRef.current;
          if (!prev || prev.streamId !== evt.streamId) return;
          const next = {
            ...prev,
            content: typeof evt.content === "string" ? evt.content : prev.content ?? "",
            thinking: typeof evt.thinking === "string" ? evt.thinking : prev.thinking ?? "",
          };
          sliceRef.current = next;
          setGatewayStreamSlice(next);
          schedulePersist();
          return;
        }
        case "thinking":
          if (typeof evt.delta !== "string") return;
          {
            const prev = sliceRef.current;
            if (!prev || prev.streamId !== evt.streamId) return;
            const next = { ...prev, thinking: (prev.thinking ?? "") + evt.delta };
            sliceRef.current = next;
            setGatewayStreamSlice(next);
          }
          schedulePersist();
          return;
        case "text":
          if (typeof evt.delta !== "string") return;
          {
            const prev = sliceRef.current;
            if (!prev || prev.streamId !== evt.streamId) return;
            const next = { ...prev, content: (prev.content ?? "") + evt.delta };
            sliceRef.current = next;
            setGatewayStreamSlice(next);
          }
          schedulePersist();
          return;
        case "meta":
        case "usage":
          return;
        case "aborted": {
          const sid = evt.streamId;
          const snap = snapshotSlice();
          flushPersistNow();
          clearSlice();
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("aborted"),
                  conversationId: snap.conversationId,
                  assistantMessageId: snap.assistantMessageId,
                  content: snap.content,
                  thinking: snap.thinking,
                },
              }),
            );
          } catch {
            /* ignore */
          }
          endProcessing(sid);
          return;
        }
        case "error": {
          const sid = evt.streamId;
          const snap = snapshotSlice();
          const raw = String(evt.message ?? "");
          flushPersistNow();
          clearSlice();
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
                },
              }),
            );
          } catch {
            /* ignore */
          }
          endProcessing(sid);
          return;
        }
        case "done": {
          const sid = evt.streamId;
          const snap = snapshotSlice();
          flushPersistNow();
          clearSlice();
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-gateway-chat-terminal", {
                detail: {
                  kind: /** @type {const} */ ("done"),
                  conversationId: snap.conversationId,
                  assistantMessageId: snap.assistantMessageId,
                  content: snap.content,
                  thinking: snap.thinking,
                },
              }),
            );
          } catch {
            /* ignore */
          }
          endProcessing(sid);
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
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  const value = useMemo(
    () => ({
      streamingSessionId,
      gatewayStreamSlice,
      beginGatewayStream,
      resetGatewayStream,
    }),
    [streamingSessionId, gatewayStreamSlice, beginGatewayStream, resetGatewayStream],
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
      beginGatewayStream: () => {},
      resetGatewayStream: () => {},
    };
  }
  return ctx;
}

/** @param {string} conversationId */
export function useGatewayStreamSlice(conversationId) {
  const { gatewayStreamSlice } = useChatLabStreaming();
  if (!gatewayStreamSlice || gatewayStreamSlice.conversationId !== conversationId) return null;
  return gatewayStreamSlice;
}
