import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CHAT_SESSION_CHANNEL_WECHAT,
  deriveTitleFromMessages,
  getSession,
  newGatewayConversationId,
  upsertSession,
} from "./chatSessionsStore.js";
import { useChatLabStreaming } from "../context/ChatLabStreamingContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";

/** In-memory placeholder while gateway auto-reply is streaming (never persist). */
export function isWechatPendingAssistantId(id) {
  return String(id ?? "").startsWith("wechat-replying-");
}

/**
 * Always-mounted bridge: persist WeChat threads to sidebar storage, navigate, and
 * track auto-reply streaming state for the history list spinner.
 */
export function useWechatSessionSync() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { setWechatReplyingSessionId, clearWechatReplyingSessionId } = useChatLabStreaming();

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.onWechatStatus) return undefined;

    const off = bridge.onWechatStatus((evt) => {
      if (!evt || typeof evt !== "object") return;
      const type = String(evt.type ?? "");

      if (type === "inbound") {
        const cid = String(evt.conversationId ?? "").trim();
        const peerId = String(evt.peerId ?? "").trim();
        const text = String(evt.text ?? "").trim();
        const msgId = String(evt.messageId ?? "").trim();
        if (!cid || !peerId || !text || !msgId) return;

        const startedNewThread = evt.startedNewThread === true;
        if (getSession(cid)?.messages?.some((m) => m.id === msgId)) return;
        const existing = startedNewThread ? null : getSession(cid);
        const prior = startedNewThread ? [] : Array.isArray(existing?.messages) ? existing.messages : [];
        if (!startedNewThread && prior.some((m) => m.id === msgId)) return;

        const incomingTs = typeof evt.ts === "number" ? evt.ts : Date.now();
        const persistable = [
          ...prior.filter((m) => m.id !== msgId),
          { id: msgId, role: "user", content: text, createdAt: incomingTs },
        ];
        const title = deriveTitleFromMessages(persistable, {
          imageFallback: t("chatLab.chatUntitledImage"),
        });
        const gatewayConversationId = startedNewThread
          ? newGatewayConversationId()
          : String(existing?.gatewayConversationId ?? "").trim() || newGatewayConversationId();
        upsertSession(cid, title || "…", persistable, {
          channel: CHAT_SESSION_CHANNEL_WECHAT,
          channelPeerId: peerId,
          gatewayConversationId,
        });
        if (startedNewThread) {
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-wechat-session-created", {
                detail: { conversationId: cid, peerId },
              }),
            );
          } catch {
            /* ignore */
          }
        }
        setWechatReplyingSessionId(cid);
        try {
          window.dispatchEvent(
            new CustomEvent("openstudio-wechat-session-inbound", {
              detail: { conversationId: cid, messageId: msgId, peerId, text },
            }),
          );
        } catch {
          /* ignore */
        }
        navigate(`/chat?c=${encodeURIComponent(cid)}`, { replace: false });
        return;
      }

      if (type === "auto_reply_started") {
        const cid = String(evt.conversationId ?? "").trim();
        if (cid) setWechatReplyingSessionId(cid);
        return;
      }

      if (type === "assistant_reply") {
        const cid = String(evt.conversationId ?? "").trim();
        const peerId = String(evt.peerId ?? "").trim();
        const text = String(evt.text ?? "").trim();
        const msgId = String(evt.messageId ?? "").trim();
        const sourceMessageId = String(evt.sourceMessageId ?? "").trim();
        if (!cid || !peerId || !text || !msgId) return;

        clearWechatReplyingSessionId(cid);
        const existing = getSession(cid);
        const prior = Array.isArray(existing?.messages) ? existing.messages : [];
        if (prior.some((m) => m.id === msgId)) return;

        const pendingAssistantId = sourceMessageId ? `wechat-replying-${sourceMessageId}` : "";
        const ts = typeof evt.ts === "number" ? evt.ts : Date.now();
        const persistable = [
          ...prior.filter((m) => m.id !== pendingAssistantId && m.id !== msgId),
          { id: msgId, role: "assistant", content: text, createdAt: ts },
        ];
        const title = deriveTitleFromMessages(persistable, {
          imageFallback: t("chatLab.chatUntitledImage"),
        });
        upsertSession(cid, title || "…", persistable, {
          channel: CHAT_SESSION_CHANNEL_WECHAT,
          channelPeerId: peerId,
        });
        navigate(`/chat?c=${encodeURIComponent(cid)}`, { replace: false });
        return;
      }

      if (type === "assistant_reply_error") {
        const cid = String(evt.conversationId ?? "").trim();
        if (cid) clearWechatReplyingSessionId(cid);
      }
    });

    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [navigate, setWechatReplyingSessionId, clearWechatReplyingSessionId, t]);
}
