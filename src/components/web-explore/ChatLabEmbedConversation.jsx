import { useCallback, useMemo, useRef, useState } from "react";
import { newWebExploreConversationId } from "../../chat/chatSessionsStore.js";
import { ChatLabPreviewProvider } from "../../context/ChatLabPreviewContext.jsx";
import { ChatLabWorkspaceProvider } from "../../context/ChatLabWorkspaceContext.jsx";
import { ChatLabPageMain } from "../../pages/ChatLabPage.jsx";

/**
 * Embeds the full ChatLab conversation UI for WebExplore (no session persistence).
 *
 * @param {{
 *   activeUrl: string;
 *   pageTitle: string;
 *   inElectron: boolean;
 *   webviewRef: import("react").RefObject<HTMLElement | null>;
 *   iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *   onNavigate: (url: string) => void;
 *   floatOpen?: boolean;
 *   onToggleFloatOpen?: () => void;
 *   onStartFloatDrag?: (e: import("react").PointerEvent<HTMLElement>) => void;
 *   webExploreNavigation?: {
 *     onBack: () => void;
 *     onForward: () => void;
 *     onReload: () => void;
 *   };
 *   className?: string;
 * }} props
 */
export default function ChatLabEmbedConversation({
  activeUrl,
  pageTitle,
  inElectron,
  webviewRef,
  iframeRef,
  onNavigate,
  floatOpen = true,
  onToggleFloatOpen,
  onStartFloatDrag,
  webExploreNavigation,
  className,
}) {
  const conversationIdRef = useRef(newWebExploreConversationId());
  const [conversationGeneration, setConversationGeneration] = useState(0);
  const conversationId = useMemo(
    () => (conversationGeneration === 0 ? conversationIdRef.current : newWebExploreConversationId()),
    [conversationGeneration],
  );
  const [workspaceEmptySession, setWorkspaceEmptySession] = useState(true);
  const clearConversation = useCallback(() => {
    setConversationGeneration((value) => value + 1);
  }, []);

  const externalSession = useMemo(
    () => ({
      kind: "iframe",
      src: activeUrl,
      title: pageTitle,
      frameKey: "web-explore-active",
      externalUrl: activeUrl,
      useWebview: inElectron,
    }),
    [activeUrl, inElectron, pageTitle],
  );

  return (
    <ChatLabWorkspaceProvider conversationId={conversationId} isEmptySession={workspaceEmptySession}>
      <ChatLabPreviewProvider
        conversationId={conversationId}
        externalPreviewRefs={{ webviewRef, iframeRef }}
        externalSession={externalSession}
        externalNavigatePreviewTo={onNavigate}
        embedPreview
      >
        <ChatLabPageMain
          key={conversationId}
          conversationId={conversationId}
          onWorkspaceEmptySessionChange={setWorkspaceEmptySession}
          embedMode={{
            persistSession: false,
            hidePreviewDock: true,
            forceThread: true,
            webExploreMode: true,
            activeUrl,
            pageTitle,
            webviewRef,
            iframeRef,
            chatFloatOpen: floatOpen,
            onToggleFloatOpen,
            onStartFloatDrag,
            webExploreNavigation,
            onClearConversation: clearConversation,
            className,
          }}
        />
      </ChatLabPreviewProvider>
    </ChatLabWorkspaceProvider>
  );
}
