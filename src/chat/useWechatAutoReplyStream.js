import { useEffect, useRef } from "react";

import {

  CHAT_SESSION_CHANNEL_WECHAT,

  deriveTitleFromMessages,

  ensureWechatGatewayConversationId,

  getSession,

  upsertSession,

} from "./chatSessionsStore.js";

import { useChatLabStreaming } from "../context/ChatLabStreamingContext.jsx";

import { useI18n } from "../context/I18nContext.jsx";

import { startWechatTypingPulse } from "./wechatStreamTyping.js";
import { isWechatPendingAssistantId } from "./useWechatSessionSync.js";



/** @returns {string} */

function newStreamId() {

  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();

  return `ws_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;

}



/**

 * @param {import("./chatSessionsStore.js").PersistedChatMessage[]} messages

 */

function toGatewayHistoryRows(messages) {

  return messages

    .filter((m) => m.role === "user" || m.role === "assistant")

    .map((m) => {

      if (m.role === "user") {

        return { role: /** @type {const} */ ("user"), content: String(m.content ?? "") };

      }

      const content = String(m.content ?? "").trim();

      const thinking = String(m.thinking ?? "").trim();

      return { role: /** @type {const} */ ("assistant"), content: content || thinking || "" };

    });

}



/**

 * @param {string} conversationId

 * @param {string} assistantMessageId

 * @param {Record<string, unknown>} extra

 */

function finalizeWechatAssistantInStore(conversationId, assistantMessageId, extra) {

  const rec = getSession(conversationId);

  if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) return;

  const peerId = String(rec.channelPeerId ?? "").trim();

  const prior = Array.isArray(rec.messages) ? rec.messages : [];

  const content = String(extra.content ?? "").trim();

  const thinking = String(extra.thinking ?? "").trim();

  const error = typeof extra.error === "string" ? extra.error : "";

  const finalId = isWechatPendingAssistantId(assistantMessageId)

    ? assistantMessageId.replace(/^wechat-replying-/, "wechat-assistant-")

    : assistantMessageId;

  const ts = Date.now();

  const persistable = [

    ...prior.filter(

      (m) =>

        m.id !== assistantMessageId &&

        m.id !== finalId &&

        !isWechatPendingAssistantId(m.id),

    ),

    {

      id: finalId,

      role: /** @type {const} */ ("assistant"),

      content: error ? "" : content,

      ...(thinking ? { thinking } : {}),

      ...(Array.isArray(extra.toolTrace) && extra.toolTrace.length ? { toolTrace: extra.toolTrace } : {}),

      ...(Array.isArray(extra.activityLog) && extra.activityLog.length ? { activityLog: extra.activityLog } : {}),

      ...(Array.isArray(extra.assistantTimeline) && extra.assistantTimeline.length

        ? { assistantTimeline: extra.assistantTimeline }

        : {}),

      createdAt: ts,

    },

  ];

  const title = deriveTitleFromMessages(persistable);

  const gatewayConversationId = String(rec.gatewayConversationId ?? "").trim();
  upsertSession(conversationId, title || "…", persistable, {
    channel: CHAT_SESSION_CHANNEL_WECHAT,
    channelPeerId: peerId,
    ...(gatewayConversationId ? { gatewayConversationId } : {}),
  });

}



/**

 * Always-mounted: run WeChat inbound auto-replies through the same renderer `startChatStream`

 * path as Chat Lab (gateway + tools), then push the final answer back to WeChat.

 */

export function useWechatAutoReplyStream() {

  const { t } = useI18n();

  const {

    beginGatewayStream,

    resetGatewayStream,

    setWechatReplyingSessionId,

    clearWechatReplyingSessionId,

  } = useChatLabStreaming();

  /** @type {import("react").MutableRefObject<Set<string>>} */

  const inFlightInboundRef = useRef(new Set());

  /** @type {import("react").MutableRefObject<Set<string>>} */

  const sentWechatAssistantIdsRef = useRef(new Set());



  useEffect(() => {

    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

    if (!bridge?.startChatStream) return undefined;



    /**

     * @param {{ conversationId: string; messageId: string; peerId: string }} detail

     */

    const startInboundGatewayReply = async (detail) => {

      const conversationId = String(detail?.conversationId ?? "").trim();

      const messageId = String(detail?.messageId ?? "").trim();

      const peerId = String(detail?.peerId ?? "").trim();

      if (!conversationId || !messageId || !peerId) return;

      if (inFlightInboundRef.current.has(messageId)) return;

      inFlightInboundRef.current.add(messageId);



      const rec = getSession(conversationId);

      if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) {

        inFlightInboundRef.current.delete(messageId);

        return;

      }



      const prior = Array.isArray(rec.messages) ? rec.messages : [];

      const userRow = prior.find((m) => m.id === messageId && m.role === "user");

      if (!userRow) {

        inFlightInboundRef.current.delete(messageId);

        return;

      }



      const assistantId = `wechat-replying-${messageId}`;

      const hasTerminalAssistant = prior.some(
        (m) =>
          m.role === "assistant" &&
          !isWechatPendingAssistantId(m.id) &&
          typeof m.createdAt === "number" &&
          typeof userRow.createdAt === "number" &&
          m.createdAt > userRow.createdAt,
      );
      if (hasTerminalAssistant) {
        clearWechatReplyingSessionId(conversationId);
        inFlightInboundRef.current.delete(messageId);
        return;
      }



      const assistantTs =

        (typeof userRow.createdAt === "number" ? userRow.createdAt : Date.now()) + 1;

      const historyRows = prior.filter((m) => m.id !== assistantId && !isWechatPendingAssistantId(m.id));

      const persistable = [

        ...historyRows,

        {

          id: assistantId,

          role: /** @type {const} */ ("assistant"),

          content: "",

          thinking: "",

          createdAt: assistantTs,

        },

      ];

      const title = deriveTitleFromMessages(persistable, {

        imageFallback: t("chatLab.chatUntitledImage"),

      });

      upsertSession(conversationId, title || "…", persistable, {

        channel: CHAT_SESSION_CHANNEL_WECHAT,

        channelPeerId: peerId,

      });



      const gatewayConversationId = ensureWechatGatewayConversationId(conversationId);
      if (!gatewayConversationId) {
        inFlightInboundRef.current.delete(messageId);
        return;
      }

      const streamId = newStreamId();

      beginGatewayStream({ conversationId, streamId, assistantMessageId: assistantId });

      setWechatReplyingSessionId(conversationId);

      const historyForRequest = toGatewayHistoryRows(historyRows);

      const outgoing = [

        { role: "system", content: t("chatLab.systemPrompt") },

        ...historyForRequest,

      ];



      const stopTyping = startWechatTypingPulse(peerId);

      try {

        await bridge.startChatStream({

          streamId,

          conversationId,

          gatewayConversationId,

          messages: outgoing,

          wechatPeerId: peerId,

        });

      } catch {

        resetGatewayStream(streamId);

        clearWechatReplyingSessionId(conversationId);

        try {

          await bridge.abortChatStream?.(streamId);

        } catch {

          /* ignore */

        }

      } finally {

        stopTyping();

        inFlightInboundRef.current.delete(messageId);

      }

    };



    /** @param {Event} ev */

    const onInbound = (ev) => {

      const detail = /** @type {CustomEvent} */ (ev).detail;

      if (!detail || typeof detail !== "object") return;

      void startInboundGatewayReply(detail);

    };



    /** @param {Event} ev */

    const onTerminal = (ev) => {

      const d = /** @type {CustomEvent} */ (ev).detail;

      if (!d || typeof d !== "object") return;

      const conversationId = String(d.conversationId ?? "").trim();

      const assistantMessageId = String(d.assistantMessageId ?? "").trim();

      if (!conversationId || !assistantMessageId) return;



      const rec = getSession(conversationId);

      if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) return;

      const peerId = String(rec.channelPeerId ?? "").trim();



      if (d.kind === "done") {

        clearWechatReplyingSessionId(conversationId);

        finalizeWechatAssistantInStore(conversationId, assistantMessageId, {

          content: d.content,

          thinking: d.thinking,

          toolTrace: d.toolTrace,

          activityLog: d.activityLog,

          assistantTimeline: d.assistantTimeline,

        });

        if (!peerId || !bridge.wechatSendMessage) return;

        if (sentWechatAssistantIdsRef.current.has(assistantMessageId)) return;

        const replyText = String(d.content ?? "").trim();

        if (!replyText) return;

        sentWechatAssistantIdsRef.current.add(assistantMessageId);

        const requestId = `wechat-assistant:${conversationId}:${assistantMessageId}`;

        void bridge

          .wechatSendMessage({

            requestId,

            conversationId,

            peerId,

            text: replyText,

            localMessageId: `wechat-local-assistant:${assistantMessageId}`,

          })

          .catch(() => {

            /* non-blocking */

          });

        return;

      }



      if (d.kind === "error" || d.kind === "aborted") {

        clearWechatReplyingSessionId(conversationId);

        finalizeWechatAssistantInStore(conversationId, assistantMessageId, {

          content: d.content,

          thinking: d.thinking,

          toolTrace: d.toolTrace,

          activityLog: d.activityLog,

          assistantTimeline: d.assistantTimeline,

          error: d.kind === "error" ? String(d.message ?? "stream_error") : "aborted",

        });

      }

    };



    window.addEventListener("openstudio-wechat-session-inbound", onInbound);

    window.addEventListener("openstudio-gateway-chat-terminal", onTerminal);

    return () => {

      window.removeEventListener("openstudio-wechat-session-inbound", onInbound);

      window.removeEventListener("openstudio-gateway-chat-terminal", onTerminal);

    };

  }, [beginGatewayStream, clearWechatReplyingSessionId, resetGatewayStream, setWechatReplyingSessionId, t]);

}


