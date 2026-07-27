import { useEffect } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { registerBrowserActionToolExecutor, registerBrowserOpenToolExecutor } from "../../chat/sidebarActionToolHost.js";

/**
 * Registers the active preview's automation runner for native browser tool IPC.
 */
export default function ChatLabSidebarActionToolHost() {
  const preview = useChatLabPreview();

  useEffect(() => {
    if (!preview?.executeSidebarActionTool) return undefined;
    return registerBrowserActionToolExecutor((args) => preview.executeSidebarActionTool(args));
  }, [preview, preview?.executeSidebarActionTool]);

  useEffect(() => {
    if (!preview?.executeBrowserOpenTool) return undefined;
    return registerBrowserOpenToolExecutor((args) => preview.executeBrowserOpenTool(args));
  }, [preview, preview?.executeBrowserOpenTool]);

  return null;
}
