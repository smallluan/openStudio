import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn.js";

/**
 * Horizontal pill tabs with the same “fluid” sliding highlight as `FluidNavMenu` (`.fluid-nav__blob`).
 *
 * @typedef {{ id: string; label: import("react").ReactNode }} FluidTabItem
 * @param {{
 *   items: FluidTabItem[];
 *   value: string;
 *   onChange: (id: string) => void;
 *   className?: string;
 *   tabListClassName?: string;
 *   ariaLabel?: string;
 * }} props
 */
export default function FluidTabBar({ items, value, onChange, className, tabListClassName, ariaLabel }) {
  const rootRef = useRef(null);
  const anchorRefs = useRef(new Map());
  const valueRef = useRef(value);
  valueRef.current = value;

  const itemIdsKey = useMemo(() => items.map((i) => i.id).join("\0"), [items]);

  const measureRef = useRef(() => {});
  const [blob, setBlob] = useState({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });

  const setAnchor = useCallback((id, node) => {
    const m = anchorRefs.current;
    if (node) m.set(id, node);
    else m.delete(id);
    if (valueRef.current === id) {
      queueMicrotask(() => measureRef.current?.());
    }
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const id = valueRef.current;
      const el = id ? anchorRefs.current.get(id) : null;
      if (!root || !id || !el) {
        setBlob((b) => ({ ...b, opacity: 0 }));
        return;
      }
      const e = el.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      const left = Math.round((e.left - r.left + root.scrollLeft) * 100) / 100;
      const top = Math.round((e.top - r.top + root.scrollTop) * 100) / 100;
      const width = Math.round(e.width * 100) / 100;
      const height = Math.round(e.height * 100) / 100;
      setBlob((prev) => {
        if (
          prev.opacity === 1 &&
          prev.left === left &&
          prev.top === top &&
          prev.width === width &&
          prev.height === height
        ) {
          return prev;
        }
        return { left, top, width, height, opacity: 1 };
      });
    };

    measureRef.current = measure;
    measure();

    const root = rootRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (root) ro?.observe(root);
    const activeEl = anchorRefs.current.get(value);
    if (activeEl) ro?.observe(activeEl);

    const onScroll = () => measure();
    root?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro?.disconnect();
      root?.removeEventListener("scroll", onScroll);
    };
  }, [value, itemIdsKey]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div
        aria-hidden
        className="fluid-nav__blob pointer-events-none absolute top-0 left-0 z-0 rounded-full"
        style={{
          transform: `translate3d(${blob.left}px, ${blob.top}px, 0)`,
          width: `${blob.width}px`,
          height: `${blob.height}px`,
          opacity: blob.opacity,
        }}
      />
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn("relative z-[1] flex flex-wrap gap-1.5", tabListClassName)}
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <div
              key={item.id}
              ref={(node) => setAnchor(item.id, node)}
              className="inline-flex shrink-0"
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  "relative z-[1] rounded-full border-none bg-transparent px-3 py-1.5 text-[0.78rem] outline-none",
                  "transition-[color,font-weight] duration-[0.45s] ease-[cubic-bezier(0.34,1.2,0.52,1)]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--os-focus-ring)] focus-visible:outline-offset-2",
                  selected
                    ? "font-semibold text-[var(--os-text)]"
                    : "font-medium text-[var(--os-text-muted)] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)]",
                )}
                onClick={() => onChange(item.id)}
              >
                {item.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
