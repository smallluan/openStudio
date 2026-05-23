import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import NavSettingsIcon from "../../assets/svg/NavSettingsIcon.jsx";
import SearchSparkleIcon from "../../assets/svg/SearchSparkleIcon.jsx";
import { useNavigate } from "react-router-dom";

export default function ChatLabTopPullPanel({ expanded, onToggle }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const searchAnchorRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const searchFieldRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchOrigin, setSearchOrigin] = useState({ top: 0, left: 0 });

  const updateSearchOrigin = useCallback(() => {
    const node = searchAnchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setSearchOrigin({
      top: Math.round(rect.top),
      left: Math.round(rect.left),
    });
  }, []);

  const openSearch = useCallback(() => {
    updateSearchOrigin();
    setSearchExpanded(true);
  }, [updateSearchOrigin]);

  const closeSearch = useCallback(() => {
    updateSearchOrigin();
    setSearchExpanded(false);
  }, [updateSearchOrigin]);

  const toggleSearch = useCallback(() => {
    if (searchExpanded) {
      closeSearch();
      return;
    }
    openSearch();
  }, [closeSearch, openSearch, searchExpanded]);

  useLayoutEffect(() => {
    updateSearchOrigin();
  }, [updateSearchOrigin]);

  useEffect(() => {
    const onResize = () => updateSearchOrigin();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateSearchOrigin]);

  useEffect(() => {
    updateSearchOrigin();
    const t1 = window.setTimeout(updateSearchOrigin, 90);
    const t2 = window.setTimeout(updateSearchOrigin, 190);
    const t3 = window.setTimeout(updateSearchOrigin, 320);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [expanded, updateSearchOrigin]);

  useEffect(() => {
    const onScroll = () => updateSearchOrigin();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [updateSearchOrigin]);

  useEffect(() => {
    if (!searchExpanded) return;
    const timer = window.setTimeout(() => searchFieldRef.current?.focus(), 170);
    return () => window.clearTimeout(timer);
  }, [searchExpanded]);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "f" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (key === "escape" && searchExpanded) {
        e.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, openSearch, searchExpanded]);

  const onSearchSubmit = useCallback(
    /** @param {import("react").FormEvent<HTMLFormElement>} e */
    (e) => {
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent("openstudio:global-search", {
          detail: { query: searchValue.trim() },
        }),
      );
    },
    [searchValue],
  );

  const entries = [
    {
      id: "settings",
      icon: <NavSettingsIcon className="w-full h-full" />,
      label: t("nav.settings"),
      onClick: () => {
        navigate("/settings");
        onToggle?.();
      },
    },
    {
      id: "profile",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      ),
      label: t("nav.profile"),
      onClick: () => onToggle?.(),
    },
    {
      id: "help",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 9a3 3 0 1 1 6 0c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
      label: t("nav.help"),
      onClick: () => onToggle?.(),
    },
  ];

  return (
    <div className="chat-lab-top-pull">
      {/* 下拉面板 - 宽度占满 */}
      <div
        className={cn(
          "chat-lab-top-pull__panel",
          "transition-all duration-300 ease-out",
          expanded && "chat-lab-top-pull__panel--expanded"
        )}
        aria-hidden={!expanded}
      >
        <div className="chat-lab-top-pull__panel-inner">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="chat-lab-top-pull__entry"
              onClick={entry.onClick}
            >
              <span className="chat-lab-top-pull__entry-icon">
                {entry.icon}
              </span>
              <span className="chat-lab-top-pull__entry-label">
                {entry.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 垂直线 + 圆形 */}
      <div className="chat-lab-top-pull__wire-orb">
        {/* 垂直线 */}
        <div className="chat-lab-top-pull__wire" />

        <div className="chat-lab-top-pull__orb-stack">
          <div
            ref={searchAnchorRef}
            className={cn(
              "chat-lab-top-pull__search-anchor",
              searchExpanded && "chat-lab-top-pull__search-anchor--expanded",
            )}
            aria-hidden
          />
          <div
            className={cn(
              "chat-lab-top-pull__orb-link chat-lab-top-pull__orb-link--heal",
              !searchExpanded && "chat-lab-top-pull__orb-link--heal-cut",
            )}
            aria-hidden
          />

          <div className="chat-lab-top-pull__orb-link" aria-hidden />

          {/* 圆形按钮 */}
          <button
            type="button"
            className="chat-lab-top-pull__orb"
            onClick={onToggle}
            aria-label={expanded ? t("nav.closePanel") : t("nav.openPanel")}
            aria-expanded={expanded}
          >
            <svg
              className="chat-lab-top-pull__orb-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
        </div>
      </div>

      <form
        className={cn(
          "chat-lab-top-pull__search-flyout",
          searchExpanded && "chat-lab-top-pull__search-flyout--expanded",
        )}
        onSubmit={onSearchSubmit}
        style={
          {
            "--search-origin-top": `${searchOrigin.top}px`,
            "--search-origin-left": `${searchOrigin.left}px`,
          } /** @type {import("react").CSSProperties} */
        }
      >
        <button
          type="button"
          className="chat-lab-top-pull__orb chat-lab-top-pull__orb--search"
          title={t("nav.railSearchPlaceholder")}
          aria-label={t("nav.railSearchPlaceholder")}
          aria-expanded={searchExpanded}
          onClick={toggleSearch}
        >
          <SearchSparkleIcon className="chat-lab-top-pull__orb-icon" />
        </button>
        <div className="chat-lab-top-pull__search-shell">
          <input
            ref={searchFieldRef}
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("nav.railSearchPlaceholder")}
            className="chat-lab-top-pull__search-field"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </form>
    </div>
  );
}
