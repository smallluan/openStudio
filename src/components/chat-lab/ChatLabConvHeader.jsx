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
import { PanelRight, Route } from "lucide-react";
import { Button } from "@open-studio/udesign";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildUserTurnAnchors, scrollThreadToMessage } from "../../chat/chatLabThreadScroll.js";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";
import ChatLabParticipantBar from "./ChatLabParticipantBar.jsx";

/**
 * Conversation title bar with group members and turn-navigation icons.
 * Always visible so users can pull agents in before the first message.
 * @param {{
 *   headerTitle: string;
 *   conversationId?: string | null;
 *   messages: unknown[];
 *   messagesScrollRef?: import("react").RefObject<HTMLDivElement | null>;
 *   autoScrollRef?: import("react").MutableRefObject<boolean>;
 *   threadScrollApiRef?: import("react").MutableRefObject<import("../../chat/chatLabThreadScroll.js").ChatLabThreadScrollApi | null>;
 *   activeTurnId?: string | null;
 *   onActiveTurnIdChange?: (id: string | null) => void;
 *   agents?: import("../../studio/agents.js").LobsterAgent[];
 *   participantIds?: string[];
 *   onParticipantsChange?: (ids: string[]) => void;
 *   participantsDisabled?: boolean;
 * }} props
 */
export default function ChatLabConvHeader({
  headerTitle,
  conversationId = null,
  messages,
  messagesScrollRef,
  autoScrollRef,
  threadScrollApiRef,
  activeTurnId = null,
  onActiveTurnIdChange,
  agents = [],
  participantIds = [],
  onParticipantsChange,
  participantsDisabled = false,
}) {
  const { t } = useI18n();
  const preview = useChatLabPreview();
  const panelId = useId();
  const popoverListRef = useRef(/** @type {HTMLOListElement | null} */ (null));
  const [navOpen, setNavOpen] = useState(false);
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(navOpen);

  const userTurns = useMemo(() => buildUserTurnAnchors(messages, 64), [messages]);
  const showParticipants = typeof onParticipantsChange === "function";

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
  }, [conversationId]);

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
      onActiveTurnIdChange?.(turn.id);
      if (autoScrollRef) autoScrollRef.current = false;
      scrollThreadToMessage({
        messageId: turn.id,
        messageIndex: turn.index,
        scrollContainer: messagesScrollRef?.current ?? null,
        scrollApi: threadScrollApiRef?.current ?? null,
      });
      setNavOpen(false);
    },
    [autoScrollRef, messagesScrollRef, onActiveTurnIdChange, threadScrollApiRef],
  );

  return (
    <>
      <header className="chat-lab__conv-header">
        {headerTitle ? (
          <h2 className="chat-lab__conv-title">{headerTitle}</h2>
        ) : (
          <div className="chat-lab__conv-title chat-lab__conv-title--empty" aria-hidden />
        )}
        <div className="chat-lab__header-actions">
          {showParticipants ? (
            <ChatLabParticipantBar
              variant="icon"
              agents={agents}
              participantIds={participantIds}
              onChange={onParticipantsChange}
              disabled={participantsDisabled}
            />
          ) : null}
          <Button
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
          </Button>
          <Button
            type="button"
            className="chat-lab__turn-nav-icon-btn"
            aria-label="打开侧边栏"
            title="打开侧边栏"
            onClick={() => preview?.openIframe?.("https://www.baidu.com", "百度")}
          >
            <PanelRight size={16} strokeWidth={2.1} aria-hidden />
          </Button>
        </div>
      </header>

      {present ? (
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
                  {userTurns.length > 0 ? (
                    <ol ref={popoverListRef} className="chat-lab__turn-nav-list">
                      {userTurns.map((turn) => {
                        const active = activeTurnId === turn.id;
                        return (
                          <li key={turn.id} className="chat-lab__turn-nav-item">
                            <Button
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
                                    active ? "chat-lab__turn-nav-dot--active" : "chat-lab__turn-nav-dot--idle",
                                  )}
                                />
                              </span>
                              <span className="chat-lab__turn-nav-text">{turn.preview}</span>
                            </Button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="chat-lab__turn-nav-empty">{t("chatLab.turnNavEmpty")}</p>
                  )}
                </nav>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
