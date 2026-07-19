import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import heroAvatarLight from "../../assets/images/hero-avatar-light.png";
import heroAvatarDark from "../../assets/images/hero-avatar-dark.png";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { cn } from "../../ui/cn.js";
import ChatLabEmbedConversation from "./ChatLabEmbedConversation.jsx";

const POS_STORAGE_KEY = "openstudio_web_explore_chat_float_pos_v2";
const SIZE_STORAGE_KEY = "openstudio_web_explore_chat_float_size_v1";
const OPEN_STORAGE_KEY = "openstudio_web_explore_chat_float_open_v1";
const LAUNCHER_W = 48;
const LAUNCHER_H = 48;
const DEFAULT_W = 440;
const DEFAULT_H = 560;
const MIN_W = 340;
const MIN_H = 420;
const MAX_W = 760;
const MIN_X = 12;
const MIN_Y = 12;
const VIEWPORT_GAP = 12;
const DRAG_THRESHOLD_PX = 6;

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Default dock: bottom-right of the viewport for the current chrome size.
 * @param {boolean} isOpen
 * @param {{ w: number; h: number }} panelSize
 * @param {number} viewW
 * @param {number} viewH
 */
function defaultDockPos(isOpen, panelSize, viewW, viewH) {
  const width = isOpen ? panelSize.w : LAUNCHER_W;
  const height = isOpen ? panelSize.h : LAUNCHER_H;
  return {
    x: Math.max(MIN_X, viewW - width - VIEWPORT_GAP),
    y: Math.max(MIN_Y, viewH - height - VIEWPORT_GAP),
  };
}

/**
 * Keep the bottom-right corner fixed while switching launcher ↔ panel.
 * @param {{ x: number; y: number }} pos
 * @param {boolean} nextOpen
 * @param {{ w: number; h: number }} panelSize
 * @param {number} viewW
 * @param {number} viewH
 */
function posForOpenChange(pos, nextOpen, panelSize, viewW, viewH) {
  const pw = panelSize.w;
  const ph = panelSize.h;
  const next = nextOpen
    ? { x: pos.x + LAUNCHER_W - pw, y: pos.y + LAUNCHER_H - ph }
    : { x: pos.x + pw - LAUNCHER_W, y: pos.y + ph - LAUNCHER_H };
  const width = nextOpen ? pw : LAUNCHER_W;
  const height = nextOpen ? ph : LAUNCHER_H;
  const maxX = Math.max(MIN_X, viewW - width - VIEWPORT_GAP);
  const maxY = Math.max(MIN_Y, viewH - height - VIEWPORT_GAP);
  return {
    x: clamp(next.x, MIN_X, maxX),
    y: clamp(next.y, MIN_Y, maxY),
  };
}

/** @returns {{ x: number; y: number } | null} */
function readStoredPos() {
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Number(parsed.x), y: Number(parsed.y) };
  } catch {
    return null;
  }
}

/** @param {{ x: number; y: number }} pos */
function writeStoredPos(pos) {
  try {
    window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

/** @returns {{ w: number; h: number } | null} */
function readStoredSize() {
  try {
    const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.w) || !Number.isFinite(parsed.h)) return null;
    return {
      w: clamp(Number(parsed.w), MIN_W, MAX_W),
      h: clamp(Number(parsed.h), MIN_H, window.innerHeight - 48),
    };
  } catch {
    return null;
  }
}

/** @param {{ w: number; h: number }} size */
function writeStoredSize(size) {
  try {
    window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
}

/** @returns {boolean} */
function readStoredOpen() {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} open */
function writeStoredOpen(open) {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * @param {{
 *   activeUrl: string;
 *   pageTitle: string;
 *   inElectron: boolean;
 *   boundaryRef?: import("react").RefObject<HTMLElement | null>;
 *   webviewRef: import("react").RefObject<HTMLElement | null>;
 *   iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *   onNavigate: (url: string) => void;
 * }} props
 */
export default function WebExploreChatFloat({
  activeUrl,
  pageTitle,
  inElectron,
  boundaryRef,
  webviewRef,
  iframeRef,
  onNavigate,
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [open, setOpen] = useState(() => readStoredOpen());
  const [panelSize, setPanelSize] = useState(() => readStoredSize() ?? { w: DEFAULT_W, h: DEFAULT_H });
  const [boundsRect, setBoundsRect] = useState(() => ({
    left: 0,
    top: 0,
    width: Math.max(window.innerWidth, MIN_W + VIEWPORT_GAP * 2),
    height: Math.max(window.innerHeight, MIN_H + VIEWPORT_GAP * 2),
  }));
  const [pos, setPos] = useState(() => {
    const stored = readStoredPos();
    const initiallyOpen = readStoredOpen();
    const vw = Math.max(window.innerWidth, MIN_W + VIEWPORT_GAP * 2);
    const vh = Math.max(window.innerHeight, MIN_H + VIEWPORT_GAP * 2);
    const size = readStoredSize() ?? { w: DEFAULT_W, h: DEFAULT_H };
    if (stored) return stored;
    return defaultDockPos(initiallyOpen, size, vw, vh);
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState(
    /** @type {"n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw"} */ ("se"),
  );
  const suppressLauncherClickUntilRef = useRef(0);
  const posRef = useRef(pos);
  posRef.current = pos;
  const panelSizeRef = useRef(panelSize);
  panelSizeRef.current = panelSize;
  const openRef = useRef(open);
  openRef.current = open;
  const boundsRectRef = useRef(boundsRect);
  boundsRectRef.current = boundsRect;
  const dragRef = useRef(
    /** @type {{ active: boolean; moved: boolean; pointerId: number; startX: number; startY: number; baseX: number; baseY: number }} */ ({
      active: false,
      moved: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      baseX: 0,
      baseY: 0,
    }),
  );
  const resizeRef = useRef(
    /** @type {{ active: boolean; direction: "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw"; pointerId: number; startX: number; startY: number; baseX: number; baseY: number; baseW: number; baseH: number }} */ ({
      active: false,
      direction: "se",
      pointerId: -1,
      startX: 0,
      startY: 0,
      baseX: 0,
      baseY: 0,
      baseW: DEFAULT_W,
      baseH: DEFAULT_H,
    }),
  );

  useEffect(() => {
    const target = boundaryRef?.current;
    if (!target) return undefined;
    const syncBounds = () => {
      const rect = target.getBoundingClientRect();
      setBoundsRect({
        left: rect.left,
        top: rect.top,
        width: Math.max(rect.width, MIN_W + VIEWPORT_GAP * 2),
        height: Math.max(rect.height, MIN_H + VIEWPORT_GAP * 2),
      });
    };
    syncBounds();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncBounds) : null;
    ro?.observe(target);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);
    };
  }, [boundaryRef]);

  useEffect(() => {
    writeStoredOpen(open);
  }, [open]);

  useEffect(() => {
    const clampIntoViewport = () => {
      const viewW = boundsRect.width;
      const viewH = boundsRect.height;
      const width = open ? panelSizeRef.current.w : LAUNCHER_W;
      const height = open ? panelSizeRef.current.h : LAUNCHER_H;
      const maxWAvail = Math.max(120, viewW - VIEWPORT_GAP * 2);
      const maxHAvail = Math.max(120, viewH - VIEWPORT_GAP * 2);
      const boundedWidth = Math.min(width, maxWAvail);
      const boundedHeight = Math.min(height, maxHAvail);
      const maxX = Math.max(MIN_X, viewW - boundedWidth - VIEWPORT_GAP);
      const maxY = Math.max(MIN_Y, viewH - boundedHeight - VIEWPORT_GAP);
      setPos((prev) => {
        const next = {
          x: clamp(prev.x, MIN_X, maxX),
          y: clamp(prev.y, MIN_Y, maxY),
        };
        writeStoredPos(next);
        return next;
      });
      setPanelSize((prev) => {
        const maxW = Math.max(120, viewW - VIEWPORT_GAP * 2);
        const maxH = Math.max(120, viewH - VIEWPORT_GAP * 2);
        const minW = Math.min(MIN_W, maxW);
        const minH = Math.min(MIN_H, maxH);
        const next = {
          w: clamp(prev.w, minW, Math.min(MAX_W, maxW)),
          h: clamp(prev.h, minH, maxH),
        };
        writeStoredSize(next);
        return next;
      });
    };
    clampIntoViewport();
  }, [boundsRect.height, boundsRect.width, open]);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      if (d.pointerId >= 0 && e.pointerId !== d.pointerId) return;
      const width = open ? panelSizeRef.current.w : LAUNCHER_W;
      const height = open ? panelSizeRef.current.h : LAUNCHER_H;
      const maxX = Math.max(MIN_X, boundsRect.width - width - VIEWPORT_GAP);
      const maxY = Math.max(MIN_Y, boundsRect.height - height - VIEWPORT_GAP);
      const nx = clamp(d.baseX + (e.clientX - d.startX), MIN_X, maxX);
      const ny = clamp(d.baseY + (e.clientY - d.startY), MIN_Y, maxY);
      if (!d.moved && Math.hypot(nx - d.baseX, ny - d.baseY) >= DRAG_THRESHOLD_PX) {
        d.moved = true;
      }
      setPos({ x: nx, y: ny });
    };
    const onUp = (e) => {
      const d = dragRef.current;
      if (d.pointerId >= 0 && e.pointerId !== d.pointerId) return;
      dragRef.current.active = false;
      dragRef.current.pointerId = -1;
      setDragging(false);
      writeStoredPos(posRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [boundsRect.height, boundsRect.width, dragging, open]);

  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (e) => {
      const r = resizeRef.current;
      if (!r.active) return;
      if (r.pointerId >= 0 && e.pointerId !== r.pointerId) return;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;
      const maxRight = boundsRect.width - VIEWPORT_GAP;
      const maxBottom = boundsRect.height - VIEWPORT_GAP;
      const baseRight = r.baseX + r.baseW;
      const baseBottom = r.baseY + r.baseH;

      let nextX = r.baseX;
      let nextY = r.baseY;
      let nextW = r.baseW;
      let nextH = r.baseH;
      const usesEast = r.direction === "e" || r.direction === "ne" || r.direction === "se";
      const usesWest = r.direction === "w" || r.direction === "nw" || r.direction === "sw";
      const usesSouth = r.direction === "s" || r.direction === "se" || r.direction === "sw";
      const usesNorth = r.direction === "n" || r.direction === "ne" || r.direction === "nw";
      const maxWAvail = Math.max(120, maxRight - r.baseX);
      const maxHAvail = Math.max(120, maxBottom - r.baseY);
      const minWLocal = Math.min(MIN_W, maxWAvail);
      const minHLocal = Math.min(MIN_H, maxHAvail);

      if (usesEast) {
        nextW = clamp(r.baseW + dx, minWLocal, Math.min(MAX_W, maxWAvail));
      }
      if (usesWest) {
        const maxWFromAnchor = Math.max(120, Math.min(MAX_W, baseRight - MIN_X));
        const minWFromAnchor = Math.min(MIN_W, maxWFromAnchor);
        nextW = clamp(r.baseW - dx, minWFromAnchor, maxWFromAnchor);
        nextX = baseRight - nextW;
      }
      if (usesSouth) {
        nextH = clamp(r.baseH + dy, minHLocal, maxHAvail);
      }
      if (usesNorth) {
        const maxHFromAnchor = Math.max(120, baseBottom - MIN_Y);
        const minHFromAnchor = Math.min(MIN_H, maxHFromAnchor);
        nextH = clamp(r.baseH - dy, minHFromAnchor, maxHFromAnchor);
        nextY = baseBottom - nextH;
      }

      setPos({ x: nextX, y: nextY });
      setPanelSize({ w: nextW, h: nextH });
    };
    const onUp = (e) => {
      const r = resizeRef.current;
      if (r.pointerId >= 0 && e.pointerId !== r.pointerId) return;
      resizeRef.current.active = false;
      resizeRef.current.pointerId = -1;
      setResizing(false);
      writeStoredPos(posRef.current);
      writeStoredSize(panelSizeRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [boundsRect.height, boundsRect.width, resizing]);

  /** @param {React.PointerEvent<HTMLElement>} e */
  const startDrag = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
    setDragging(true);
  };

  /**
   * @param {"n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw"} direction
   * @param {React.PointerEvent<HTMLElement>} e
   */
  const startResize = (direction, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    resizeRef.current = {
      active: true,
      direction,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
      baseW: panelSize.w,
      baseH: panelSize.h,
    };
    setResizeDirection(direction);
    setResizing(true);
  };

  /** Expand/collapse while keeping the bottom-right corner anchored. */
  const setOpenAnchored = useCallback((nextOpen) => {
    const next = Boolean(nextOpen);
    if (openRef.current === next) return;
    const anchored = posForOpenChange(
      posRef.current,
      next,
      panelSizeRef.current,
      boundsRectRef.current.width,
      boundsRectRef.current.height,
    );
    setPos(anchored);
    writeStoredPos(anchored);
    if (!next) suppressLauncherClickUntilRef.current = Date.now() + 260;
    setOpen(next);
  }, []);

  const toggleFloatOpen = useCallback(() => {
    setOpenAnchored(!openRef.current);
  }, [setOpenAnchored]);

  const openWidth = open ? panelSize.w : LAUNCHER_W;

  return (
    <div
      className={cn(
        "web-explore-chat-float",
        open && "web-explore-chat-float--open",
        dragging && "web-explore-chat-float--dragging",
        resizing && "web-explore-chat-float--resizing",
      )}
      style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${openWidth}px` }}
    >
      {!open ? (
        <Button
          type="button"
          variant="text"
          size="small"
          className={cn(
            "web-explore-chat-float__launcher",
            dragging && "web-explore-chat-float__launcher--dragging",
          )}
          onPointerDown={startDrag}
          onClick={() => {
            if (dragRef.current.moved) return;
            if (Date.now() < suppressLauncherClickUntilRef.current) return;
            setOpenAnchored(true);
          }}
          title={t("webExploreChat.launcher")}
          aria-label={t("webExploreChat.launcher")}
        >
          <img
            className="web-explore-chat-float__launcher-icon"
            src={theme === "dark" ? heroAvatarDark : heroAvatarLight}
            alt=""
            draggable={false}
            aria-hidden
          />
        </Button>
      ) : null}

      <section
        className={cn("web-explore-chat-float__panel", !open && "web-explore-chat-float__panel--hidden")}
        style={{ width: `${panelSize.w}px`, height: `${panelSize.h}px` }}
        aria-label={t("webExploreChat.title")}
        aria-hidden={!open}
      >
        <div className="web-explore-chat-float__embed">
          <ChatLabEmbedConversation
            activeUrl={activeUrl}
            pageTitle={pageTitle}
            inElectron={inElectron}
            webviewRef={webviewRef}
            iframeRef={iframeRef}
            onNavigate={onNavigate}
            floatOpen={open}
            onToggleFloatOpen={toggleFloatOpen}
            onStartFloatDrag={startDrag}
            className="chat-lab--web-explore-embed"
          />
        </div>

        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--n"
          onPointerDown={(e) => startResize("n", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--e"
          onPointerDown={(e) => startResize("e", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--s"
          onPointerDown={(e) => startResize("s", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--w"
          onPointerDown={(e) => startResize("w", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--nw"
          onPointerDown={(e) => startResize("nw", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--ne"
          onPointerDown={(e) => startResize("ne", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--sw"
          onPointerDown={(e) => startResize("sw", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
        <button
          type="button"
          className="web-explore-chat-float__resize-handle web-explore-chat-float__resize-handle--se"
          onPointerDown={(e) => startResize("se", e)}
          aria-label={t("webExploreChat.resizeHandle")}
          tabIndex={open ? 0 : -1}
        />
      </section>
      {dragging || resizing ? (
        <div
          className={cn(
            "web-explore-chat-float__drag-overlay",
            resizing && "web-explore-chat-float__drag-overlay--resizing",
            resizing && `web-explore-chat-float__drag-overlay--resize-${resizeDirection}`,
          )}
          style={{
            left: `${boundsRect.left}px`,
            top: `${boundsRect.top}px`,
            width: `${boundsRect.width}px`,
            height: `${boundsRect.height}px`,
          }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
