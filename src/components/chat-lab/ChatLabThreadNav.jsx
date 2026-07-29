import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  buildUserTurnAnchors,
  getThreadScrollMetrics,
  pauseChatThreadPin,
  scrollThreadToBottom,
  scrollThreadToTop,
} from "../../chat/chatLabThreadScroll.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";
import ChatLabConvHeader from "./ChatLabConvHeader.jsx";

/**
 * @param {{
 *   conversationId?: string | null;
 *   messages: unknown[];
 *   messagesScrollRef: import("react").RefObject<HTMLDivElement | null>;
 *   autoScrollRef: import("react").MutableRefObject<boolean>;
 *   userScrollPausedRef?: import("react").MutableRefObject<boolean>;
 *   threadScrollApiRef: import("react").MutableRefObject<import("../../chat/chatLabThreadScroll.js").ChatLabThreadScrollApi | null>;
 *   agents?: import("../../studio/agents.js").LobsterAgent[];
 *   participantIds?: string[];
 *   onParticipantsChange?: (ids: string[]) => void;
 *   participantsDisabled?: boolean;
 *   showFloatToggle?: boolean;
 *   floatOpen?: boolean;
 *   onToggleFloatOpen?: () => void;
 *   onStartFloatDrag?: (e: import("react").PointerEvent<HTMLElement>) => void;
 *   children: import("react").ReactNode;
 * }} props
 */
export default function ChatLabThreadNav({
  conversationId = null,
  messages,
  messagesScrollRef,
  autoScrollRef,
  userScrollPausedRef,
  threadScrollApiRef,
  agents = [],
  participantIds = [],
  onParticipantsChange,
  participantsDisabled = false,
  showFloatToggle = false,
  floatOpen = true,
  onToggleFloatOpen,
  onStartFloatDrag,
  children,
}) {
  const { t } = useI18n();
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(/** @type {string | null} */ (null));

  const userTurns = useMemo(() => buildUserTurnAnchors(messages, 64), [messages]);

  useEffect(() => {
    setActiveTurnId(null);
  }, [conversationId]);

  const syncScrollUi = useCallback(() => {
    const el = messagesScrollRef.current;
    const metrics = getThreadScrollMetrics(el);
    setCanScroll(metrics.canScroll);
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
    pauseChatThreadPin(autoScrollRef, userScrollPausedRef);
    scrollThreadToTop(messagesScrollRef.current, threadScrollApiRef.current);
    requestAnimationFrame(syncScrollUi);
  }, [autoScrollRef, messagesScrollRef, syncScrollUi, threadScrollApiRef, userScrollPausedRef]);

  const handleScrollBottom = useCallback(() => {
    scrollThreadToBottom(messagesScrollRef.current, threadScrollApiRef.current, autoScrollRef);
    requestAnimationFrame(() => {
      syncScrollUi();
      requestAnimationFrame(syncScrollUi);
    });
  }, [autoScrollRef, messagesScrollRef, syncScrollUi, threadScrollApiRef]);

  const convHeaderProps = {
    conversationId,
    messages,
    messagesScrollRef,
    autoScrollRef,
    userScrollPausedRef,
    threadScrollApiRef,
    activeTurnId,
    onActiveTurnIdChange: setActiveTurnId,
    agents,
    participantIds,
    onParticipantsChange,
    participantsDisabled,
    showFloatToggle,
    floatOpen,
    onToggleFloatOpen,
    onStartFloatDrag,
  };

  return (
    <>
      <ChatLabConvHeader {...convHeaderProps} />
      <div className="chat-lab__messages-stage">
        {children}
        {canScroll ? (
          <div
            className={cn(
              "chat-lab__scroll-jump",
              showScrollTop && showScrollBottom && "chat-lab__scroll-jump--both",
              showScrollTop && !showScrollBottom && "chat-lab__scroll-jump--top-only",
              !showScrollTop && showScrollBottom && "chat-lab__scroll-jump--bottom-only",
            )}
            aria-hidden={false}
          >
            <button
              type="button"
              className={cn(
                "chat-lab__scroll-jump-btn",
                showScrollTop && "chat-lab__scroll-jump-btn--visible",
              )}
              aria-label={t("chatLab.scrollToTop")}
              title={t("chatLab.scrollToTop")}
              aria-hidden={!showScrollTop}
              tabIndex={showScrollTop ? 0 : -1}
              onClick={handleScrollTop}
            >
              <ChevronUp size={15} strokeWidth={2.3} aria-hidden />
            </button>
            <button
              type="button"
              className={cn(
                "chat-lab__scroll-jump-btn",
                showScrollBottom && "chat-lab__scroll-jump-btn--visible",
              )}
              aria-label={t("chatLab.scrollToBottom")}
              title={t("chatLab.scrollToBottom")}
              aria-hidden={!showScrollBottom}
              tabIndex={showScrollBottom ? 0 : -1}
              onClick={handleScrollBottom}
            >
              <ChevronDown size={15} strokeWidth={2.3} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
