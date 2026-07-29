import { useEffect, useRef } from "react";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { registerBrowserActionToolExecutor, registerBrowserOpenToolExecutor } from "../../chat/sidebarActionToolHost.js";

/**
 * Registers the active preview's automation runner for native browser tool IPC.
 * Uses refs so callback identity churn (session/dock updates) never unregisters
 * executors mid-request — that previously returned `no_preview_handler` while
 * browser_action could still look "busy" from earlier turns / web_fetch narration.
 *
 * Web Explore (`embedPreview`) does **not** register `browser_open` — agents must
 * stay on the visible tab (`browser_action` navigate).
 */
export default function ChatLabSidebarActionToolHost() {
  const preview = useChatLabPreview();
  const actionRef = useRef(preview?.executeSidebarActionTool);
  const openRef = useRef(preview?.executeBrowserOpenTool);
  const embedPreview = Boolean(preview?.embedPreview);
  actionRef.current = preview?.executeSidebarActionTool;
  openRef.current = preview?.executeBrowserOpenTool;

  useEffect(() => {
    const unsubAction = registerBrowserActionToolExecutor((args) => {
      const fn = actionRef.current;
      if (!fn) {
        return Promise.resolve({
          ok: false,
          error: "no_preview_handler",
          message: "No Chat Lab / Web Explore preview is ready for browser_action",
        });
      }
      return fn(args);
    });
    // Chat Lab only — Web Explore must not advertise / handle browser_open.
    const unsubOpen = embedPreview
      ? null
      : registerBrowserOpenToolExecutor((args) => {
          const fn = openRef.current;
          if (!fn) {
            return Promise.resolve({
              ok: false,
              error: "no_preview_handler",
              message: "No Chat Lab preview is ready for browser_open",
            });
          }
          return fn(args);
        });
    return () => {
      unsubAction();
      unsubOpen?.();
    };
  }, [embedPreview]);

  return null;
}
