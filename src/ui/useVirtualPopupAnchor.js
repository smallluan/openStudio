import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Nearest ancestor that makes `position: fixed` relative to itself instead of the viewport.
 * Common in Web Explore float panel (`backdrop-filter`) and transformed overlays.
 * @param {HTMLElement | null} el
 * @returns {HTMLElement | null}
 */
function findFixedContainingBlock(el) {
  let node = el?.parentElement ?? null;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    if (
      style.transform !== "none" ||
      style.perspective !== "none" ||
      style.filter !== "none" ||
      style.backdropFilter !== "none" ||
      style.willChange === "transform" ||
      style.willChange === "perspective" ||
      style.willChange === "filter" ||
      style.contain === "paint" ||
      style.contain === "layout" ||
      style.contain === "strict" ||
      style.contain === "content"
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Reposition TDesign Popup after the virtual anchor moves.
 * @param {import("react").RefObject<import("tdesign-react").PopupInstanceFunctions | null>} popupRef
 */
function safePopupUpdate(popupRef) {
  requestAnimationFrame(() => {
    const api = popupRef.current;
    if (!api) return;
    const popper = api.getPopper?.();
    if (!popper || typeof popper.update !== "function") return;
    try {
      api.update();
    } catch {
      /* popper may still be initializing */
    }
  });
}

/**
 * Positions a fixed invisible span for TDesign Popup when the anchor is virtual or external.
 * @param {{
 *   open: boolean;
 *   getRect: () => DOMRect | null | undefined;
 *   popupRef: import("react").RefObject<import("tdesign-react").PopupInstanceFunctions | null>;
 *   scrollRootRef?: import("react").RefObject<HTMLElement | null>;
 * }} options
 */
export function useVirtualPopupAnchor({ open, getRect, popupRef, scrollRootRef }) {
  const anchorRef = useRef(/** @type {HTMLSpanElement | null} */ (null));

  const syncAnchor = useCallback(() => {
    const rect = getRect?.();
    const anchor = anchorRef.current;
    if (!rect || !anchor) return;

    const containingBlock = findFixedContainingBlock(anchor);
    let left = rect.left;
    let top = rect.top;
    if (containingBlock) {
      const blockRect = containingBlock.getBoundingClientRect();
      left -= blockRect.left;
      top -= blockRect.top;
    }

    anchor.style.position = "fixed";
    anchor.style.left = `${left}px`;
    anchor.style.top = `${top}px`;
    anchor.style.width = `${Math.max(rect.width, 0)}px`;
    anchor.style.height = `${Math.max(rect.height, 0)}px`;
    anchor.style.pointerEvents = "none";
    safePopupUpdate(popupRef);
  }, [getRect, popupRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    syncAnchor();
    const scrollEl = scrollRootRef?.current ?? null;
    scrollEl?.addEventListener("scroll", syncAnchor, { passive: true });
    window.addEventListener("scroll", syncAnchor, true);
    window.addEventListener("resize", syncAnchor);
    return () => {
      scrollEl?.removeEventListener("scroll", syncAnchor);
      window.removeEventListener("scroll", syncAnchor, true);
      window.removeEventListener("resize", syncAnchor);
    };
  }, [open, scrollRootRef, syncAnchor]);

  return { anchorRef, syncAnchor };
}
