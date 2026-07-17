import { useCallback, useEffect, useRef } from "react";
import { Popup } from "tdesign-react";
import {
  OS_POPUP_ANCHOR_CLASS,
  OS_POPUP_INNER_CLASS,
  OS_POPUP_OVERLAY_CLASS,
} from "../../ui/osPopupShared.js";
import { useVirtualPopupAnchor } from "../../ui/useVirtualPopupAnchor.js";
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
 *   placement?: import("tdesign-react").PopupProps["placement"];
 *   flipFallbackPlacements?: import("tdesign-react").PopupProps["placement"][];
 *   scrollRootRef?: import("react").RefObject<HTMLElement | null>;
 *   ignoreDocumentDismissMs?: number;
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
  ignoreDocumentDismissMs = 0,
}) {
  const popupRef = useRef(/** @type {import("tdesign-react").PopupInstanceFunctions | null} */ (null));
  const virtualRectRef = useRef(/** @type {DOMRect | null} */ (null));
  const openedAtRef = useRef(0);
  const usesElementRect = Boolean(getAnchorRect || referenceRef);

  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  const resolveAnchorRect = useCallback(() => {
    if (referenceRef?.current) {
      return referenceRef.current.getBoundingClientRect();
    }
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
  }, [anchorPoint, getAnchorRect, referenceRef]);

  const getRect = useCallback(() => resolveAnchorRect(), [resolveAnchorRect]);

  const { anchorRef } = useVirtualPopupAnchor({ open, getRect, popupRef, scrollRootRef });

  const handleVisibleChange = useCallback(
    /** @param {boolean} visible @param {{ trigger?: string }} [context] */
    (visible, context) => {
      if (
        !visible &&
        ignoreDocumentDismissMs > 0 &&
        context?.trigger === "document" &&
        Date.now() - openedAtRef.current < ignoreDocumentDismissMs
      ) {
        return;
      }
      onOpenChange(visible);
    },
    [ignoreDocumentDismissMs, onOpenChange],
  );

  const popupContent = (
    <div
      className="chat-history-card__menu chat-lab__context-menu"
      role="menu"
      aria-label={ariaLabel}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "chat-history-card__menu-row",
            item.dividerBefore && "chat-history-card__menu-row--with-divider",
          )}
        >
          <button
            type="button"
            role="menuitem"
            className={cn(
              "chat-history-card__menu-item",
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
            {item.icon ? <span className="chat-history-card__menu-item-icon">{item.icon}</span> : null}
            <span className="chat-history-card__menu-item-label">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );

  const popperOptions = {
    modifiers: [
      { name: "offset", options: { offset: [0, usesElementRect ? 6 : 4] } },
      {
        name: "flip",
        options: {
          padding: 8,
          fallbackPlacements:
            flipFallbackPlacements ??
            (usesElementRect
              ? ["left-start", "bottom-start", "top-start", "right-end", "left-end"]
              : undefined),
        },
      },
      { name: "preventOverflow", options: { padding: 8 } },
    ],
  };

  return (
    <Popup
      ref={popupRef}
      visible={open}
      attach="body"
      placement={placement}
      trigger="click"
      zIndex={5000}
      destroyOnClose={false}
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={OS_POPUP_INNER_CLASS}
      popperOptions={popperOptions}
      content={popupContent}
      onVisibleChange={handleVisibleChange}
    >
      <span ref={anchorRef} className={OS_POPUP_ANCHOR_CLASS} aria-hidden />
    </Popup>
  );
}
