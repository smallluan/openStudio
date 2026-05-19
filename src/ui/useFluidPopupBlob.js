import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Scroll containers between `node` and `until` (exclusive until), for blob repositioning —
 * `scroll` does not bubble from nested overflow areas to the measurement root.
 *
 * @param {HTMLElement | null} node
 * @param {HTMLElement | null} until
 */
function overflowScrollAncestorsUntil(node, until) {
  /** @type {HTMLElement[]} */
  const out = [];
  let p = node?.parentElement ?? null;
  while (p && p !== until) {
    const st = getComputedStyle(p);
    const oy = st.overflowY;
    const ox = st.overflowX;
    if (
      oy === "auto" ||
      oy === "scroll" ||
      oy === "overlay" ||
      ox === "auto" ||
      ox === "scroll" ||
      ox === "overlay"
    ) {
      out.push(p);
    }
    p = p.parentElement;
  }
  return out;
}

/**
 * Animated highlight blob inside popovers/lists (`--os-liquid-highlight-*` / `.fluid-nav__blob`).
 *
 * @param {{
 *   open: boolean;
 *   hoverKey: string | null;
 *   fallbackKey?: string | null;
 *   layoutKey?: string;
 *   inset?: number; // blob内缩像素，让blob不覆盖到元素边缘
 * }} opts
 */
export function useFluidPopupBlob({ open, hoverKey, fallbackKey = null, layoutKey = "", inset = 0 }) {
  const rootRef = useRef(/** @type {HTMLElement | null} */ (null));
  const itemRefs = useRef(new Map());
  const blobReadyRef = useRef(false); // 记录blob是否准备好显示

  const setItemRef = useCallback((/** @type {string} */ key, /** @type {HTMLElement | null} */ node) => {
    const m = itemRefs.current;
    if (node) m.set(key, node);
    else m.delete(key);
  }, []);

  const [blob, setBlob] = useState(() => ({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: 0,
  }));

  const targetKey = hoverKey ?? fallbackKey;

  // 当open变为false时重置ready状态
  useLayoutEffect(() => {
    if (!open) {
      blobReadyRef.current = false;
      setBlob((b) => ({ ...b, opacity: 0 }));
    }
  }, [open]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!open || !root) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }
    if (targetKey == null) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }
    const el = itemRefs.current.get(targetKey);
    if (!el) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }

    const measure = (forceOpacity = false) => {
      const rootLive = rootRef.current;
      const idLive = hoverKey ?? fallbackKey;
      const rowLive = idLive != null ? itemRefs.current.get(idLive) : null;
      if (!rootLive || !rowLive) {
        setBlob((b) => ({ ...b, opacity: 0 }));
        return;
      }
      const r = rootLive.getBoundingClientRect();
      const e = rowLive.getBoundingClientRect();
      const left = Math.round((e.left - r.left + rootLive.scrollLeft + inset) * 100) / 100;
      const top = Math.round((e.top - r.top + rootLive.scrollTop + inset) * 100) / 100;
      const width = Math.round((e.width - inset * 2) * 100) / 100;
      const height = Math.round((e.height - inset * 2) * 100) / 100;

      const opacity = blobReadyRef.current || forceOpacity ? 1 : 0;

      setBlob((prev) => {
        if (
          prev.opacity === opacity &&
          prev.left === left &&
          prev.top === top &&
          prev.width === width &&
          prev.height === height
        ) {
          return prev;
        }
        return { left, top, width, height, opacity };
      });
    };

    measure();

    // 延迟显示blob，等待popup入场动画稳定
    const showTimeout = setTimeout(() => {
      blobReadyRef.current = true;
      measure(true); // 强制显示
    }, 180);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    ro?.observe(el);

    const onScroll = () => measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    const nestedScrollers = overflowScrollAncestorsUntil(el, root);
    for (const sc of nestedScrollers) {
      sc.addEventListener("scroll", onScroll, { passive: true });
    }

    return () => {
      clearTimeout(showTimeout);
      ro?.disconnect();
      root.removeEventListener("scroll", onScroll);
      for (const sc of nestedScrollers) {
        sc.removeEventListener("scroll", onScroll);
      }
    };
  }, [open, targetKey, hoverKey, fallbackKey, layoutKey, inset]);

  const blobStyle = {
    transform: `translate3d(${blob.left}px, ${blob.top}px, 0)`,
    width: `${blob.width}px`,
    height: `${blob.height}px`,
    opacity: blob.opacity,
  };

  return { rootRef, setItemRef, blobStyle };
}
