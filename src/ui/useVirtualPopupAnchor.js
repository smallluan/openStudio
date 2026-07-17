import { useCallback, useLayoutEffect, useRef } from "react";

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
    anchor.style.position = "fixed";
    anchor.style.left = `${rect.left}px`;
    anchor.style.top = `${rect.top}px`;
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
