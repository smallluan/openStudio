import { useCallback, useLayoutEffect, useRef } from "react";
import { useFluidBlobState } from "./useFluidBlobState.js";

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
  const { blob, setBlobTarget, hideBlob } = useFluidBlobState();

  const setItemRef = useCallback((/** @type {string} */ key, /** @type {HTMLElement | null} */ node) => {
    const m = itemRefs.current;
    if (node) m.set(key, node);
    else m.delete(key);
  }, []);

  const targetKey = hoverKey ?? fallbackKey;

  // 当open变为false时重置ready状态
  useLayoutEffect(() => {
    if (!open) {
      blobReadyRef.current = false;
      hideBlob();
    }
  }, [open, hideBlob]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!open || !root) {
      hideBlob();
      return;
    }
    if (targetKey == null) {
      hideBlob();
      return;
    }
    const el = itemRefs.current.get(targetKey);
    if (!el) {
      hideBlob();
      return;
    }

    // 测量函数（用于ResizeObserver和scroll事件，此时blob已显示）
    const measure = () => {
      const rootLive = rootRef.current;
      const idLive = hoverKey ?? fallbackKey;
      const rowLive = idLive != null ? itemRefs.current.get(idLive) : null;
      if (!rootLive || !rowLive) {
        hideBlob();
        return;
      }
      const r = rootLive.getBoundingClientRect();
      const e = rowLive.getBoundingClientRect();
      const left = Math.round((e.left - r.left + rootLive.scrollLeft + inset) * 100) / 100;
      const top = Math.round((e.top - r.top + rootLive.scrollTop + inset) * 100) / 100;
      const width = Math.round((e.width - inset * 2) * 100) / 100;
      const height = Math.round((e.height - inset * 2) * 100) / 100;
      setBlobTarget({ left, top, width, height, opacity: blobReadyRef.current ? 1 : 0 });
    };

    // 初始状态：隐藏blob，等待popup入场动画结束
    // popup droplet-in动画560ms，scale从0.72到1（经过峰值1.042）
    // 在动画期间测量会拿到被scale扭曲的位置，所以必须等动画结束
    setBlobTarget({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });

    // 延迟测量并显示blob，等待popup入场动画接近结束(scale≈1)
    // 动画560ms，82%时scale≈1.008，约460ms。用480ms确保scale接近1。
    const showTimeout = setTimeout(() => {
      blobReadyRef.current = true;
      measure(); // 此时scale≈1，测量结果准确
    }, 480);

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
  }, [open, targetKey, hoverKey, fallbackKey, layoutKey, inset, hideBlob, setBlobTarget]);

  const blobStyle = {
    transform: `translate3d(${blob.left}px, ${blob.top}px, 0)`,
    width: `${blob.width}px`,
    height: `${blob.height}px`,
    opacity: blob.opacity,
  };

  return { rootRef, setItemRef, blobStyle };
}