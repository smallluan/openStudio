import { useEffect } from "react";
import { useChatLabWorkspace } from "../../context/ChatLabWorkspaceContext.jsx";

/**
 * Keeps a parent ref in sync with workspace selection (provider sits below early hooks in ChatLabPage).
 *
 * @param {{ activeRootRef: import("react").MutableRefObject<string | null> }} props
 */
export default function ChatLabWorkspaceActiveRootBridge({ activeRootRef }) {
  const { activeRoot } = useChatLabWorkspace();
  useEffect(() => {
    activeRootRef.current = activeRoot;
  }, [activeRoot, activeRootRef]);
  return null;
}
