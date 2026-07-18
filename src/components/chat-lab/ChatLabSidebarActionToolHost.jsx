import { useEffect } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { registerSidebarActionToolExecutor } from "../../chat/sidebarActionToolHost.js";

/**
 * Registers the active preview's automation runner for native `sidebar_action` tool IPC.
 */
export default function ChatLabSidebarActionToolHost() {
  const preview = useChatLabPreview();

  useEffect(() => {
    if (!preview?.executeSidebarActionTool) return undefined;
    return registerSidebarActionToolExecutor((args) => preview.executeSidebarActionTool(args));
  }, [preview, preview?.executeSidebarActionTool]);

  return null;
}
