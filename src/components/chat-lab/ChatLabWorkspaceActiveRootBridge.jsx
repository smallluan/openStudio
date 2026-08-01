import { useLayoutEffect } from "react";
import { useOptionalChatLabWorkspace } from "../../context/ChatLabWorkspaceContext.jsx";

/**
 * Keeps a parent ref in sync with workspace selection (provider sits below early hooks in ChatLabPage).
 *
 * @param {{ activeRootRef: import("react").MutableRefObject<string | null> }} props
 */
export default function ChatLabWorkspaceActiveRootBridge({ activeRootRef }) {
  const workspace = useOptionalChatLabWorkspace();
  const activeRoot = workspace?.activeRoot ?? null;
  // Keep the parent ref current before browser paint. The composer can send a
  // message immediately after the folder picker closes.
  useLayoutEffect(() => {
    activeRootRef.current = activeRoot;
  }, [activeRoot, activeRootRef]);
  return null;
}
