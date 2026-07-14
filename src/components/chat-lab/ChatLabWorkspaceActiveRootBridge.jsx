import { useEffect } from "react";
import { useOptionalChatLabWorkspace } from "../../context/ChatLabWorkspaceContext.jsx";

/**
 * Keeps a parent ref in sync with workspace selection (provider sits below early hooks in ChatLabPage).
 *
 * @param {{ activeRootRef: import("react").MutableRefObject<string | null> }} props
 */
export default function ChatLabWorkspaceActiveRootBridge({ activeRootRef }) {
  const workspace = useOptionalChatLabWorkspace();
  const activeRoot = workspace?.activeRoot ?? null;
  useEffect(() => {
    activeRootRef.current = activeRoot;
  }, [activeRoot, activeRootRef]);
  return null;
}
