import { useEffect } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";

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

  useEffect(() => {
    if (!preview?.captureSidebarContextBlock) {
      previewSnapshotRef.current = null;
      return undefined;
    }
    previewSnapshotRef.current = preview.captureSidebarContextBlock;
    return () => {
      previewSnapshotRef.current = null;
    };
  }, [preview, preview?.captureSidebarContextBlock, previewSnapshotRef]);

  useEffect(() => {
    if (!previewAutomationRef) return undefined;
    if (!preview?.runSidebarAutomation) {
      previewAutomationRef.current = null;
      return undefined;
    }
    previewAutomationRef.current = preview.runSidebarAutomation;
    return () => {
      previewAutomationRef.current = null;
    };
  }, [preview, preview?.runSidebarAutomation, previewAutomationRef]);

  return null;
}
