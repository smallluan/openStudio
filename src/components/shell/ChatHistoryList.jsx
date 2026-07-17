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
import { ChevronDown, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { Button } from "@open-studio/udesign";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import heroAvatarLight from "../../assets/images/hero-avatar-light.png";
import heroAvatarDark from "../../assets/images/hero-avatar-dark.png";
import WechatIcon from "../../assets/svg/WechatIcon.jsx";
import {
  CHAT_SESSION_CHANNEL_INTERNAL,
  CHAT_SESSION_CHANNEL_WECHAT,
  deleteSession,
  deleteSessionsByIds,
  loadAllSessions,
  renameSession,
} from "../../chat/chatSessionsStore.js";
import { formatSessionRelativeTime } from "../../i18n/relativeTime.js";
import { useChatLabStreaming } from "../../context/ChatLabStreamingContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import FluidConfirmDialog from "../../ui/FluidConfirmDialog.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { useFluidPopupBlob } from "../../ui/useFluidPopupBlob.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";
import { cn } from "../../ui/cn.js";
import {
  CHAT_HISTORY_ROW_COLLAPSE_MS,
  CHAT_HISTORY_ROW_LEAVE_MS,
  useChatHistoryListMotion,
} from "./useChatHistoryListMotion.js";

const CHAT_HISTORY_GROUP_LEAVE_MS = CHAT_HISTORY_ROW_LEAVE_MS + CHAT_HISTORY_ROW_COLLAPSE_MS;

function HistorySessionSpinner({ label }) {
  return (
    <span className="chat-history-card__spinner-wrap shrink-0" title={label} aria-label={label}>
      <span className="chat-history-card__spinner" aria-hidden />
    </span>
  );
}

function HistorySessionGlyph({ active }) {
  return (
    <svg
      className={cn(
        "chat-history-card__glyph shrink-0 transition-[opacity,color,filter] duration-[450ms] ease-[cubic-bezier(0.34,1.2,0.52,1)]",
        active ? "chat-history-card__glyph--row-active" : "opacity-[0.88]",
      )}
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
    >
      <path
        d="M4.5 14.5 2.5 15.5V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-2.5 1.5Z"
        fill="#fef2f2"
        stroke="#ef4444"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7.9 2.6 11.4 6.1M1 13l3.15-.35a1 1 0 0 0 .52-.28l6.9-6.9a1 1 0 0 0 0-1.42L9.85.88a1 1 0 0 0-1.42 0l-6.9 6.9a1 1 0 0 0-.28.52L1 13Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h9M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M11.5 3.5v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-8M5.5 6.5v4M8.5 6.5v4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * @param {{
 *   channel: 'internal' | 'wechat';
 *   label: string;
 *   collapsed: boolean;
 *   focused: boolean;
 *   deleteMode: boolean;
 *   selectedCount: number;
 *   onToggleCollapsed: () => void;
 *   onToggleFocus: () => void;
 *   onEnterDeleteMode: () => void;
 *   onCancelDeleteMode: () => void;
 *   onConfirmDelete: () => void;
 * }} props
 */
function ChatHistoryGroupHead({
  channel,
  label,
  collapsed,
  focused,
  deleteMode,
  selectedCount,
  onToggleCollapsed,
  onToggleFocus,
  onEnterDeleteMode,
  onCancelDeleteMode,
  onConfirmDelete,
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const isWechat = channel === CHAT_SESSION_CHANNEL_WECHAT;

  return (
    <div
      className={cn(
        "chat-history-group__head group",
        (deleteMode || focused) && "chat-history-group__head--actions-visible",
      )}
    >
      <Button
        type="button"
        variant="text"
        block
        className="chat-history-group__head-main"
        onClick={() => {
          if (!deleteMode) onToggleCollapsed();
        }}
        aria-expanded={!collapsed}
        disabled={deleteMode}
      >
        <span className="chat-history-group__logo" aria-hidden>
          {isWechat ? (
            <WechatIcon className="chat-history-group__logo-wechat" />
          ) : (
            <img
              className="chat-history-group__logo-img"
              src={theme === "dark" ? heroAvatarDark : heroAvatarLight}
              alt=""
            />
          )}
        </span>
        <span className="chat-history-group__label">{label}</span>
      </Button>
      <div className="chat-history-group__actions">
        {deleteMode ? (
          <>
            <Button
              type="button"
              variant="text"
              size="small"
              className="chat-history-group__action-btn chat-history-group__action-btn--text"
              onClick={onCancelDeleteMode}
            >
              {t("dialog.cancel")}
            </Button>
            <Button
              type="button"
              variant="text"
              size="small"
              className={cn(
                "chat-history-group__action-btn chat-history-group__action-btn--text",
                selectedCount < 1 && "chat-history-group__action-btn--disabled",
              )}
              disabled={selectedCount < 1}
              onClick={onConfirmDelete}
            >
              {t("nav.chatHistoryDeleteSelected", { n: selectedCount })}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className="chat-history-group__action-btn"
              aria-label={t("nav.chatHistoryGroupDeleteSelectAria")}
              title={t("nav.chatHistoryGroupDeleteSelectAria")}
              onClick={(e) => {
                e.stopPropagation();
                onEnterDeleteMode();
              }}
            >
              <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className="chat-history-group__action-btn"
              aria-label={focused ? t("nav.chatHistoryGroupShrinkAria") : t("nav.chatHistoryGroupExpandAria")}
              title={focused ? t("nav.chatHistoryGroupShrinkAria") : t("nav.chatHistoryGroupExpandAria")}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFocus();
              }}
            >
              {focused ? (
                <Minimize2 className="size-3.5" strokeWidth={2} aria-hidden />
              ) : (
                <Maximize2 className="size-3.5" strokeWidth={2} aria-hidden />
              )}
            </Button>
          </>
        )}
      </div>
      <Button
        type="button"
        variant="text"
        shape="square"
        size="small"
        className="chat-history-group__caret-btn"
        onClick={() => {
          if (!deleteMode) onToggleCollapsed();
        }}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("nav.chatHistoryGroupExpandList") : t("nav.chatHistoryGroupCollapseList")}
        disabled={deleteMode}
      >
        <ChevronDown
          className={cn("chat-history-group__caret", collapsed && "chat-history-group__caret--collapsed")}
          strokeWidth={2.25}
          aria-hidden
        />
      </Button>
    </div>
  );
}

/**
 * @param {{
 *   sessionId: string;
 *   displayTitle: string;
 *   updatedAt: number;
 *   rowActive: boolean;
 *   to: string;
 *   rowRef: (node: HTMLElement | null) => void;
 *   rowMotion: 'idle' | 'enter-push' | 'enter-push-active' | 'enter-in' | 'leave-out' | 'leave-collapse';
 *   onRenamed: () => void;
 *   onAfterDelete: () => void;
 *   isStreaming?: boolean;
 *   selectMode?: boolean;
 *   selected?: boolean;
 *   selectDisabled?: boolean;
 *   onToggleSelect?: () => void;
 * }} props
 */
function HistorySessionRow({
  sessionId,
  displayTitle,
  updatedAt,
  rowActive,
  to,
  rowRef,
  rowMotion,
  onRenamed,
  onAfterDelete,
  isStreaming = false,
  selectMode = false,
  selected = false,
  selectDisabled = false,
  onToggleSelect,
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const activeC = new URLSearchParams(location.search).get("c");
  const [open, setOpen] = useState(false);
  const [menuHoverKey, setMenuHoverKey] = useState(/** @type {"rename" | "delete" | null} */ (null));
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);

  const { rootRef: menuBlobRootRef, setItemRef: setMenuItemRef, blobStyle: menuBlobStyle } = useFluidPopupBlob({
    open,
    hoverKey: menuHoverKey,
    fallbackKey: null,
    layoutKey: "",
  });

  useEffect(() => {
    if (!open) setMenuHoverKey(null);
  }, [open]);

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "bottom-end",
    strategy: "fixed",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const floatingProps = getFloatingProps();

  const handleRename = () => {
    setOpen(false);
    const next = window.prompt(t("nav.chatHistoryRenamePrompt"), displayTitle);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    renameSession(sessionId, trimmed);
    onRenamed();
  };

  const handleDelete = () => {
    setOpen(false);
    deleteSession(sessionId);
    onAfterDelete();
    if (activeC === sessionId) navigate("/chat", { replace: true });
  };

  return (
    <li
      ref={rowRef}
      className={cn(
        "chat-history-row min-w-0",
        rowMotion === "enter-push" && "chat-history-row--enter-push",
        rowMotion === "enter-push-active" && "chat-history-row--enter-push-active",
        rowMotion === "enter-in" && "chat-history-row--enter-in",
        rowMotion === "leave-out" && "chat-history-row--leave-out",
        rowMotion === "leave-collapse" && "chat-history-row--leave-collapse",
      )}
      aria-busy={isStreaming}
    >
      <div className="chat-history-row__motion min-w-0">
      <div
        className={cn(
          "chat-history-row__body flex min-w-0 items-stretch gap-0 py-0.5 pl-2 pr-0.5 transition-[color,filter] duration-[450ms] ease-[cubic-bezier(0.34,1.2,0.52,1)]",
          rowActive ? "chat-history-row__body--active text-[var(--os-text)]" : "text-[var(--os-text-muted)]",
          !rowActive && "hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)]",
        )}
      >
        {selectMode ? (
          <Button
            type="button"
            variant="text"
            block
            title={displayTitle}
            disabled={selectDisabled}
            className={cn(
              "chat-history-card__link flex min-w-0 flex-1 items-center gap-1.5 text-left",
              selectDisabled && "cursor-not-allowed",
            )}
            onClick={() => {
              if (!selectDisabled) onToggleSelect?.();
            }}
          >
            <span
              className={cn(
                "chat-history-card__select-box shrink-0",
                selected && "chat-history-card__select-box--checked",
              )}
              aria-hidden
            >
              {selected ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M2.2 5.2 4.1 7.1 7.8 3.4"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0 text-left">
              <span className="chat-history-card__title truncate text-[0.78rem] font-medium leading-snug">{displayTitle}</span>
              <span className="chat-history-card__time text-[0.6875rem] leading-snug text-[var(--os-text-faint)]">
                {formatSessionRelativeTime(t, updatedAt)}
              </span>
            </span>
          </Button>
        ) : (
          <NavLink
            to={to}
            title={displayTitle}
            className={cn(
              "chat-history-card__link flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 pl-0.5 pr-1 leading-tight no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--os-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)]",
              rowActive && "font-semibold",
            )}
            aria-current={rowActive ? "page" : undefined}
          >
            {isStreaming ? (
              <HistorySessionSpinner label={t("nav.chatHistoryGenerating")} />
            ) : (
              <HistorySessionGlyph active={rowActive} />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0 text-left">
              <span className="chat-history-card__title truncate text-[0.78rem] font-medium leading-snug">{displayTitle}</span>
              <span className="chat-history-card__time text-[0.6875rem] leading-snug text-[var(--os-text-faint)]">
                {formatSessionRelativeTime(t, updatedAt)}
              </span>
            </span>
          </NavLink>
        )}
        {!selectMode ? (
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className={cn(
              "chat-history-card__more shrink-0 self-center",
              present && "chat-history-card__more--open",
            )}
            ref={refs.setReference}
            aria-label={t("nav.chatHistoryMore")}
            aria-haspopup="menu"
            aria-expanded={present}
            {...getReferenceProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="translate-y-[-1px]" aria-hidden>
              ⋮
            </span>
          </Button>
        ) : null}
      </div>
      </div>
      {present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="outline-none"
              {...floatingProps}
              onPointerLeave={(e) => {
                floatingProps.onPointerLeave?.(e);
                setMenuHoverKey(null);
              }}
            >
              <FluidPopupAnimatedSurface
                key={surfaceKey}
                leaving={leaving}
                finishLeave={finishLeave}
                placement={context.placement}
                morphBr="11px"
                className={cn("chat-history-card__menu")}
              >
                <div ref={menuBlobRootRef} className="relative w-full chat-history-card__menu-blob-scope">
                  <div
                    aria-hidden
                    className="fluid-nav__blob fluid-popup-menu__blob pointer-events-none absolute top-0 left-0 z-0"
                    style={menuBlobStyle}
                  />
                  <div className="chat-history-card__menu-row" onPointerEnter={() => setMenuHoverKey("rename")}>
                    <div ref={(node) => setMenuItemRef("rename", node)} className="fluid-popup-menu__measure">
                      <Button type="button" variant="text" block className="chat-history-card__menu-item w-full min-w-0" onClick={handleRename}>
                        <PencilIcon className="text-[var(--os-text-muted)]" />
                        {t("nav.chatHistoryRename")}
                      </Button>
                    </div>
                  </div>
                  <div className="chat-history-card__menu-row chat-history-card__menu-row--with-divider" onPointerEnter={() => setMenuHoverKey("delete")}>
                    <div ref={(node) => setMenuItemRef("delete", node)} className="fluid-popup-menu__measure">
                      <Button
                        type="button"
                        theme="danger"
                        variant="text"
                        block
                        className="chat-history-card__menu-item chat-history-card__menu-item--danger w-full min-w-0"
                        onClick={handleDelete}
                      >
                        <TrashIcon className="shrink-0" />
                        {t("nav.chatHistoryDelete")}
                      </Button>
                    </div>
                  </div>
                </div>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </li>
  );
}

/**
 * @param {{ narrow?: boolean; filterQuery?: string }} props
 */
export default function ChatHistoryList({ narrow = false, filterQuery = "" }) {
  const { t } = useI18n();
  const { streamingSessionIds, wechatReplyingSessionId } = useChatLabStreaming();
  const location = useLocation();
  const navigate = useNavigate();

  const [listVersion, setListVersion] = useState(0);
  const reload = useCallback(() => setListVersion((v) => v + 1), []);

  const [focusedChannel, setFocusedChannel] = useState(
    /** @type {null | typeof CHAT_SESSION_CHANNEL_INTERNAL | typeof CHAT_SESSION_CHANNEL_WECHAT} */ (null),
  );
  const [deleteModeChannel, setDeleteModeChannel] = useState(
    /** @type {null | typeof CHAT_SESSION_CHANNEL_INTERNAL | typeof CHAT_SESSION_CHANNEL_WECHAT} */ (null),
  );
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState(() => {
    try {
      const raw = window.localStorage.getItem("openstudio_chat_history_fold_v1");
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        [CHAT_SESSION_CHANNEL_INTERNAL]: Boolean(parsed?.[CHAT_SESSION_CHANNEL_INTERNAL]),
        [CHAT_SESSION_CHANNEL_WECHAT]: Boolean(parsed?.[CHAT_SESSION_CHANNEL_WECHAT]),
      };
    } catch {
      return {
        [CHAT_SESSION_CHANNEL_INTERNAL]: false,
        [CHAT_SESSION_CHANNEL_WECHAT]: false,
      };
    }
  });

  const scrollRootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const scrollContentRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const railScrollbarThumbRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  const [railScrollable, setRailScrollable] = useState(false);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === null || e.key === "openstudio_chat_sessions_v1") reload();
    };
    const onCustom = () => reload();
    const onWechatInbound = () => {
      setGroupCollapsed((prev) => ({ ...prev, [CHAT_SESSION_CHANNEL_WECHAT]: false }));
      reload();
    };
    const onWechatSessionCreated = () => {
      setGroupCollapsed((prev) => ({ ...prev, [CHAT_SESSION_CHANNEL_WECHAT]: false }));
      reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("openstudio-chat-sessions-changed", onCustom);
    window.addEventListener("openstudio-wechat-session-inbound", onWechatInbound);
    window.addEventListener("openstudio-wechat-session-created", onWechatSessionCreated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("openstudio-chat-sessions-changed", onCustom);
      window.removeEventListener("openstudio-wechat-session-inbound", onWechatInbound);
      window.removeEventListener("openstudio-wechat-session-created", onWechatSessionCreated);
    };
  }, [reload]);

  const allSessions = useMemo(() => loadAllSessions(), [listVersion, location.pathname, location.search]);

  const searchFiltered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return allSessions;
    return allSessions.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [allSessions, filterQuery]);

  const viewSessions = useMemo(
    () =>
      searchFiltered.filter((s) => {
        const channel =
          s.channel === CHAT_SESSION_CHANNEL_WECHAT ? CHAT_SESSION_CHANNEL_WECHAT : CHAT_SESSION_CHANNEL_INTERNAL;
        if (focusedChannel && channel !== focusedChannel) return false;
        if (deleteModeChannel === channel) return true;
        if (groupCollapsed[channel]) return false;
        return true;
      }),
    [searchFiltered, focusedChannel, deleteModeChannel, groupCollapsed],
  );

  const { displaySessions, getRowMotion, registerRowRef } = useChatHistoryListMotion(allSessions, viewSessions);

  const prevFocusedRef = useRef(focusedChannel);
  const headerLeaveTimersRef = useRef(/** @type {Set<number>} */ (new Set()));
  const [leavingChannelHeaders, setLeavingChannelHeaders] = useState(
    /** @type {Array<typeof CHAT_SESSION_CHANNEL_INTERNAL | typeof CHAT_SESSION_CHANNEL_WECHAT>} */ ([]),
  );
  const [headerMotionByChannel, setHeaderMotionByChannel] = useState(
    () => new Map(/** @type {[typeof CHAT_SESSION_CHANNEL_INTERNAL | typeof CHAT_SESSION_CHANNEL_WECHAT, 'leave-out' | 'leave-collapse'][]} */ ([])),
  );

  useEffect(
    () => () => {
      for (const id of headerLeaveTimersRef.current) window.clearTimeout(id);
      headerLeaveTimersRef.current.clear();
    },
    [],
  );

  useLayoutEffect(() => {
    const prevFocus = prevFocusedRef.current;
    const nextFocus = focusedChannel;
    if (prevFocus === nextFocus) return;

    const allChannels = [CHAT_SESSION_CHANNEL_INTERNAL, CHAT_SESSION_CHANNEL_WECHAT];
    const prevVisible = prevFocus ? [prevFocus] : allChannels;
    const nextVisible = nextFocus ? [nextFocus] : allChannels;
    const hiding = prevVisible.filter((c) => !nextVisible.includes(c));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const channel of hiding) {
      if (reducedMotion) continue;
      setLeavingChannelHeaders((prev) => (prev.includes(channel) ? prev : [...prev, channel]));
      setHeaderMotionByChannel((m) => new Map(m).set(channel, "leave-out"));

      const collapseTimer = window.setTimeout(() => {
        headerLeaveTimersRef.current.delete(collapseTimer);
        setHeaderMotionByChannel((m) => {
          const n = new Map(m);
          if (n.get(channel) === "leave-out") n.set(channel, "leave-collapse");
          return n;
        });
      }, CHAT_HISTORY_ROW_LEAVE_MS);
      headerLeaveTimersRef.current.add(collapseTimer);

      const removeTimer = window.setTimeout(() => {
        headerLeaveTimersRef.current.delete(removeTimer);
        setLeavingChannelHeaders((prev) => prev.filter((c) => c !== channel));
        setHeaderMotionByChannel((m) => {
          const n = new Map(m);
          n.delete(channel);
          return n;
        });
      }, CHAT_HISTORY_GROUP_LEAVE_MS);
      headerLeaveTimersRef.current.add(removeTimer);
    }

    if (reducedMotion) {
      setLeavingChannelHeaders([]);
      setHeaderMotionByChannel(new Map());
    }

    prevFocusedRef.current = nextFocus;
  }, [focusedChannel]);

  useEffect(() => {
    try {
      window.localStorage.setItem("openstudio_chat_history_fold_v1", JSON.stringify(groupCollapsed));
    } catch {
      /* ignore */
    }
  }, [groupCollapsed]);

  const activeC = useMemo(() => {
    try {
      return new URLSearchParams(location.search).get("c");
    } catch {
      return null;
    }
  }, [location.search]);

  const emptyAll = allSessions.length === 0;
  const emptyFilter = !emptyAll && searchFiltered.length === 0;

  const groupedCounts = useMemo(() => {
    let internal = 0;
    let wechat = 0;
    for (const row of displaySessions) {
      if (row.channel === CHAT_SESSION_CHANNEL_WECHAT) wechat += 1;
      else internal += 1;
    }
    return { internal, wechat };
  }, [displaySessions]);

  const groupedVisible = useMemo(() => {
    /** @type {{ internal: typeof displaySessions; wechat: typeof displaySessions }} */
    const groups = { internal: [], wechat: [] };
    for (const row of displaySessions) {
      if (row.channel === CHAT_SESSION_CHANNEL_WECHAT) groups.wechat.push(row);
      else groups.internal.push(row);
    }
    return groups;
  }, [displaySessions]);

  const selectedDeleteIds = useMemo(() => {
    const skip = new Set([...streamingSessionIds, wechatReplyingSessionId].filter(Boolean));
    return [...selectedIds].filter((id) => id && !skip.has(id));
  }, [selectedIds, streamingSessionIds, wechatReplyingSessionId]);

  const handleCancelDeleteMode = useCallback(() => {
    setDeleteModeChannel(null);
    setSelectedIds(new Set());
    setDeleteConfirmOpen(false);
  }, []);

  const handleConfirmDeleteSelected = useCallback(() => {
    const n = selectedDeleteIds.length;
    if (n < 1) return;
    deleteSessionsByIds(selectedDeleteIds);
    handleCancelDeleteMode();
    reload();
    if (activeC && selectedDeleteIds.includes(activeC)) navigate("/chat", { replace: true });
  }, [activeC, handleCancelDeleteMode, navigate, reload, selectedDeleteIds]);

  const handleEnterDeleteMode = useCallback((channel) => {
    setDeleteModeChannel(channel);
    setSelectedIds(new Set());
    setDeleteConfirmOpen(false);
    setGroupCollapsed((g) => ({ ...g, [channel]: false }));
  }, []);

  const handleToggleSelect = useCallback((sessionId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const handleToggleFocus = useCallback((channel) => {
    handleCancelDeleteMode();
    setFocusedChannel((prev) => {
      if (prev === channel) return null;
      setGroupCollapsed((g) => ({ ...g, [channel]: false }));
      return channel;
    });
  }, [handleCancelDeleteMode]);

  const toggleGroupCollapsed = useCallback((channel) => {
    setGroupCollapsed((prev) => ({ ...prev, [channel]: !prev[channel] }));
  }, []);

  const channelGroups = useMemo(
    () => [
      {
        channel: CHAT_SESSION_CHANNEL_INTERNAL,
        label: t("nav.chatHistoryGroupInternal"),
        rows: groupedVisible.internal,
        count: groupedCounts.internal,
      },
      {
        channel: CHAT_SESSION_CHANNEL_WECHAT,
        label: t("nav.chatHistoryGroupWechat"),
        rows: groupedVisible.wechat,
        count: groupedCounts.wechat,
      },
    ],
    [groupedCounts.internal, groupedCounts.wechat, groupedVisible.internal, groupedVisible.wechat, t],
  );

  const channelsForHeaders = useMemo(() => {
    const active = focusedChannel
      ? [focusedChannel]
      : [CHAT_SESSION_CHANNEL_INTERNAL, CHAT_SESSION_CHANNEL_WECHAT];
    const extra = leavingChannelHeaders.filter((c) => !active.includes(c));
    return [...active, ...extra];
  }, [focusedChannel, leavingChannelHeaders]);

  const renderChannelGroups = useMemo(
    () =>
      channelsForHeaders
        .map((channel) => channelGroups.find((g) => g.channel === channel))
        .filter(Boolean),
    [channelGroups, channelsForHeaders],
  );

  const isGroupExpanded = useCallback(
    (channel) => deleteModeChannel === channel || !groupCollapsed[channel],
    [deleteModeChannel, groupCollapsed],
  );

  const getGroupRows = useCallback(
    (channel, fallbackRows) => {
      if (deleteModeChannel !== channel) return fallbackRows;
      return searchFiltered.filter((row) => {
        const rowChannel =
          row.channel === CHAT_SESSION_CHANNEL_WECHAT ? CHAT_SESSION_CHANNEL_WECHAT : CHAT_SESSION_CHANNEL_INTERNAL;
        if (rowChannel !== channel) return false;
        return !focusedChannel || focusedChannel === channel;
      });
    },
    [deleteModeChannel, focusedChannel, searchFiltered],
  );

  const renderHistoryRow = (s) => {
    const to = `/chat?c=${encodeURIComponent(s.id)}`;
    const rowActive = (location.pathname === "/chat" || location.pathname === "/") && activeC === s.id;
    const displayTitle = s.title || t("nav.chatHistoryUntitled");
    const rowChannel =
      s.channel === CHAT_SESSION_CHANNEL_WECHAT ? CHAT_SESSION_CHANNEL_WECHAT : CHAT_SESSION_CHANNEL_INTERNAL;
    const inDeleteMode = deleteModeChannel === rowChannel;
    const orchStatus = s.orchestration?.status;
    const orchestrationActive =
      orchStatus === "planning" || orchStatus === "revising" || orchStatus === "running";
    const isStreaming =
      streamingSessionIds.has(s.id) || wechatReplyingSessionId === s.id || orchestrationActive;
    return (
      <HistorySessionRow
        key={s.id}
        sessionId={s.id}
        displayTitle={displayTitle}
        updatedAt={s.updatedAt}
        rowActive={rowActive}
        to={to}
        rowRef={(node) => registerRowRef(s.id, node)}
        rowMotion={getRowMotion(s.id)}
        onRenamed={reload}
        onAfterDelete={reload}
        isStreaming={isStreaming}
        selectMode={inDeleteMode}
        selected={selectedIds.has(s.id)}
        selectDisabled={isStreaming}
        onToggleSelect={() => handleToggleSelect(s.id)}
      />
    );
  };

  const updateRailScrollbar = useCallback(() => {
    const el = scrollRootRef.current;
    const thumb = railScrollbarThumbRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const scrollRange = scrollHeight - clientHeight;
    const overflow = scrollRange > 1;
    setRailScrollable((prev) => (prev === overflow ? prev : overflow));
    if (!thumb) return;
    if (!overflow) {
      thumb.style.height = "0px";
      thumb.style.opacity = "0";
      thumb.style.pointerEvents = "none";
      return;
    }
    const trackH = clientHeight;
    const thumbMin = 28;
    const thumbH = Math.min(trackH, Math.max(thumbMin, Math.round((clientHeight / scrollHeight) * trackH)));
    const thumbTravel = Math.max(1, trackH - thumbH);
    const thumbTop = Math.round((scrollTop / scrollRange) * thumbTravel);
    thumb.style.height = `${thumbH}px`;
    thumb.style.opacity = "1";
    thumb.style.pointerEvents = "auto";
    thumb.style.transform = `translateY(${thumbTop}px)`;
  }, []);

  useLayoutEffect(() => {
    if (narrow) return undefined;
    const el = scrollRootRef.current;
    const inner = scrollContentRef.current;
    if (!el) return undefined;
    updateRailScrollbar();
    const onScroll = () => updateRailScrollbar();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => updateRailScrollbar()) : null;
    ro?.observe(el);
    if (inner) ro?.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [narrow, updateRailScrollbar, listVersion, displaySessions.length, emptyAll, emptyFilter, groupCollapsed, focusedChannel, deleteModeChannel, leavingChannelHeaders.length]);

  const onRailThumbPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = scrollRootRef.current;
      const thumb = railScrollbarThumbRef.current;
      if (!el || !thumb) return;
      const track = thumb.parentElement;
      if (!track) return;
      const scrollRange = el.scrollHeight - el.clientHeight;
      if (scrollRange <= 1) return;
      const startY = e.clientY;
      const startScroll = el.scrollTop;
      const trackH = track.clientHeight;
      const thumbH = thumb.offsetHeight;
      const thumbTravel = Math.max(1, trackH - thumbH);
      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        el.scrollTop = Math.min(scrollRange, Math.max(0, startScroll + (dy / thumbTravel) * scrollRange));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  if (narrow) {
    return null;
  }

  return (
    <div className="chat-history-rail flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden border-t border-[color-mix(in_srgb,var(--os-border)_80%,transparent)] px-0.5 pt-2.5">
      <div className="chat-history-rail__heading-row flex shrink-0 items-center gap-2 px-2">
        <div className="chat-history-rail__heading min-w-0 truncate text-[0.72rem] font-semibold uppercase tracking-wide">
          {t("nav.chatHistory")}
        </div>
      </div>
      <div className="chat-history-rail__scroll-clip relative min-h-0 flex-1">
        <div
          ref={scrollRootRef}
          className={cn(
            "chat-history-rail__scroll scrollbar-hide h-full min-h-0 overflow-y-auto overflow-x-hidden pb-1",
            railScrollable && "pr-2",
          )}
        >
          <div ref={scrollContentRef}>
            {emptyAll ? (
              <EmptyState title={t("nav.chatHistoryEmpty")} hideDecoration className="min-h-[5rem] py-6" />
            ) : emptyFilter ? (
              <EmptyState title={t("nav.chatHistoryNoMatch")} hideDecoration className="min-h-[5rem] py-6" />
            ) : (
              <ul className="relative z-[1] m-0 flex list-none flex-col gap-0.5 p-0 px-1">
                {renderChannelGroups.map((group) => {
                  const groupRows = getGroupRows(group.channel, group.rows);
                  const channelSelectedCount = groupRows.filter(
                    (row) =>
                      selectedIds.has(row.id) &&
                      !streamingSessionIds.has(row.id) &&
                      row.id !== wechatReplyingSessionId,
                  ).length;
                  const headerMotion = headerMotionByChannel.get(group.channel);
                  const showDivider =
                    !focusedChannel && group.channel === CHAT_SESSION_CHANNEL_WECHAT;
                  return (
                    <Fragment key={group.channel}>
                      <li
                        className={cn(
                          "chat-history-group",
                          showDivider && "chat-history-group--divider",
                          headerMotion === "leave-out" && "chat-history-group--leave-out",
                          headerMotion === "leave-collapse" && "chat-history-group--leave-collapse",
                        )}
                      >
                        <ChatHistoryGroupHead
                          channel={group.channel}
                          label={group.label}
                          collapsed={!isGroupExpanded(group.channel)}
                          focused={focusedChannel === group.channel}
                          deleteMode={deleteModeChannel === group.channel}
                          selectedCount={channelSelectedCount}
                          onToggleCollapsed={() => toggleGroupCollapsed(group.channel)}
                          onToggleFocus={() => handleToggleFocus(group.channel)}
                          onEnterDeleteMode={() => handleEnterDeleteMode(group.channel)}
                          onCancelDeleteMode={handleCancelDeleteMode}
                          onConfirmDelete={() => {
                            if (selectedDeleteIds.length < 1) return;
                            setDeleteConfirmOpen(true);
                          }}
                        />
                      </li>
                      {isGroupExpanded(group.channel) ? groupRows.map(renderHistoryRow) : null}
                    </Fragment>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div
          className={cn(
            "chat-history-rail__gutter pointer-events-none absolute top-0 right-0 bottom-1 z-[4] w-2 flex justify-center",
            !railScrollable && "opacity-0",
          )}
          aria-hidden
        >
          <div className="chat-history-rail__gutter-track pointer-events-none relative h-full w-1 shrink-0 rounded-full">
            <div
              ref={railScrollbarThumbRef}
              className="chat-history-rail__gutter-thumb pointer-events-auto absolute top-0 left-0 w-full rounded-full"
              style={{ height: 0, willChange: "transform, height" }}
              onPointerDown={onRailThumbPointerDown}
            />
          </div>
        </div>
      </div>
      <FluidConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        danger
        onConfirm={handleConfirmDeleteSelected}
      >
        {t("nav.chatHistoryDeleteSelectedConfirm", { n: selectedDeleteIds.length })}
      </FluidConfirmDialog>
    </div>
  );
}
