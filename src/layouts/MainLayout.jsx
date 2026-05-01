import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import LogoMarkIcon from "../assets/svg/LogoMarkIcon.jsx";
import NavChatLabIcon from "../assets/svg/NavChatLabIcon.jsx";
import NavLobsterIcon from "../assets/svg/NavLobsterIcon.jsx";
import NavSettingsIcon from "../assets/svg/NavSettingsIcon.jsx";
import NavStudioIcon from "../assets/svg/NavStudioIcon.jsx";
import SidebarToggleIcon from "../assets/svg/SidebarToggleIcon.jsx";
import TitleBar from "../components/chrome/TitleBar.jsx";
import FluidNavMenu from "../components/shell/FluidNavMenu.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import ResizableEdge from "../ui/ResizableEdge.jsx";
import { cn } from "../ui/cn.js";

const SIDEBAR_LEGACY_KEY = "openstudio_sidebar_collapsed";
const RAIL_LEGACY_KEY = "openstudio_rail_width";
const RAIL_STORAGE_KEY = "openstudio_primary_rail_px";
const RAIL_LAST_EXPANDED_KEY = "openstudio_rail_last_expanded";

const RAIL_COLLAPSED = 82;
const RAIL_MIN = 176;
const RAIL_MAX = 360;
const RAIL_DEFAULT = 208;
/** Release width &lt; this → snap to narrow ({@link RAIL_COLLAPSED}); otherwise snap to ≥ {@link RAIL_MIN} */
const SNAP_NARROW = 124;

function clampExpanded(n) {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, n));
}

function finalizeRailWidth(w) {
  if (w < SNAP_NARROW) return RAIL_COLLAPSED;
  return clampExpanded(w);
}

function readLastExpanded() {
  try {
    const n = Number(window.localStorage.getItem(RAIL_LAST_EXPANDED_KEY));
    if (Number.isFinite(n)) return clampExpanded(n);
  } catch {
    /* ignore */
  }
  return RAIL_DEFAULT;
}

function readRailPx() {
  try {
    const raw = window.localStorage.getItem(RAIL_STORAGE_KEY);
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        if (n <= RAIL_COLLAPSED + 4) return RAIL_COLLAPSED;
        return clampExpanded(n);
      }
    }
    if (window.localStorage.getItem(SIDEBAR_LEGACY_KEY) === "1") return RAIL_COLLAPSED;
    const legacyW = Number(window.localStorage.getItem(RAIL_LEGACY_KEY));
    if (Number.isFinite(legacyW)) return clampExpanded(legacyW);
  } catch {
    /* ignore */
  }
  return RAIL_DEFAULT;
}

export default function MainLayout({ railResizeEnabled = false }) {
  const location = useLocation();
  const { t } = useI18n();
  const settingsBackground = useMemo(() => ({ backgroundLocation: location }), [location]);

  const primaryNavItems = useMemo(
    () => [
      {
        id: "studio",
        to: "/",
        end: true,
        label: t("nav.studio"),
        icon: <NavStudioIcon className="fluid-nav__glyph h-[22px] w-[22px]" />,
      },
      {
        id: "chat-lab",
        to: "/chat",
        label: t("nav.chatLab"),
        icon: <NavChatLabIcon className="fluid-nav__glyph h-[22px] w-[22px]" />,
      },
      {
        id: "lobster",
        to: "/lobster",
        label: t("nav.lobster"),
        icon: <NavLobsterIcon className="fluid-nav__glyph h-[22px] w-[22px]" />,
      },
    ],
    [t],
  );

  const footerNavItems = useMemo(
    () => [
      {
        id: "settings",
        to: "/settings",
        end: true,
        label: t("nav.settings"),
        state: settingsBackground,
        icon: <NavSettingsIcon className="fluid-nav__glyph h-[22px] w-[22px]" />,
      },
    ],
    [settingsBackground, t],
  );

  const lastExpandedRef = useRef(readLastExpanded());
  const [railPx, setRailPx] = useState(readRailPx);
  const [railDragging, setRailDragging] = useState(false);

  const isNarrow = railPx < RAIL_MIN;

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, String(railPx));
      if (railPx >= RAIL_MIN) {
        lastExpandedRef.current = railPx;
        window.localStorage.setItem(RAIL_LAST_EXPANDED_KEY, String(railPx));
      }
    } catch {
      /* ignore */
    }
  }, [railPx]);

  const toggle = useCallback(() => {
    setRailPx((w) => {
      if (w < RAIL_MIN) {
        return Math.max(RAIL_MIN, lastExpandedRef.current || RAIL_DEFAULT);
      }
      lastExpandedRef.current = clampExpanded(w);
      try {
        window.localStorage.setItem(RAIL_LAST_EXPANDED_KEY, String(lastExpandedRef.current));
      } catch {
        /* ignore */
      }
      return RAIL_COLLAPSED;
    });
  }, []);

  const onRailCommit = useCallback((w) => {
    setRailPx(finalizeRailWidth(w));
  }, []);

  return (
    <div className="os-chrome">
      <TitleBar />
      <div className="app-frame">
        <aside
          className={cn(
            "primary-rail",
            isNarrow && "primary-rail--narrow",
            railDragging && "primary-rail--dragging",
          )}
          style={{ width: railPx }}
          aria-label={t("nav.primaryAria")}
        >
          {railResizeEnabled ? (
            <ResizableEdge
              side="right"
              value={railPx}
              min={RAIL_COLLAPSED}
              max={RAIL_MAX}
              onChange={setRailPx}
              onCommit={onRailCommit}
              onActiveChange={setRailDragging}
            />
          ) : null}

          <div className="primary-rail__top primary-rail__top--grow">
            <div className={cn("primary-rail__header-row", isNarrow && "primary-rail__header-row--narrow")}>
              <div className="primary-rail__mark">
                <LogoMarkIcon
                  className={cn("shrink-0 text-[var(--os-text)]", isNarrow ? "h-6 w-6" : "h-8 w-8")}
                />
                {!isNarrow ? (
                  <span className="ml-2 min-w-0 truncate text-[0.7rem] font-bold tracking-tight text-[var(--os-text-muted)]">
                    OpenStudio
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="primary-rail__pin-btn"
                onClick={toggle}
                title={isNarrow ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
                aria-expanded={!isNarrow}
              >
                <SidebarToggleIcon collapsed={isNarrow} className="text-current" />
              </button>
            </div>

            <FluidNavMenu
              narrow={isNarrow}
              router
              primaryItems={primaryNavItems}
              footerItems={footerNavItems}
              className="flex-1 min-h-0 pb-1"
            />
          </div>
        </aside>

        <div className="app-frame__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
