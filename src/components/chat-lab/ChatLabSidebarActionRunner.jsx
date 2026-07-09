import { useEffect, useRef } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { readLinkOpenModeLocal } from "../../chat/chatLabLinkOpenPreference.js";
import {
  extractSidebarActionStepsFromAssistantMessage,
} from "../../chat/chatLabSidebarActionProtocol.js";

/**
 * Watches completed assistant messages for ```sidebar-action fences, runs them in the
 * preview webview, then reports execution result back to the same assistant message.
 */
export default function ChatLabSidebarActionRunner({
  conversationId,
  messages,
  onAutomationApplied,
}) {
  const preview = useChatLabPreview();
  const handledMessageIdsRef = useRef(new Set());
  const runningRef = useRef(false);
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    if (conversationIdRef.current !== conversationId) {
      conversationIdRef.current = conversationId;
      handledMessageIdsRef.current = new Set();
    }
  }, [conversationId]);

  useEffect(() => {
    const runAutomation = preview?.runSidebarAutomation;
    if (!runAutomation || !onAutomationApplied) return;
    if (readLinkOpenModeLocal() === "external") return;
    if (runningRef.current) return;
    if (messages.some((m) => m.role === "assistant" && m.streaming)) return;

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && !m.streaming && !m.error);
    if (!lastAssistant?.id) return;
    if (handledMessageIdsRef.current.has(lastAssistant.id)) return;

    const steps = extractSidebarActionStepsFromAssistantMessage(lastAssistant);
    if (!steps.length) return;

    handledMessageIdsRef.current.add(lastAssistant.id);
    runningRef.current = true;

    void (async () => {
      try {
        await onAutomationApplied({
          phase: "start",
          assistantMessageId: lastAssistant.id,
          requestedSteps: steps,
        });
        const result = await runAutomation(steps, {
          stopOnFailure: true,
          onStepComplete: async ({ index, results }) => {
            await onAutomationApplied({
              phase: "progress",
              assistantMessageId: lastAssistant.id,
              requestedSteps: steps,
              runningIndex: index + 1,
              result: { ok: results.every((r) => r.ok !== false), steps: results },
            });
          },
        });
        await onAutomationApplied({
          phase: "complete",
          assistantMessageId: lastAssistant.id,
          requestedSteps: steps,
          result,
        });
      } catch (err) {
        await onAutomationApplied({
          phase: "complete",
          assistantMessageId: lastAssistant.id,
          requestedSteps: steps,
          result: {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            steps: [],
          },
        });
      } finally {
        runningRef.current = false;
      }
    })();
  }, [messages, onAutomationApplied, preview?.runSidebarAutomation]);

  return null;
}
