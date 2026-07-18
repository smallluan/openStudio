import { useEffect, useRef, useState } from "react";
import { GripVertical, MessageSquare, Minimize2 } from "lucide-react";
import { Button } from "@open-studio/udesign";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";
import ChatLabEmbedConversation from "./ChatLabEmbedConversation.jsx";

const POS_STORAGE_KEY = "openstudio_web_explore_chat_float_pos_v1";
const SIZE_STORAGE_KEY = "openstudio_web_explore_chat_float_size_v1";
const OPEN_STORAGE_KEY = "openstudio_web_explore_chat_float_open_v1";
const LAUNCHER_W = 132;
const LAUNCHER_H = 48;
const DEFAULT_W = 440;
const DEFAULT_H = 560;
const MIN_W = 340;
const MIN_H = 420;
const MAX_W = 760;
const MIN_X = 12;
const MIN_Y = 12;
const DRAG_THRESHOLD_PX = 6;

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
 *   webviewRef: import("react").RefObject<HTMLElement | null>;
 *   iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *   onNavigate: (url: string) => void;
 * }} props
 */
export default function WebExploreChatFloat({
  activeUrl,
  pageTitle,
  inElectron,
  webviewRef,
  iframeRef,
  onNavigate,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => readStoredOpen());
  const [panelSize, setPanelSize] = useState(() => readStoredSize() ?? { w: DEFAULT_W, h: DEFAULT_H });
  const [pos, setPos] = useState(() => {
    const stored = readStoredPos();
    const size = readStoredSize() ?? { w: DEFAULT_W, h: DEFAULT_H };
    if (stored) return stored;
    return {
      x: Math.max(MIN_X, window.innerWidth - size.w - 28),
      y: Math.max(MIN_Y, window.innerHeight - size.h - 88),
    };
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const panelSizeRef = useRef(panelSize);
  panelSizeRef.current = panelSize;
  const dragRef = useRef(
    /** @type {{ active: boolean; moved: boolean; startX: number; startY: number; baseX: number; baseY: number }} */ ({
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      baseX: 0,
      baseY: 0,
    }),
  );
  const resizeRef = useRef(
    /** @type {{ active: boolean; startX: number; startY: number; baseW: number; baseH: number }} */ ({
      active: false,
      startX: 0,
      startY: 0,
      baseW: DEFAULT_W,
      baseH: DEFAULT_H,
    }),
  );

  useEffect(() => {
    writeStoredOpen(open);
  }, [open]);

  useEffect(() => {
    const clampIntoViewport = () => {
      const width = open ? panelSizeRef.current.w : LAUNCHER_W;
      const height = open ? panelSizeRef.current.h : LAUNCHER_H;
      const maxX = Math.max(MIN_X, window.innerWidth - width - 12);
      const maxY = Math.max(MIN_Y, window.innerHeight - height - 12);
      setPos((prev) => {
        const next = {
          x: clamp(prev.x, MIN_X, maxX),
          y: clamp(prev.y, MIN_Y, maxY),
        };
        writeStoredPos(next);
        return next;
      });
      setPanelSize((prev) => {
        const maxH = Math.max(MIN_H, window.innerHeight - 48);
        const next = {
          w: clamp(prev.w, MIN_W, Math.min(MAX_W, window.innerWidth - 24)),
          h: clamp(prev.h, MIN_H, maxH),
        };
        writeStoredSize(next);
        return next;
      });
    };
    clampIntoViewport();
    window.addEventListener("resize", clampIntoViewport);
    return () => window.removeEventListener("resize", clampIntoViewport);
  }, [open]);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const width = open ? panelSizeRef.current.w : LAUNCHER_W;
      const height = open ? panelSizeRef.current.h : LAUNCHER_H;
      const maxX = Math.max(MIN_X, window.innerWidth - width - 12);
      const maxY = Math.max(MIN_Y, window.innerHeight - height - 12);
      const nx = clamp(d.baseX + (e.clientX - d.startX), MIN_X, maxX);
      const ny = clamp(d.baseY + (e.clientY - d.startY), MIN_Y, maxY);
      if (!d.moved && Math.hypot(nx - d.baseX, ny - d.baseY) >= DRAG_THRESHOLD_PX) {
        d.moved = true;
      }
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragRef.current.active = false;
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
  }, [dragging, open]);

  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (e) => {
      const r = resizeRef.current;
      if (!r.active) return;
      const maxW = Math.min(MAX_W, window.innerWidth - posRef.current.x - 12);
      const maxH = Math.max(MIN_H, window.innerHeight - posRef.current.y - 12);
      const next = {
        w: clamp(r.baseW + (e.clientX - r.startX), MIN_W, maxW),
        h: clamp(r.baseH + (e.clientY - r.startY), MIN_H, maxH),
      };
      setPanelSize(next);
    };
    const onUp = () => {
      resizeRef.current.active = false;
      setResizing(false);
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
  }, [resizing]);

  /** @param {React.PointerEvent<HTMLElement>} e */
  const startDrag = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
    setDragging(true);
  };

  /** @param {React.PointerEvent<HTMLElement>} e */
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseW: panelSize.w,
      baseH: panelSize.h,
    };
    setResizing(true);
  };

  const openWidth = open ? panelSize.w : LAUNCHER_W;

  return (
    <div
      className={cn(
        "web-explore-chat-float",
        open && "web-explore-chat-float--open",
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
            setOpen(true);
          }}
          title={t("webExploreChat.launcher")}
          aria-label={t("webExploreChat.launcher")}
        >
          <MessageSquare size={17} strokeWidth={2} aria-hidden />
          <span>{t("webExploreChat.launcher")}</span>
        </Button>
      ) : (
        <section
          className="web-explore-chat-float__panel"
          style={{ width: `${panelSize.w}px`, height: `${panelSize.h}px` }}
          aria-label={t("webExploreChat.title")}
        >
          <header className="web-explore-chat-float__head">
            <button
              type="button"
              className="web-explore-chat-float__drag-handle"
              onPointerDown={startDrag}
              aria-label={t("webExploreChat.dragHandle")}
            >
              <GripVertical size={16} strokeWidth={2} aria-hidden />
            </button>
            <div className="web-explore-chat-float__head-main">
              <strong className="web-explore-chat-float__title">{t("webExploreChat.title")}</strong>
              <span className="web-explore-chat-float__subtitle">{pageTitle}</span>
            </div>
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className="web-explore-chat-float__head-btn"
              onClick={() => setOpen(false)}
              title={t("webExploreChat.minimize")}
              aria-label={t("webExploreChat.minimize")}
            >
              <Minimize2 size={15} strokeWidth={2} aria-hidden />
            </Button>
          </header>

          <div className="web-explore-chat-float__embed">
            <ChatLabEmbedConversation
              activeUrl={activeUrl}
              pageTitle={pageTitle}
              inElectron={inElectron}
              webviewRef={webviewRef}
              iframeRef={iframeRef}
              onNavigate={onNavigate}
              className="chat-lab--web-explore-embed"
            />
          </div>

          <button
            type="button"
            className="web-explore-chat-float__resize-handle"
            onPointerDown={startResize}
            aria-label={t("webExploreChat.resizeHandle")}
          />
        </section>
      )}
    </div>
  );
}
