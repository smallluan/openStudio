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
import { isWechatNewChatCommand } from "./wechatSessionCommands.js";
import { pickWechatOutboundMedia, filterExistingWechatMedia, composeWechatReplyText, wechatMediaToFileRefs } from "./wechatOutboundMedia.js";
import { wechatGatewayAssistantContent } from "./wechatGatewayHistory.js";
import {
  listWechatSealedTextSegments,
  markWechatTextSegmentSent,
  wasWechatTextSegmentSent,
} from "./wechatIncrementalReply.js";



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

      const content = wechatGatewayAssistantContent(m);

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

  const content = String(extra.content ?? "").trim();

  const thinking = String(extra.thinking ?? "").trim();

  const error = typeof extra.error === "string" ? extra.error : "";

  const finalId = isWechatPendingAssistantId(assistantMessageId)

    ? assistantMessageId.replace(/^wechat-replying-/, "wechat-assistant-")

    : assistantMessageId;

  const prior = Array.isArray(rec.messages) ? rec.messages : [];

  const existingFinal = prior.find((m) => m.id === finalId);

  const existingPending = prior.find((m) => m.id === assistantMessageId);

  const ts =

    typeof existingFinal?.createdAt === "number"

      ? existingFinal.createdAt

      : typeof existingPending?.createdAt === "number"

        ? existingPending.createdAt

        : Date.now();

  const nextRow = {

    id: finalId,

    role: /** @type {const} */ ("assistant"),

    content: error ? "" : content,

    ...(thinking ? { thinking } : {}),

    ...(Array.isArray(extra.toolTrace) && extra.toolTrace.length ? { toolTrace: extra.toolTrace } : {}),

    ...(Array.isArray(extra.activityLog) && extra.activityLog.length ? { activityLog: extra.activityLog } : {}),

    ...(Array.isArray(extra.assistantTimeline) && extra.assistantTimeline.length

      ? { assistantTimeline: extra.assistantTimeline }

      : {}),

    ...(Array.isArray(extra.fileRefs) && extra.fileRefs.length ? { fileRefs: extra.fileRefs } : {}),

    createdAt: ts,

  };

  const freshRec = getSession(conversationId);

  const freshPrior = Array.isArray(freshRec?.messages) ? freshRec.messages : prior;

  const persistable = [

    ...freshPrior.filter((m) => m.id !== assistantMessageId && m.id !== finalId),

    nextRow,

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
 * @param {string} conversationId
 * @param {string} assistantMessageId
 */
function wechatSegmentSendKey(conversationId, assistantMessageId) {
  return `${conversationId}:${assistantMessageId}`;
}

/**
 * Push sealed timeline prose blocks to WeChat as they complete (tool/step gap follows).
 *
 * @param {{
 *   bridge: NonNullable<typeof window.studioBridge>;
 *   conversationId: string;
 *   peerId: string;
 *   assistantMessageId: string;
 *   timeline: import("./streamTimelineMerge.js").AssistantTimelineSegment[] | undefined;
 *   streamComplete: boolean;
 *   sentSegmentsRef: import("react").MutableRefObject<Map<string, Set<number>>>;
 * }} args
 */
async function sendWechatSealedTextSegments({
  bridge,
  conversationId,
  peerId,
  assistantMessageId,
  timeline,
  streamComplete,
  sentSegmentsRef,
}) {
  const segments = listWechatSealedTextSegments(timeline, streamComplete);
  if (!segments.length || !bridge.wechatSendMessage) return;

  const key = wechatSegmentSendKey(conversationId, assistantMessageId);
  for (const seg of segments) {
    if (wasWechatTextSegmentSent(sentSegmentsRef.current, key, seg.segmentIndex)) continue;
    const text = String(seg.body ?? "").trim();
    if (!text) continue;

    const requestId = `wechat-assistant-chunk:${conversationId}:${assistantMessageId}:${seg.segmentIndex}`;
    try {
      const res = await bridge.wechatSendMessage({
        requestId,
        conversationId,
        peerId,
        text,
        localMessageId: `wechat-local-assistant:${assistantMessageId}:${seg.segmentIndex}`,
      });
      if (res && res.ok === false) {
        bridge.logRendererMessage?.({
          level: "warn",
          message: `[wechat] chunk send failed (${seg.segmentIndex}): ${String(res.message ?? "unknown")}`,
        });
        continue;
      }
      markWechatTextSegmentSent(sentSegmentsRef.current, key, seg.segmentIndex);
    } catch (err) {
      bridge.logRendererMessage?.({
        level: "warn",
        message: `[wechat] chunk send failed (${seg.segmentIndex}): ${String(err?.message ?? err)}`,
      });
    }
  }
}

/**

 * Always-mounted: run WeChat inbound auto-replies through the same renderer `startChatStream`

 * path as Chat Lab (gateway + tools), then push timeline prose blocks to WeChat as they seal.

 */

export function useWechatAutoReplyStream() {

  const { t } = useI18n();

  const {

    beginGatewayStream,

    resetGatewayStream,

    setWechatReplyingSessionId,

    clearWechatReplyingSessionId,

    gatewayStreamSlice,

  } = useChatLabStreaming();

  /** @type {import("react").MutableRefObject<Set<string>>} */

  const inFlightInboundRef = useRef(new Set());

  /** @type {import("react").MutableRefObject<Set<string>>} */

  const sentWechatAssistantIdsRef = useRef(new Set());

  /** @type {import("react").MutableRefObject<Map<string, Set<number>>>} */

  const sentWechatTextSegmentsRef = useRef(new Map());



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

      if (isWechatNewChatCommand(userRow.content)) {
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

      const historyRows = prior.filter((m) => m.id !== assistantId);

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

        { role: "system", content: `${t("chatLab.systemPrompt")}\n\n${t("chatLab.wechatSystemPrompt")}` },

        ...historyForRequest,

      ];



      const stopTyping = startWechatTypingPulse(peerId);

      try {

        await bridge.startChatStream({

          streamId,

          conversationId,

          gatewayConversationId,

          messages: outgoing,

          channel: "wechat",

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

        const replyText = String(d.content ?? "").trim();
        const terminalExtra = {
          content: d.content,
          thinking: d.thinking,
          toolTrace: d.toolTrace,
          activityLog: d.activityLog,
          assistantTimeline: d.assistantTimeline,
        };

        finalizeWechatAssistantInStore(conversationId, assistantMessageId, terminalExtra);

        if (!peerId) return;

        if (sentWechatAssistantIdsRef.current.has(assistantMessageId)) return;

        const mediaItems = pickWechatOutboundMedia({
          id: assistantMessageId,
          role: "assistant",
          content: replyText,
          toolTrace: Array.isArray(d.toolTrace) ? d.toolTrace : [],
        });

        sentWechatAssistantIdsRef.current.add(assistantMessageId);

        void (async () => {
          const timeline = Array.isArray(d.assistantTimeline) ? d.assistantTimeline : [];
          const sealedOnDone = listWechatSealedTextSegments(timeline, true);

          if (sealedOnDone.length > 0) {
            await sendWechatSealedTextSegments({
              bridge,
              conversationId,
              peerId,
              assistantMessageId,
              timeline,
              streamComplete: true,
              sentSegmentsRef: sentWechatTextSegmentsRef,
            });
          }

          const mediaToSend = await filterExistingWechatMedia(bridge, mediaItems);
          const segmentKey = wechatSegmentSendKey(conversationId, assistantMessageId);
          const sentSegmentSet = sentWechatTextSegmentsRef.current.get(segmentKey);
          const allTextSentIncrementally =
            sealedOnDone.length > 0 &&
            sealedOnDone.every((seg) => sentSegmentSet?.has(seg.segmentIndex));
          const textToSend = allTextSentIncrementally
            ? ""
            : composeWechatReplyText(replyText, mediaToSend);
          const fileRefs = wechatMediaToFileRefs(mediaToSend);

          if (textToSend !== replyText || fileRefs.length > 0) {
            finalizeWechatAssistantInStore(conversationId, assistantMessageId, {
              ...terminalExtra,
              content: textToSend || replyText,
              ...(fileRefs.length ? { fileRefs } : {}),
            });
          }

          if (mediaToSend.length && bridge.wechatSendMedia) {
            for (const item of mediaToSend) {
              const requestId = `wechat-media:${conversationId}:${assistantMessageId}:${item.path}`;
              try {
                const res = await bridge.wechatSendMedia({
                  requestId,
                  conversationId,
                  peerId,
                  mediaPath: item.path,
                  localMessageId: `wechat-local-media:${assistantMessageId}:${item.label}`,
                });
                if (res && res.ok === false) {
                  bridge.logRendererMessage?.({
                    level: "warn",
                    message: `[wechat] media send failed (${item.path}): ${String(res.message ?? "unknown")}`,
                  });
                }
              } catch (err) {
                bridge.logRendererMessage?.({
                  level: "warn",
                  message: `[wechat] media send failed (${item.path}): ${String(err?.message ?? err)}`,
                });
              }
            }
          } else if (mediaItems.length) {
            bridge.logRendererMessage?.({
              level: "warn",
              message: `[wechat] media paths found but none exist on disk: ${mediaItems.map((x) => x.path).join("; ")}`,
            });
          }

          if (textToSend && bridge.wechatSendMessage) {
            const requestId = `wechat-assistant:${conversationId}:${assistantMessageId}`;
            try {
              await bridge.wechatSendMessage({
                requestId,
                conversationId,
                peerId,
                text: textToSend,
                localMessageId: `wechat-local-assistant:${assistantMessageId}`,
              });
            } catch (err) {
              bridge.logRendererMessage?.({
                level: "warn",
                message: `[wechat] text send failed: ${String(err?.message ?? err)}`,
              });
            }
          }
        })();

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

  useEffect(() => {
    const slice = gatewayStreamSlice;
    if (!slice?.active) return undefined;

    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.wechatSendMessage) return undefined;

    const rec = getSession(slice.conversationId);
    if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) return undefined;

    const peerId = String(rec.channelPeerId ?? "").trim();
    if (!peerId) return undefined;

    void sendWechatSealedTextSegments({
      bridge,
      conversationId: slice.conversationId,
      peerId,
      assistantMessageId: slice.assistantMessageId,
      timeline: slice.assistantTimeline,
      streamComplete: false,
      sentSegmentsRef: sentWechatTextSegmentsRef,
    });

    return undefined;
  }, [gatewayStreamSlice]);

}


