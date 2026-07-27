import { useEffect, useRef } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import {
  extractSidebarActionStepsFromAssistantMessage,
} from "../../chat/chatLabSidebarActionProtocol.js";

/**
 * @param {import("../../chat/chatLabPreviewAutomation.js").SidebarAutomationStep[]} steps
 */
function stepsRunKey(messageId, steps) {
  return `${messageId}:${JSON.stringify(steps)}`;
}

/**
 * Run sidebar-action as soon as a complete fence is available — including while the
 * assistant is still streaming — so it appears as an in-turn tool, not after lifecycle:end.
 */
export default function ChatLabSidebarActionRunner({
  conversationId,
  messages,
  onAutomationApplied,
}) {
  const preview = useChatLabPreview();
  const ranKeysRef = useRef(new Set());
  const runningRef = useRef(false);
  const conversationIdRef = useRef(/** @type {string | null} */ (null));
  const seededRef = useRef(false);

  // On mount / conversation switch: treat existing sidebar-action fences as already run
  // so switching into a thread does not reopen the webview / re-execute automation.
  useEffect(() => {
    if (conversationIdRef.current !== conversationId) {
      conversationIdRef.current = conversationId;
      seededRef.current = false;
    }
    if (seededRef.current) return;
    ranKeysRef.current = new Set();
    for (const m of messages) {
      if (m.role !== "assistant" || m.error) continue;
      const steps = extractSidebarActionStepsFromAssistantMessage(m);
      if (!steps.length || !m.id) continue;
      ranKeysRef.current.add(stepsRunKey(m.id, steps));
    }
    seededRef.current = true;
  }, [conversationId, messages]);

  const automationEnabled = Boolean(preview?.embedPreview);

  useEffect(() => {
    if (!seededRef.current) return;
    const runAutomation = preview?.runSidebarAutomation;
    if (!runAutomation || !onAutomationApplied) return;
    if (!automationEnabled) return;
    if (runningRef.current) return;

    // Prefer the newest assistant that already has executable steps (streaming OK).
    const candidate = [...messages]
      .reverse()
      .find((m) => {
        if (m.role !== "assistant" || m.error) return false;
        return extractSidebarActionStepsFromAssistantMessage(m).length > 0;
      });
    if (!candidate?.id) return;

    const resolvedSteps = extractSidebarActionStepsFromAssistantMessage(candidate);
    if (!resolvedSteps.length) return;

    const runKey = stepsRunKey(candidate.id, resolvedSteps);
    if (ranKeysRef.current.has(runKey)) return;

    ranKeysRef.current.add(runKey);
    runningRef.current = true;

    void (async () => {
      try {
        await onAutomationApplied({
          phase: "start",
          assistantMessageId: candidate.id,
          requestedSteps: resolvedSteps,
        });

        const result = await runAutomation(resolvedSteps, {
          stopOnFailure: true,
          onStepComplete: async ({ index, results }) => {
            await onAutomationApplied({
              phase: "progress",
              assistantMessageId: candidate.id,
              requestedSteps: resolvedSteps,
              runningIndex: index + 1,
              result: { ok: results.every((r) => r.ok !== false), steps: results },
            });
          },
        });
        await onAutomationApplied({
          phase: "complete",
          assistantMessageId: candidate.id,
          requestedSteps: resolvedSteps,
          result,
        });
      } catch (err) {
        await onAutomationApplied({
          phase: "complete",
          assistantMessageId: candidate.id,
          requestedSteps: resolvedSteps,
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
  }, [
    automationEnabled,
    messages,
    onAutomationApplied,
    preview?.runSidebarAutomation,
  ]);

  return null;
}
