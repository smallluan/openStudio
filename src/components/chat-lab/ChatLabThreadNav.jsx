import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@open-studio/udesign";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  buildUserTurnAnchors,
  getThreadScrollMetrics,
  scrollThreadToBottom,
  scrollThreadToTop,
} from "../../chat/chatLabThreadScroll.js";
import { useI18n } from "../../context/I18nContext.jsx";
import ChatLabConvHeader from "./ChatLabConvHeader.jsx";

/**
 * @param {{
 *   headerTitle: string;
 *   conversationId?: string | null;
 *   messages: unknown[];
 *   messagesScrollRef: import("react").RefObject<HTMLDivElement | null>;
 *   autoScrollRef: import("react").MutableRefObject<boolean>;
 *   threadScrollApiRef: import("react").MutableRefObject<import("../../chat/chatLabThreadScroll.js").ChatLabThreadScrollApi | null>;
 *   agents?: import("../../studio/agents.js").LobsterAgent[];
 *   participantIds?: string[];
 *   onParticipantsChange?: (ids: string[]) => void;
 *   participantsDisabled?: boolean;
 *   children: import("react").ReactNode;
 * }} props
 */
export default function ChatLabThreadNav({
  headerTitle,
  conversationId = null,
  messages,
  messagesScrollRef,
  autoScrollRef,
  threadScrollApiRef,
  agents = [],
  participantIds = [],
  onParticipantsChange,
  participantsDisabled = false,
  children,
}) {
  const { t } = useI18n();
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(/** @type {string | null} */ (null));

  const userTurns = useMemo(() => buildUserTurnAnchors(messages, 64), [messages]);

  useEffect(() => {
    setActiveTurnId(null);
  }, [conversationId]);

  const syncScrollUi = useCallback(() => {
    const el = messagesScrollRef.current;
    const metrics = getThreadScrollMetrics(el);
    setShowScrollTop(!metrics.atTop && metrics.canScroll);
    setShowScrollBottom(!metrics.atBottom && metrics.canScroll);

    const activeFromApi = threadScrollApiRef.current?.getActiveUserMessageId?.() ?? null;
    if (activeFromApi) {
      setActiveTurnId(activeFromApi);
      return;
    }
    if (userTurns.length === 0) {
      setActiveTurnId(null);
      return;
    }
    const lastTurn = userTurns[userTurns.length - 1];
    setActiveTurnId(metrics.atBottom ? lastTurn.id : userTurns[0]?.id ?? null);
  }, [messagesScrollRef, threadScrollApiRef, userTurns]);

  useLayoutEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return undefined;
    syncScrollUi();
    el.addEventListener("scroll", syncScrollUi, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncScrollUi) : null;
    ro?.observe(el);
    window.addEventListener("resize", syncScrollUi);
    return () => {
      el.removeEventListener("scroll", syncScrollUi);
      ro?.disconnect();
      window.removeEventListener("resize", syncScrollUi);
    };
  }, [conversationId, messagesScrollRef, messages.length, syncScrollUi]);

  useEffect(() => {
    syncScrollUi();
  }, [userTurns.length, syncScrollUi]);

  const handleScrollTop = useCallback(() => {
    autoScrollRef.current = false;
    scrollThreadToTop(messagesScrollRef.current, threadScrollApiRef.current);
    requestAnimationFrame(syncScrollUi);
  }, [autoScrollRef, messagesScrollRef, syncScrollUi, threadScrollApiRef]);

  const handleScrollBottom = useCallback(() => {
    scrollThreadToBottom(messagesScrollRef.current, threadScrollApiRef.current, autoScrollRef);
    requestAnimationFrame(() => {
      syncScrollUi();
      requestAnimationFrame(syncScrollUi);
    });
  }, [autoScrollRef, messagesScrollRef, syncScrollUi, threadScrollApiRef]);

  const convHeaderProps = {
    headerTitle,
    conversationId,
    messages,
    messagesScrollRef,
    autoScrollRef,
    threadScrollApiRef,
    activeTurnId,
    onActiveTurnIdChange: setActiveTurnId,
    agents,
    participantIds,
    onParticipantsChange,
    participantsDisabled,
  };

  return (
    <>
      <ChatLabConvHeader {...convHeaderProps} />
      <div className="chat-lab__messages-stage">
        {children}
        {showScrollTop || showScrollBottom ? (
          <div className="chat-lab__scroll-jump" aria-hidden={false}>
            {showScrollTop ? (
              <Button
                variant="text"
                size="small"
                type="button"
                className="chat-lab__scroll-jump-btn"
                aria-label={t("chatLab.scrollToTop")}
                title={t("chatLab.scrollToTop")}
                onClick={handleScrollTop}
              >
                <ChevronUp size={18} strokeWidth={2.2} aria-hidden />
              </Button>
            ) : null}
            {showScrollBottom ? (
              <Button
                variant="text"
                size="small"
                type="button"
                className="chat-lab__scroll-jump-btn"
                aria-label={t("chatLab.scrollToBottom")}
                title={t("chatLab.scrollToBottom")}
                onClick={handleScrollBottom}
              >
                <ChevronDown size={18} strokeWidth={2.2} aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
