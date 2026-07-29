import { useContext, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ChatLabWorkspaceContext } from "../../context/ChatLabWorkspaceContext.jsx";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";

/**
 * Reset preview visibility when conversation changes to avoid cross-session leakage.
 * Tab URLs may still persist on disk; the dock itself must not auto-open on switch.
 *
 * @param {{ conversationId: string; isEmptySession: boolean }} props
 */
export default function ChatLabSessionScopeReset({ conversationId, isEmptySession }) {
  const preview = useChatLabPreview();
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const workspace = useContext(ChatLabWorkspaceContext);
  const location = useLocation();
  const prevConversationIdRef = useRef(conversationId);
  const prevRouteKeyRef = useRef(location.key);
  const onChatRoute = location.pathname === "/chat" || location.pathname === "/";
  const hasSessionParam = Boolean(new URLSearchParams(location.search).get("c"));

  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      previewRef.current?.close?.();
    }
    prevConversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (!isEmptySession) return;
    if (!onChatRoute) {
      previewRef.current?.close?.();
      workspace?.resetSelection?.();
    }
  }, [isEmptySession, onChatRoute, workspace]);

  useEffect(() => {
    if (!isEmptySession || !onChatRoute || hasSessionParam) {
      prevRouteKeyRef.current = location.key;
      return;
    }
    if (prevRouteKeyRef.current !== location.key) {
      previewRef.current?.close?.();
      workspace?.resetSelection?.();
    }
    prevRouteKeyRef.current = location.key;
  }, [hasSessionParam, isEmptySession, location.key, onChatRoute, workspace]);

  return null;
}
