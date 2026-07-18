import { useEffect, useRef } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { extractFirstWebMarkdownLink, readLinkOpenModeLocal } from "../../chat/chatLabLinkOpenPreference.js";
import {
  extractSidebarActionStepsFromAssistantMessage,
} from "../../chat/chatLabSidebarActionProtocol.js";

const SIDEBAR_AUTOMATION_WEBVIEW_READY_MS = 600;

/**
 * @param {() => boolean} isReady
 * @param {number} timeoutMs
 */
function waitUntil(isReady, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isReady()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

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
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    if (conversationIdRef.current === conversationId) return;
    conversationIdRef.current = conversationId;
    ranKeysRef.current = new Set();
  }, [conversationId]);

  const automationEnabled =
    Boolean(preview?.embedPreview) || readLinkOpenModeLocal() !== "external";

  useEffect(() => {
    const runAutomation = preview?.runSidebarAutomation;
    const openFromHref = preview?.openFromHref;
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

        const messageText = String(candidate.content ?? "");
        const linkedUrl = extractFirstWebMarkdownLink(messageText);
        const needsNavigate = resolvedSteps.some((step) => step.action === "navigate");
        if (linkedUrl && openFromHref && !needsNavigate) {
          openFromHref(linkedUrl, linkedUrl);
          await waitUntil(
            () => Boolean(preview?.webviewRef?.current || preview?.session?.kind === "iframe"),
            SIDEBAR_AUTOMATION_WEBVIEW_READY_MS,
          );
        }

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
    preview?.openFromHref,
    preview?.runSidebarAutomation,
    preview?.session?.kind,
    preview?.webviewRef,
  ]);

  return null;
}
