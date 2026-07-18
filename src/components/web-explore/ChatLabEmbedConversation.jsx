import { useMemo, useRef, useState } from "react";
import { newGatewayConversationId } from "../../chat/chatSessionsStore.js";
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
  className,
}) {
  const conversationIdRef = useRef(newGatewayConversationId());
  const conversationId = conversationIdRef.current;
  const [workspaceEmptySession, setWorkspaceEmptySession] = useState(true);

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
            className,
          }}
        />
      </ChatLabPreviewProvider>
    </ChatLabWorkspaceProvider>
  );
}
