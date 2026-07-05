import { useContext, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ChatLabWorkspaceContext } from "../../context/ChatLabWorkspaceContext.jsx";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";

/**
 * Only **empty** chat sessions (no user turns) drop preview + workspace when navigating away
 * or starting a fresh draft. Conversations with messages keep workspace via sessionStorage.
 *
 * @param {{ conversationId: string; isEmptySession: boolean }} props
 */
export default function ChatLabSessionScopeReset({ conversationId, isEmptySession }) {
  const preview = useChatLabPreview();
  const workspace = useContext(ChatLabWorkspaceContext);
  const location = useLocation();
  const prevConversationIdRef = useRef(conversationId);
  const prevRouteKeyRef = useRef(location.key);
  const onChatRoute = location.pathname === "/chat" || location.pathname === "/";
  const hasSessionParam = Boolean(new URLSearchParams(location.search).get("c"));

  useEffect(() => {
    if (!isEmptySession) {
      prevConversationIdRef.current = conversationId;
      return;
    }
    if (prevConversationIdRef.current !== conversationId) {
      preview?.close?.();
      workspace?.resetSelection?.();
    }
    prevConversationIdRef.current = conversationId;
  }, [conversationId, isEmptySession, preview, workspace]);

  useEffect(() => {
    if (!isEmptySession) return;
    if (!onChatRoute) {
      preview?.close?.();
      workspace?.resetSelection?.();
    }
  }, [isEmptySession, onChatRoute, preview, workspace]);

  useEffect(() => {
    if (!isEmptySession || !onChatRoute || hasSessionParam) {
      prevRouteKeyRef.current = location.key;
      return;
    }
    if (prevRouteKeyRef.current !== location.key) {
      preview?.close?.();
      workspace?.resetSelection?.();
    }
    prevRouteKeyRef.current = location.key;
  }, [hasSessionParam, isEmptySession, location.key, onChatRoute, preview, workspace]);

  return null;
}
