import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { Outlet, useLocation } from "react-router-dom";
import { Compass, GitBranch, MessageSquarePlus, Puzzle, Timer, Users } from "lucide-react";
import SidebarToggleIcon from "../assets/svg/SidebarToggleIcon.jsx";
import TitleBar from "../components/chrome/TitleBar.jsx";
import ChatHistoryList from "../components/shell/ChatHistoryList.jsx";
import { useWechatAutoReplyStream } from "../chat/useWechatAutoReplyStream.js";
import { useAutomationChatStream } from "../chat/useAutomationChatStream.js";
import { useWechatSessionSync } from "../chat/useWechatSessionSync.js";
import PrimaryRailMenu from "../components/shell/PrimaryRailMenu.jsx";
import RailSettingsLink from "../components/shell/RailSettingsLink.jsx";
import NavIcon from "../ui/NavIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import ResizableEdge from "../ui/ResizableEdge.jsx";
import { cn } from "../ui/cn.js";

const RAIL_COLLAPSED = 64;
const RAIL_MIN = 208;
const RAIL_MAX = 360;
const RAIL_DEFAULT = 268;
/** Release width &lt; this → snap to narrow ({@link RAIL_COLLAPSED}); otherwise snap to ≥ {@link RAIL_MIN} */
const SNAP_NARROW = 112;
/** Must match `.primary-rail` width transition in index.css */
const RAIL_WIDTH_TRANSITION_MS = 260;

function clampExpanded(n) {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, n));
}

function finalizeRailWidth(w) {
  if (w < SNAP_NARROW) return RAIL_COLLAPSED;
  return clampExpanded(w);
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
        id: "workflow",
        to: "/workflow",
        label: t("nav.workflow"),
        icon: <NavIcon icon={GitBranch} />,
        badge: "Lab",
      },
      {
        id: "web-explore",
        to: "/explore",
        label: t("nav.webExplore"),
        icon: <NavIcon icon={Compass} />,
        badge: "New",
        badgeTheme: "primary",
      },
    ],
    [t],
  );

  const location = useLocation();
  const lastExpandedRef = useRef(RAIL_DEFAULT);
  const railTransitionTimerRef = useRef(/** @type {number | null} */ (null));
  const railPxRef = useRef(RAIL_DEFAULT);
  const previousPathRef = useRef(location.pathname);
  const [railPx, setRailPx] = useState(RAIL_DEFAULT);
  const [railDragging, setRailDragging] = useState(false);
  const [railTransitioning, setRailTransitioning] = useState(false);

  railPxRef.current = railPx;
  const isNarrow = railPx < RAIL_MIN;
  useWechatSessionSync();
  useWechatAutoReplyStream();
  useAutomationChatStream();

  useEffect(() => {
    document.documentElement.style.setProperty("--os-primary-rail-px", `${railPx}px`);
    return () => document.documentElement.style.removeProperty("--os-primary-rail-px");
  }, [railPx]);

  useEffect(() => {
    if (railDragging) setRailTransitioning(false);
  }, [railDragging]);

  useEffect(
    () => () => {
      if (railTransitionTimerRef.current != null) {
        window.clearTimeout(railTransitionTimerRef.current);
        railTransitionTimerRef.current = null;
      }
    },
    [],
  );

  const startRailTransition = useCallback(() => {
    setRailTransitioning(true);
    if (railTransitionTimerRef.current != null) {
      window.clearTimeout(railTransitionTimerRef.current);
    }
    railTransitionTimerRef.current = window.setTimeout(() => {
      railTransitionTimerRef.current = null;
      setRailTransitioning(false);
    }, 360);
  }, []);

  // 拖动结束后不需要触发过渡动画，因为宽度变化是用户主动完成的
  // railTransitioning 只在点击按钮切换时触发
  const onRailCommit = useCallback((w) => {
    const next = finalizeRailWidth(w);
    if (next >= RAIL_MIN) lastExpandedRef.current = next;
    railPxRef.current = next;
    setRailPx(next);
  }, []);

  /** Collapses the primary rail; resolves after the width transition settles (or immediately if already narrow). */
  const collapsePrimaryRail = useCallback(() => {
    const current = railPxRef.current;
    if (current < RAIL_MIN) return Promise.resolve();
    lastExpandedRef.current = clampExpanded(current);
    railPxRef.current = RAIL_COLLAPSED;
    setRailPx(RAIL_COLLAPSED);
    startRailTransition();
    return new Promise((resolve) => {
      window.setTimeout(() => {
        requestAnimationFrame(() => resolve());
      }, RAIL_WIDTH_TRANSITION_MS);
    });
  }, [startRailTransition]);

  /** Expands the primary rail to its last expanded width. */
  const expandPrimaryRail = useCallback(() => {
    if (railPxRef.current >= RAIL_MIN) return Promise.resolve();
    const expanded = clampExpanded(lastExpandedRef.current || RAIL_DEFAULT);
    railPxRef.current = expanded;
    setRailPx(expanded);
    startRailTransition();
    return new Promise((resolve) => {
      window.setTimeout(() => {
        requestAnimationFrame(() => resolve());
      }, RAIL_WIDTH_TRANSITION_MS);
    });
  }, [startRailTransition]);

  // 点击按钮切换时触发过渡动画
  const handleToggleClick = useCallback(() => {
    startRailTransition();
    setRailPx((w) => {
      if (w < RAIL_MIN) {
        const expanded = Math.max(RAIL_MIN, lastExpandedRef.current || RAIL_DEFAULT);
        railPxRef.current = expanded;
        return expanded;
      }
      lastExpandedRef.current = clampExpanded(w);
      railPxRef.current = RAIL_COLLAPSED;
      return RAIL_COLLAPSED;
    });
  }, [startRailTransition]);

  useEffect(() => {
    const wasExplore = previousPathRef.current === "/explore";
    if (wasExplore && location.pathname !== "/explore") {
      void expandPrimaryRail();
    }
    previousPathRef.current = location.pathname;
  }, [expandPrimaryRail, location.pathname]);

  const outletContext = useMemo(
    () => ({ collapsePrimaryRail, expandPrimaryRail }),
    [collapsePrimaryRail, expandPrimaryRail],
  );

  const handleRailTransitionEnd = useCallback((e) => {
    if (e.propertyName !== "width") return;
    if (railTransitionTimerRef.current != null) {
      window.clearTimeout(railTransitionTimerRef.current);
      railTransitionTimerRef.current = null;
    }
    setRailTransitioning(false);
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
            railTransitioning && "primary-rail--transitioning",
          )}
          style={{ width: railPx }}
          aria-label={t("nav.primaryAria")}
          onTransitionEnd={handleRailTransitionEnd}
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
            <ChatHistoryList narrow={isNarrow || railTransitioning} />
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
          onClick={handleToggleClick}
          title={isNarrow ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          aria-expanded={!isNarrow}
          aria-label={isNarrow ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
        >
          <SidebarToggleIcon collapsed={isNarrow} className="pointer-events-none text-current" />
        </Button>

        <div className="app-frame__content">
          <Outlet context={outletContext} />
        </div>
      </div>
    </div>
  );
}
