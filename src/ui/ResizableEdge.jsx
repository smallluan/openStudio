import { useCallback, useRef } from "react";
import { cn } from "./cn.js";

/**
 * Vertical resize handle. `side="right"` adds width when dragging right (typical left sidebar).
 * `side="left"` is for a right-side panel: dragging the handle left widens the panel.
 *
 * During drag, `onChange` may fire every animation frame; pass `onCommit` to persist width
 * without triggering heavy child re-renders on every pointer move.
 */
export default function ResizableEdge({
  side = "right",
  value,
  onChange,
  min,
  max,
  className,
  disabled = false,
  onActiveChange,
  onCommit,
}) {
  const dragging = useRef(false);
  const rafId = useRef(/** @type {number | null} */ (null));
  const pendingWidth = useRef(value);

  const onPointerDown = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault();
      dragging.current = true;
      onActiveChange?.(true);
      const startX = e.clientX;
      const startW = value;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      let last = startW;
      pendingWidth.current = startW;

      const flush = () => {
        rafId.current = null;
        if (!dragging.current) return;
        onChange(pendingWidth.current);
      };

      const move = (ev) => {
        if (!dragging.current) return;
        const dx = ev.clientX - startX;
        const delta = side === "right" ? dx : -dx;
        const next = Math.round(Math.min(max, Math.max(min, startW + delta)));
        last = next;
        pendingWidth.current = next;
        if (rafId.current == null) {
          rafId.current = window.requestAnimationFrame(flush);
        }
      };

      const up = () => {
        dragging.current = false;
        if (rafId.current != null) {
          window.cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        onChange(last);
        onCommit?.(last);
        onActiveChange?.(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };

      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [disabled, max, min, onActiveChange, onChange, onCommit, side, value],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "absolute top-0 bottom-0 z-20 w-[10px] shrink-0 cursor-col-resize touch-none select-none outline-none",
        side === "right" ? "right-0" : "left-0",
        disabled && "pointer-events-none opacity-0",
        "focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-inset",
        className,
      )}
      onPointerDown={onPointerDown}
    />
  );
}
