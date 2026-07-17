import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { cn } from "../../ui/cn.js";

const POS_STORAGE_KEY = "openstudio_chat_preview_assistive_pos";
const BALL_SIZE = 44;
const DRAG_THRESHOLD_PX = 6;

/** iPhone AssistiveTouch idle glyph (gray ring + center dot on white glass). */
function AssistiveTouchGlyph() {
  return (
    <svg
      className="chat-lab-preview-dock__assistive-ball__glyph"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden
    >
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="#C7C7CC" strokeWidth="1.35" />
      <circle cx="10" cy="10" r="2.85" fill="#8E8E93" />
    </svg>
  );
}

/** @typedef {{ x: number; y: number }} NormalizedPos */

/** @returns {NormalizedPos | null} */
function readStoredPosition() {
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return {
        x: Math.min(1, Math.max(0, Number(p.x))),
        y: Math.min(1, Math.max(0, Number(p.y))),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** @param {NormalizedPos} pos */
function writeStoredPosition(pos) {
  try {
    window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * iPhone AssistiveTouch-style draggable floating ball. Tap (without drag) triggers back.
 *
 * @param {{
 *   shellRef: import("react").RefObject<HTMLElement | null>;
 *   onBack: () => void;
 *   canGoBack?: boolean;
 *   label: string;
 * }} props
 */
export default function ChatLabPreviewMobileAssistiveBall({
  shellRef,
  onBack,
  canGoBack = false,
  label,
}) {
  const ballRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  });
  const [pixelPos, setPixelPos] = useState(/** @type {{ x: number; y: number } | null} */ (null));
  const [dragging, setDragging] = useState(false);

  const layoutBall = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const stored = readStoredPosition();
    const rect = shell.getBoundingClientRect();
    const maxX = Math.max(0, rect.width - BALL_SIZE);
    const maxY = Math.max(0, rect.height - BALL_SIZE);
    const ratio = stored ?? { x: 0.06, y: 0.58 };
    setPixelPos({
      x: clamp(ratio.x * maxX, 0, maxX),
      y: clamp(ratio.y * maxY, 0, maxY),
    });
  }, [shellRef]);

  useEffect(() => {
    layoutBall();
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => layoutBall());
    ro.observe(shell);
    return () => ro.disconnect();
  }, [layoutBall, shellRef]);

  const persistPosition = useCallback(
    /** @param {number} x @param {number} y */
    (x, y) => {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const maxX = Math.max(1, rect.width - BALL_SIZE);
      const maxY = Math.max(1, rect.height - BALL_SIZE);
      writeStoredPosition({ x: x / maxX, y: y / maxY });
    },
    [shellRef],
  );

  /** @param {React.PointerEvent<HTMLButtonElement>} e */
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const shell = shellRef.current;
    const ball = ballRef.current;
    if (!shell || !ball || pixelPos == null) return;

    e.preventDefault();
    ball.setPointerCapture(e.pointerId);
    const shellRect = shell.getBoundingClientRect();
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      offsetX: e.clientX - shellRect.left - pixelPos.x,
      offsetY: e.clientY - shellRect.top - pixelPos.y,
      startX: pixelPos.x,
      startY: pixelPos.y,
    };
    setDragging(true);
  };

  /** @param {React.PointerEvent<HTMLButtonElement>} e */
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.active || e.pointerId !== drag.pointerId) return;

    const shell = shellRef.current;
    if (!shell) return;

    const rect = shell.getBoundingClientRect();
    const maxX = Math.max(0, rect.width - BALL_SIZE);
    const maxY = Math.max(0, rect.height - BALL_SIZE);
    const nextX = clamp(e.clientX - rect.left - drag.offsetX, 0, maxX);
    const nextY = clamp(e.clientY - rect.top - drag.offsetY, 0, maxY);

    if (!drag.moved && Math.hypot(nextX - drag.startX, nextY - drag.startY) >= DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }

    setPixelPos({ x: nextX, y: nextY });
  };

  /** @param {React.PointerEvent<HTMLButtonElement>} e */
  const finishPointer = (e) => {
    const drag = dragRef.current;
    if (!drag.active || e.pointerId !== drag.pointerId) return;

    drag.active = false;
    setDragging(false);

    if (pixelPos) persistPosition(pixelPos.x, pixelPos.y);

    if (!drag.moved) onBack();

    try {
      ballRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  if (!pixelPos) return null;

  return (
    <Button
                variant="text"
                size="small"
      ref={ballRef}
      type="button"
      className={cn(
        "chat-lab-preview-dock__assistive-ball",
        dragging && "chat-lab-preview-dock__assistive-ball--dragging",
        !canGoBack && "chat-lab-preview-dock__assistive-ball--idle",
      )}
      style={{ left: `${pixelPos.x}px`, top: `${pixelPos.y}px` }}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      <AssistiveTouchGlyph />
    </Button>
  );
}
