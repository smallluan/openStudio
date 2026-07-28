import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { buildAutomationChatSession, sessionKeyForAgent } from "../automation/automationChatDispatch.js";
import {
  CHAT_SESSION_CHANNEL_INTERNAL,
  deriveTitleFromMessages,
  findSessionByAutomationCronJobId,
  newGatewayConversationId,
  upsertSession,
} from "./chatSessionsStore.js";
import { useChatLabStreaming } from "../context/ChatLabStreamingContext.jsx";
import { useStudio } from "../context/StudioContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { buildStreamUsageMeta } from "./chatStreamUsageMeta.js";

/** @returns {string} */
function newStreamId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `auto_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/** @returns {string} */
function newConversationId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `chat_${Date.now().toString(36)}`;
}

/**
 * Always-mounted: run Open Studio automation through the same `startChatStream` path as Chat Lab.
 * Each task reuses one sidebar conversation; each run appends a turn with stateless gateway payload.
 */
export function useAutomationChatStream() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { agents, agentById, mainAgent } = useStudio();
  const { beginGatewayStream, resetGatewayStream } = useChatLabStreaming();
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.startChatStream || !bridge?.onAutomationStatus) return undefined;

    /**
     * @param {Record<string, unknown>} evt
     */
    const runAutomationChat = async (evt) => {
      if (String(evt?.type ?? "") !== "automation_chat") return;

      const cronJobId = String(evt.cronJobId ?? "").trim();
      const gatewayMessage = String(evt.message ?? evt.prompt ?? "").trim();
      const displayPrompt = String(evt.prompt ?? gatewayMessage).trim();
      const taskName = String(evt.taskName ?? evt.name ?? "").trim();
      const workflowId = String(evt.workflowId ?? "").trim();
      const agentId = String(evt.agentId ?? "").trim();
      const modelProfileId = String(evt.modelProfileId ?? "").trim();
      if (!cronJobId || !gatewayMessage) return;
      if (inFlightRef.current.has(cronJobId)) return;
      inFlightRef.current.add(cronJobId);

      const existing = findSessionByAutomationCronJobId(cronJobId);
      const isNewSession = !existing;
      const conversationId = existing?.id ?? newConversationId();
      const gatewayConversationId =
        String(existing?.gatewayConversationId ?? "").trim() || newGatewayConversationId();
      const now = Date.now();

      let globalUserProfile;
      try {
        const cfg = await bridge?.getUserConfig?.();
        globalUserProfile = cfg?.userProfile;
      } catch {
        globalUserProfile = undefined;
      }

      const session = buildAutomationChatSession({
        t,
        agents,
        agentById,
        mainAgent,
        taskName,
        displayPrompt,
        gatewayMessage,
        agentId,
        workflowId,
        nowMs: now,
        globalUserProfile,
      });

      if (!session.launches.length) {
        inFlightRef.current.delete(cronJobId);
        return;
      }

      const title =
        taskName ||
        deriveTitleFromMessages([session.userRow], {
          imageFallback: t("chatLab.chatUntitledImage"),
        }) ||
        t("automationPage.unnamed");

      const priorMessages = Array.isArray(existing?.messages) ? existing.messages : [];
      const turnMessages = [session.userRow, ...session.assistantRows];
      const nextMessages = isNewSession
        ? [...session.memberEvents, ...turnMessages]
        : [...priorMessages, ...turnMessages];

      upsertSession(conversationId, title, nextMessages, {
        channel: CHAT_SESSION_CHANNEL_INTERNAL,
        gatewayConversationId,
        participantIds: session.participantIds,
        automationCronJobId: cronJobId,
        automationTaskSession: true,
        ...(session.workflowState ? { workflowState: session.workflowState } : {}),
      });

      try {
        window.dispatchEvent(
          new CustomEvent("openstudio-automation-session-started", {
            detail: { conversationId, cronJobId, isNewSession },
          }),
        );
      } catch {
        /* ignore */
      }

      if (isNewSession) {
        navigate(`/chat?c=${encodeURIComponent(conversationId)}`, { replace: false });
      } else {
        const activeC = new URLSearchParams(location.search).get("c");
        if (activeC === conversationId) {
          try {
            window.dispatchEvent(
              new CustomEvent("openstudio-automation-turn-started", {
                detail: { conversationId, cronJobId },
              }),
            );
          } catch {
            /* ignore */
          }
        }
      }

      if (!workflowId && modelProfileId && bridge.setUserConfig) {
        try {
          await bridge.setUserConfig({ activeModelProfileId: modelProfileId });
        } catch {
          /* ignore */
        }
      }

      const parallel = session.launches.length > 1;
      let hadError = false;
      /** @type {string} */
      let lastError = "";

      for (const launch of session.launches) {
        const { target, assistantRow, outgoing } = launch;
        const streamId = newStreamId();
        beginGatewayStream({
          conversationId,
          streamId,
          assistantMessageId: assistantRow.id,
        });

        try {
          await bridge.startChatStream({
            streamId,
            conversationId,
            gatewayConversationId,
            messages: outgoing,
            concurrent: parallel,
            agentSessionKey: sessionKeyForAgent(target),
            gatewayAgentId: target.gatewayAgentId,
            usageMeta: buildStreamUsageMeta({
              conversationTitle: title,
              assistantMessageId: assistantRow.id,
              userMessageId: session.userRow.id,
              userContentPreview: displayPrompt,
              agentId: target.id,
            }),
          });
        } catch (err) {
          hadError = true;
          lastError = String(err?.message ?? err);
          resetGatewayStream(streamId);
          try {
            await bridge.abortChatStream?.(streamId);
          } catch {
            /* ignore */
          }
        }
      }

      bridge.automationTaskReportRun?.({
        cronJobId,
        status: hadError ? "error" : "ok",
        ...(hadError && lastError ? { error: lastError } : {}),
      });
      inFlightRef.current.delete(cronJobId);
    };

    const off = bridge.onAutomationStatus((evt) => {
      void runAutomationChat(evt);
    });
    return off;
  }, [agentById, agents, beginGatewayStream, location.search, mainAgent, navigate, resetGatewayStream, t]);
}
