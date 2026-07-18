import { useEffect } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import ChatLabSidebarActionToolHost from "./ChatLabSidebarActionToolHost.jsx";

/**
 * Exposes sidebar preview snapshot + automation to ChatLabPage (provider sits below early hooks).
 *
 * @param {{
 *   previewSnapshotRef: import("react").MutableRefObject<(() => Promise<string>) | null>;
 *   previewAutomationRef?: import("react").MutableRefObject<
 *     ((steps: unknown) => Promise<unknown>) | null
 *   >;
 * }} props
 */
export default function ChatLabPreviewContextBridge({ previewSnapshotRef, previewAutomationRef }) {
  const preview = useChatLabPreview();

  // Keep refs in sync during render so send can read them before useEffect runs.
  previewSnapshotRef.current = preview?.captureSidebarContextBlock ?? null;
  if (previewAutomationRef) {
    previewAutomationRef.current = preview?.runSidebarAutomation ?? null;
  }

  useEffect(() => {
    previewSnapshotRef.current = preview?.captureSidebarContextBlock ?? null;
    return () => {
      previewSnapshotRef.current = null;
    };
  }, [preview, preview?.captureSidebarContextBlock, previewSnapshotRef]);

  useEffect(() => {
    if (!previewAutomationRef) return undefined;
    previewAutomationRef.current = preview?.runSidebarAutomation ?? null;
    return () => {
      previewAutomationRef.current = null;
    };
  }, [preview, preview?.runSidebarAutomation, previewAutomationRef]);

  return <ChatLabSidebarActionToolHost />;
}
