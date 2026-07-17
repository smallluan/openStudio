import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { useFluidPopupBlob } from "../../ui/useFluidPopupBlob.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";
import { cn } from "../../ui/cn.js";

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   icon?: import("react").ReactNode;
 *   onClick: () => void;
 *   disabled?: boolean;
 *   danger?: boolean;
 *   dividerBefore?: boolean;
 * }} ChatLabContextMenuItem
 */

/**
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   anchorPoint?: { x: number; y: number } | null;
 *   getAnchorRect?: () => DOMRect | null;
 *   referenceRef?: import("react").RefObject<HTMLElement | null>;
 *   items: ChatLabContextMenuItem[];
 *   ariaLabel?: string;
 *   placement?: import("@floating-ui/react").Placement;
 *   flipFallbackPlacements?: import("@floating-ui/react").Placement[];
 *   scrollRootRef?: import("react").RefObject<HTMLElement | null>;
 * }} props
 */
export default function ChatLabContextMenu({
  open,
  onOpenChange,
  anchorPoint = null,
  getAnchorRect,
  referenceRef,
  items,
  ariaLabel,
  placement = "bottom-start",
  flipFallbackPlacements,
  scrollRootRef,
}) {
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);
  const virtualRectRef = useRef(/** @type {DOMRect | null} */ (null));
  const [hoverKey, setHoverKey] = useState(/** @type {string | null} */ (null));
  const usesElementRect = Boolean(getAnchorRect || referenceRef);

  useEffect(() => {
    if (!open) setHoverKey(null);
  }, [open]);

  const resolveAnchorRect = useCallback(() => {
    if (getAnchorRect) {
      const live = getAnchorRect();
      if (live) {
        virtualRectRef.current = live;
        return live;
      }
      return virtualRectRef.current;
    }
    if (anchorPoint) {
      virtualRectRef.current = DOMRect.fromRect({
        x: anchorPoint.x,
        y: anchorPoint.y,
        width: 0,
        height: 0,
      });
      return virtualRectRef.current;
    }
    return virtualRectRef.current;
  }, [anchorPoint, getAnchorRect]);

  const virtualElRef = useRef({
    getBoundingClientRect: () =>
      resolveAnchorRect() ?? DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 }),
  });

  const { refs, floatingStyles, context, update } = useFloating({
    open: present,
    onOpenChange,
    placement,
    strategy: "fixed",
    middleware: [
      offset(usesElementRect ? 6 : 4),
      flip({
        padding: 8,
        fallbackPlacements:
          flipFallbackPlacements ??
          (usesElementRect
            ? ["left-start", "bottom-start", "top-start", "right-end", "left-end"]
            : undefined),
      }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: (reference, floating, updateFn) =>
      autoUpdate(reference, floating, updateFn, {
        ancestorScroll: true,
        ancestorResize: true,
        elementResize: true,
        layoutShift: true,
      }),
  });

  useEffect(() => {
    const el = referenceRef?.current ?? null;
    if (el) {
      refs.setReference(el);
      return;
    }
    refs.setReference(virtualElRef.current);
  }, [refs, anchorPoint, open, getAnchorRect, referenceRef]);

  useEffect(() => {
    if (!open || (!getAnchorRect && !referenceRef)) return undefined;
    const onRelayout = () => {
      if (referenceRef?.current) {
        void update();
        return;
      }
      if (getAnchorRect && !getAnchorRect()) {
        onOpenChange(false);
        return;
      }
      void update();
    };
    const scrollEl = scrollRootRef?.current ?? null;
    scrollEl?.addEventListener("scroll", onRelayout, { passive: true });
    window.addEventListener("resize", onRelayout, { passive: true });
    return () => {
      scrollEl?.removeEventListener("scroll", onRelayout);
      window.removeEventListener("resize", onRelayout);
    };
  }, [open, getAnchorRect, referenceRef, scrollRootRef, onOpenChange, update]);

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const { rootRef: menuBlobRootRef, setItemRef: setMenuItemRef, blobStyle: menuBlobStyle } =
    useFluidPopupBlob({
      open,
      hoverKey,
      fallbackKey: null,
      layoutKey: items.map((i) => i.id).join(","),
    });

  const anchorRect = referenceRef?.current?.getBoundingClientRect() ?? resolveAnchorRect();
  const canShow = present && (anchorRect || referenceRef?.current || leaving);
  if (!canShow) return null;

  const floatingProps = getFloatingProps();

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="outline-none"
          {...floatingProps}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerLeave={(e) => {
            floatingProps.onPointerLeave?.(e);
            setHoverKey(null);
          }}
        >
          <FluidPopupAnimatedSurface
            key={surfaceKey}
            leaving={leaving}
            finishLeave={finishLeave}
            placement={context.placement}
            morphBr="11px"
            className="chat-history-card__menu chat-lab__context-menu"
            aria-label={ariaLabel}
          >
            <div ref={menuBlobRootRef} className="relative w-full chat-history-card__menu-blob-scope">
              <div
                aria-hidden
                className="fluid-nav__blob fluid-popup-menu__blob pointer-events-none absolute top-0 left-0 z-0"
                style={menuBlobStyle}
              />
              {items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "chat-history-card__menu-row",
                    item.dividerBefore && "chat-history-card__menu-row--with-divider",
                  )}
                  onPointerEnter={() => setHoverKey(item.id)}
                >
                  <div ref={(node) => setMenuItemRef(item.id, node)} className="fluid-popup-menu__measure">
                    <Button
                      type="button"
                      className={cn(
                        "chat-history-card__menu-item w-full min-w-0",
                        item.danger && "chat-history-card__menu-item--danger",
                      )}
                      disabled={item.disabled}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.disabled) return;
                        onOpenChange(false);
                        item.onClick();
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </FluidPopupAnimatedSurface>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
