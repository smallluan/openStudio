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
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { deleteSession, loadAllSessions, renameSession } from "../../chat/chatSessionsStore.js";
import { formatSessionRelativeTime } from "../../i18n/relativeTime.js";
import { useChatLabStreaming } from "../../context/ChatLabStreamingContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import { FluidNavHighlightApi } from "./FluidNavHighlightApi.jsx";
import { cn } from "../../ui/cn.js";

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
 *   sessionId: string;
 *   displayTitle: string;
 *   updatedAt: number;
 *   rowActive: boolean;
 *   to: string;
 *   measureRef: (node: HTMLElement | null) => void;
 *   onRenamed: () => void;
 *   onAfterDelete: () => void;
 *   isStreaming?: boolean;
 * }} props
 */
function HistorySessionRow({
  sessionId,
  displayTitle,
  updatedAt,
  rowActive,
  to,
  measureRef,
  onRenamed,
  onAfterDelete,
  isStreaming = false,
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const activeC = new URLSearchParams(location.search).get("c");
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
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
    <li className="chat-history-row min-w-0" aria-busy={isStreaming}>
      <div
        ref={measureRef}
        className={cn(
          "chat-history-row__measure flex min-w-0 items-stretch gap-0 py-0.5 pl-2 pr-0.5 transition-[color,filter] duration-[450ms] ease-[cubic-bezier(0.34,1.2,0.52,1)]",
          rowActive ? "chat-history-row__measure--active text-[var(--os-text)]" : "text-[var(--os-text-muted)]",
          !rowActive && "hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)]",
        )}
      >
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
        <button
          type="button"
          className={cn(
            "chat-history-card__more flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md text-[0.9375rem] font-bold leading-none text-[var(--os-text-muted)] transition-colors hover:bg-transparent hover:text-[var(--os-text)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)]",
            open &&
              "bg-[color-mix(in_srgb,var(--os-border)_22%,transparent)] text-[var(--os-text)] hover:bg-[color-mix(in_srgb,var(--os-border)_22%,transparent)]",
          )}
          ref={refs.setReference}
          aria-label={t("nav.chatHistoryMore")}
          aria-haspopup="menu"
          aria-expanded={open}
          {...getReferenceProps()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="translate-y-[-1px]" aria-hidden>
            ⋮
          </span>
        </button>
      </div>
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="chat-history-card__menu"
              {...getFloatingProps()}
            >
              <button type="button" className="chat-history-card__menu-item" onClick={handleRename}>
                <PencilIcon className="text-[var(--os-text-muted)]" />
                {t("nav.chatHistoryRename")}
              </button>
              <button
                type="button"
                className="chat-history-card__menu-item chat-history-card__menu-item--danger"
                onClick={handleDelete}
              >
                <TrashIcon className="text-[#e11d48]" />
                {t("nav.chatHistoryDelete")}
              </button>
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
  const { streamingSessionId } = useChatLabStreaming();
  const location = useLocation();
  const highlight = useContext(FluidNavHighlightApi);

  const [listVersion, setListVersion] = useState(0);
  const reload = useCallback(() => setListVersion((v) => v + 1), []);

  const scrollRootRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === null || e.key === "openstudio_chat_sessions_v1") reload();
    };
    const onCustom = () => reload();
    window.addEventListener("storage", onStorage);
    window.addEventListener("openstudio-chat-sessions-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("openstudio-chat-sessions-changed", onCustom);
    };
  }, [reload]);

  const allSessions = useMemo(() => loadAllSessions(), [listVersion, location.pathname, location.search]);

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return allSessions;
    return allSessions.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [allSessions, filterQuery]);

  const activeC = useMemo(() => {
    try {
      return new URLSearchParams(location.search).get("c");
    } catch {
      return null;
    }
  }, [location.search]);

  useLayoutEffect(() => {
    if (narrow || !highlight) return undefined;
    const root = scrollRootRef.current;
    if (!root) return undefined;
    return highlight.attachNestedScrollRoot(root);
  }, [highlight, narrow]);

  if (narrow) {
    return null;
  }

  const emptyAll = allSessions.length === 0;
  const emptyFilter = !emptyAll && filtered.length === 0;

  return (
    <div className="chat-history-rail flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden border-t border-[color-mix(in_srgb,var(--os-border)_80%,transparent)] px-0.5 pt-2.5">
      <div className="chat-history-rail__heading shrink-0 px-2 text-[0.72rem] font-semibold uppercase tracking-wide">
        {t("nav.chatHistory")}
      </div>
      <div
        ref={scrollRootRef}
        className="chat-history-rail__scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1"
      >
        {emptyAll ? (
          <EmptyState title={t("nav.chatHistoryEmpty")} hideDecoration className="min-h-[5rem] py-6" />
        ) : emptyFilter ? (
          <EmptyState title={t("nav.chatHistoryNoMatch")} hideDecoration className="min-h-[5rem] py-6" />
        ) : (
          <ul className="relative z-[1] m-0 flex list-none flex-col gap-0.5 p-0 px-1">
            {filtered.map((s) => {
              const to = `/chat?c=${encodeURIComponent(s.id)}`;
              const rowActive =
                (location.pathname === "/chat" || location.pathname === "/") && activeC === s.id;
              const displayTitle = s.title || t("nav.chatHistoryUntitled");
              return (
                <HistorySessionRow
                  key={s.id}
                  sessionId={s.id}
                  displayTitle={displayTitle}
                  updatedAt={s.updatedAt}
                  rowActive={rowActive}
                  to={to}
                  measureRef={(node) => highlight?.registerSessionAnchor(s.id, node)}
                  onRenamed={reload}
                  onAfterDelete={reload}
                  isStreaming={streamingSessionId === s.id}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
