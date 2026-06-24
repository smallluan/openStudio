import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { ChevronDown, ChevronUp, Route } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildUserTurnAnchors,
  getThreadScrollMetrics,
  scrollThreadToBottom,
  scrollThreadToMessage,
  scrollThreadToTop,
} from "../../chat/chatLabThreadScroll.js";
import { useI18n } from "../../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

/**
 * @param {{
 *   headerTitle: string;
 *   conversationId?: string | null;
 *   messages: unknown[];
 *   messagesScrollRef: import("react").RefObject<HTMLDivElement | null>;
 *   autoScrollRef: import("react").MutableRefObject<boolean>;
 *   threadScrollApiRef: import("react").MutableRefObject<import("../../chat/chatLabThreadScroll.js").ChatLabThreadScrollApi | null>;
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
  children,
}) {
  const { t } = useI18n();
  const panelId = useId();
  const popoverListRef = useRef(/** @type {HTMLOListElement | null} */ (null));
  const [navOpen, setNavOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(/** @type {string | null} */ (null));
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(navOpen);

  const userTurns = useMemo(() => buildUserTurnAnchors(messages, 64), [messages]);
  const showTurnNav = userTurns.length >= 2;

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setNavOpen,
    placement: "bottom-end",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  useEffect(() => {
    setNavOpen(false);
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

  useEffect(() => {
    if (!present || !activeTurnId) return;
    const list = popoverListRef.current;
    if (!list) return;
    const activeItem = list.querySelector(`[data-turn-id="${CSS.escape(activeTurnId)}"]`);
    if (!(activeItem instanceof HTMLElement)) return;
    activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeTurnId, present]);

  const handleJumpToTurn = useCallback(
    /** @param {{ id: string; index: number }} turn */
    (turn) => {
      setActiveTurnId(turn.id);
      autoScrollRef.current = false;
      scrollThreadToMessage({
        messageId: turn.id,
        messageIndex: turn.index,
        scrollContainer: messagesScrollRef.current,
        scrollApi: threadScrollApiRef.current,
      });
      setNavOpen(false);
    },
    [autoScrollRef, messagesScrollRef, threadScrollApiRef],
  );

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

  return (
    <>
      <header className="chat-lab__conv-header">
        <h2 className="chat-lab__conv-title">{headerTitle}</h2>
        {showTurnNav ? (
          <div className="chat-lab__header-actions">
            <button
              ref={refs.setReference}
              type="button"
              className={cn("chat-lab__turn-nav-icon-btn", present && "chat-lab__turn-nav-icon-btn--open")}
              aria-label={t("chatLab.turnNavToggleHint")}
              title={t("chatLab.turnNavToggleHint")}
              aria-haspopup="dialog"
              aria-expanded={present}
              aria-controls={present ? panelId : undefined}
              {...getReferenceProps()}
            >
              <Route size={16} strokeWidth={2.1} aria-hidden />
            </button>
          </div>
        ) : null}
      </header>

      {showTurnNav && present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="outline-none z-[400] w-[min(100vw-2rem,320px)] max-w-[min(100vw-2rem,320px)]"
              {...getFloatingProps()}
            >
              <FluidPopupAnimatedSurface
                key={surfaceKey}
                leaving={leaving}
                finishLeave={finishLeave}
                placement={context.placement}
                morphBr="14px"
                className={cn(
                  "chat-lab__turn-nav-popover flex w-full flex-col overflow-hidden rounded-[14px] border",
                  "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
                  "shadow-[var(--os-shadow-soft)]",
                )}
              >
                <nav id={panelId} className="chat-lab__turn-nav-popover-inner" aria-label={t("chatLab.turnNavAria")}>
                  <ol ref={popoverListRef} className="chat-lab__turn-nav-list">
                    {userTurns.map((turn) => {
                      const active = activeTurnId === turn.id;
                      return (
                        <li key={turn.id} className="chat-lab__turn-nav-item">
                          <button
                            type="button"
                            className={cn("chat-lab__turn-nav-row", active && "chat-lab__turn-nav-row--active")}
                            data-turn-id={turn.id}
                            title={turn.preview}
                            aria-current={active ? "step" : undefined}
                            onClick={() => handleJumpToTurn(turn)}
                          >
                            <span className="chat-lab__turn-nav-track" aria-hidden>
                              <span
                                className={cn(
                                  "chat-lab__turn-nav-dot",
                                  active
                                    ? "chat-lab__turn-nav-dot--active"
                                    : "chat-lab__turn-nav-dot--idle",
                                )}
                              />
                            </span>
                            <span className="chat-lab__turn-nav-text">{turn.preview}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}

      <div className="chat-lab__messages-stage">
        {children}
        {showScrollTop || showScrollBottom ? (
          <div className="chat-lab__scroll-jump" aria-hidden={false}>
            {showScrollTop ? (
              <button
                type="button"
                className="chat-lab__scroll-jump-btn"
                aria-label={t("chatLab.scrollToTop")}
                title={t("chatLab.scrollToTop")}
                onClick={handleScrollTop}
              >
                <ChevronUp size={18} strokeWidth={2.2} aria-hidden />
              </button>
            ) : null}
            {showScrollBottom ? (
              <button
                type="button"
                className="chat-lab__scroll-jump-btn"
                aria-label={t("chatLab.scrollToBottom")}
                title={t("chatLab.scrollToBottom")}
                onClick={handleScrollBottom}
              >
                <ChevronDown size={18} strokeWidth={2.2} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
