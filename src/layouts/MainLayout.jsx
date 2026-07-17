import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { Outlet } from "react-router-dom";
import { Compass, MessageSquarePlus, Puzzle, Timer, Users } from "lucide-react";
import SidebarToggleIcon from "../assets/svg/SidebarToggleIcon.jsx";
import TitleBar from "../components/chrome/TitleBar.jsx";
import ChatHistoryList from "../components/shell/ChatHistoryList.jsx";
import { useWechatAutoReplyStream } from "../chat/useWechatAutoReplyStream.js";
import { useWechatSessionSync } from "../chat/useWechatSessionSync.js";
import PrimaryRailMenu from "../components/shell/PrimaryRailMenu.jsx";
import RailSettingsLink from "../components/shell/RailSettingsLink.jsx";
import NavIcon from "../ui/NavIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import ResizableEdge from "../ui/ResizableEdge.jsx";
import { cn } from "../ui/cn.js";

const SIDEBAR_LEGACY_KEY = "openstudio_sidebar_collapsed";
const RAIL_LEGACY_KEY = "openstudio_rail_width";
const RAIL_STORAGE_KEY = "openstudio_primary_rail_px";
const RAIL_LAST_EXPANDED_KEY = "openstudio_rail_last_expanded";

const RAIL_COLLAPSED = 82;
const RAIL_MIN = 208;
const RAIL_MAX = 360;
const RAIL_DEFAULT = 268;
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
  const { t } = useI18n();
  const primaryNavItems = useMemo(
    () => [
      {
        id: "new-chat",
        to: "/chat",
        end: true,
        label: t("nav.newChat"),
        icon: <NavIcon icon={MessageSquarePlus} />,
        isActive: (loc) =>
          (loc.pathname === "/chat" || loc.pathname === "/") &&
          !new URLSearchParams(loc.search).get("c"),
      },
      {
        id: "lobster",
        to: "/lobster",
        label: t("nav.lobster"),
        icon: <NavIcon icon={Users} />,
      },
      {
        id: "skills",
        to: "/skills",
        label: t("nav.skills"),
        icon: <NavIcon icon={Puzzle} />,
      },
      {
        id: "automation",
        to: "/automation",
        label: t("nav.automation"),
        icon: <NavIcon icon={Timer} />,
      },
      {
        id: "web-explore",
        to: "/explore",
        label: t("nav.webExplore"),
        icon: <NavIcon icon={Compass} />,
      },
    ],
    [t],
  );

  const lastExpandedRef = useRef(readLastExpanded());
  const [railPx, setRailPx] = useState(readRailPx);
  const [railDragging, setRailDragging] = useState(false);

  const isNarrow = railPx < RAIL_MIN;
  useWechatSessionSync();
  useWechatAutoReplyStream();

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

  useEffect(() => {
    document.documentElement.style.setProperty("--os-primary-rail-px", `${railPx}px`);
    return () => document.documentElement.style.removeProperty("--os-primary-rail-px");
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
      <div className={cn("app-frame", "app-frame--rail-split")}>
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

          <div className="primary-rail__nav-column">
            <PrimaryRailMenu collapsed={isNarrow} items={primaryNavItems} />
            <ChatHistoryList narrow={isNarrow} />
            <div className="primary-rail__footer">
              <RailSettingsLink narrow={isNarrow} />
            </div>
          </div>
        </aside>

        <Button
          type="button"
          variant="text"
          shape="square"
          size="small"
          className={cn("rail-edge-toggle", railDragging && "rail-edge-toggle--dragging")}
          style={{
            left: railPx,
          }}
          onClick={toggle}
          title={isNarrow ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          aria-expanded={!isNarrow}
          aria-label={isNarrow ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
        >
          <SidebarToggleIcon collapsed={isNarrow} className="pointer-events-none text-current" />
        </Button>

        <div className="app-frame__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
