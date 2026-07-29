import { Maximize2, Minimize2, PanelRight, Route } from "lucide-react";
import { Button, Popup } from "tdesign-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildUserTurnAnchors, scrollThreadToMessage } from "../../chat/chatLabThreadScroll.js";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { OS_POPUP_INNER_CLASS, OS_POPUP_OVERLAY_CLASS, osPopupPopperOptions } from "../../ui/osPopupShared.js";
import { cn } from "../../ui/cn.js";
import ChatLabParticipantBar from "./ChatLabParticipantBar.jsx";

/**
 * Conversation title bar with group members and turn-navigation icons.
 * Always visible so users can pull agents in before the first message.
 * @param {{
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
 *   showFloatToggle?: boolean;
 *   floatOpen?: boolean;
 *   onToggleFloatOpen?: () => void;
 *   onStartFloatDrag?: (e: import("react").PointerEvent<HTMLElement>) => void;
 * }} props
 */
export default function ChatLabConvHeader({
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
  showFloatToggle = false,
  floatOpen = true,
  onToggleFloatOpen,
  onStartFloatDrag,
}) {
  const { t } = useI18n();
  const preview = useChatLabPreview();
  const panelId = useId();
  const popoverListRef = useRef(/** @type {HTMLOListElement | null} */ (null));
  const [navOpen, setNavOpen] = useState(false);

  const userTurns = useMemo(() => buildUserTurnAnchors(messages, 64), [messages]);
  const showParticipants = typeof onParticipantsChange === "function";

  useEffect(() => {
    setNavOpen(false);
  }, [conversationId]);

  useEffect(() => {
    if (!navOpen || !activeTurnId) return;
    const list = popoverListRef.current;
    if (!list) return;
    const activeItem = list.querySelector(`[data-turn-id="${CSS.escape(activeTurnId)}"]`);
    if (!(activeItem instanceof HTMLElement)) return;
    activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeTurnId, navOpen]);

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

  const handleHeaderPointerDown = useCallback(
    /** @param {import("react").PointerEvent<HTMLElement>} e */
    (e) => {
      if (!showFloatToggle || typeof onStartFloatDrag !== "function") return;
      if (e.button !== 0) return;
      const target = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
      if (!target) return;
      const interactiveHit = target.closest(
        ".chat-lab__header-actions, button, a, input, textarea, select, [role='button'], [role='link']",
      );
      if (interactiveHit) return;
      onStartFloatDrag(e);
    },
    [onStartFloatDrag, showFloatToggle],
  );

  const popupContent = (
    <div
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
                    variant="text"
                    size="small"
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
    </div>
  );

  return (
    <header className="chat-lab__conv-header" onPointerDown={handleHeaderPointerDown}>
      <div className="chat-lab__header-actions" onPointerDown={(e) => e.stopPropagation()}>
        {showParticipants ? (
          <ChatLabParticipantBar
            variant="icon"
            conversationId={conversationId}
            agents={agents}
            participantIds={participantIds}
            onChange={onParticipantsChange}
            disabled={participantsDisabled}
          />
        ) : null}
        <Popup
          key={conversationId ?? "turn-nav"}
          visible={navOpen}
          trigger="context-menu"
          placement="bottom-end"
          attach="body"
          zIndex={400}
          destroyOnClose={false}
          overlayClassName={OS_POPUP_OVERLAY_CLASS}
          overlayInnerClassName={cn(OS_POPUP_INNER_CLASS, "w-[min(100vw-2rem,320px)]")}
          popperOptions={osPopupPopperOptions(8, 8)}
          content={popupContent}
          onVisibleChange={setNavOpen}
        >
          <Button
            variant="text"
            shape="square"
            size="small"
            type="button"
            className={cn("chat-lab__turn-nav-icon-btn", navOpen && "chat-lab__turn-nav-icon-btn--open")}
            aria-label={t("chatLab.turnNavToggleHint")}
            title={t("chatLab.turnNavToggleHint")}
            aria-haspopup="dialog"
            aria-expanded={navOpen}
            aria-controls={navOpen ? panelId : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setNavOpen((v) => !v);
            }}
          >
            <Route size={16} strokeWidth={2.1} aria-hidden />
          </Button>
        </Popup>
        {showFloatToggle ? (
          <Button
            variant="text"
            shape="square"
            size="small"
            type="button"
            className="chat-lab__turn-nav-icon-btn"
            aria-label={floatOpen ? t("webExploreChat.minimize") : t("webExploreChat.launcher")}
            title={floatOpen ? t("webExploreChat.minimize") : t("webExploreChat.launcher")}
            onClick={() => onToggleFloatOpen?.()}
          >
            {floatOpen ? (
              <Minimize2 size={16} strokeWidth={2.1} aria-hidden />
            ) : (
              <Maximize2 size={16} strokeWidth={2.1} aria-hidden />
            )}
          </Button>
        ) : (
          <Button
            variant="text"
            shape="square"
            size="small"
            type="button"
            className={cn(
              "chat-lab__turn-nav-icon-btn",
              preview?.dockOpen && (preview?.session || preview?.artifactsPanel) && "chat-lab__turn-nav-icon-btn--open",
            )}
            aria-label={
              preview?.dockOpen
                ? t("chatLab.previewClose")
                : t("chatLab.previewDockToggleOpen")
            }
            title={
              preview?.dockOpen
                ? t("chatLab.previewClose")
                : t("chatLab.previewDockToggleOpen")
            }
            aria-pressed={Boolean(preview?.dockOpen && (preview?.session || preview?.artifactsPanel))}
            onClick={() => preview?.toggleDock?.()}
          >
            <PanelRight size={16} strokeWidth={2.1} aria-hidden />
          </Button>
        )}
      </div>
    </header>
  );
}
