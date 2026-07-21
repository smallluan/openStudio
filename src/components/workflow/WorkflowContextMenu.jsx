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
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   anchorPoint: { x: number; y: number } | null;
 *   items: Array<{ id: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }>;
 * }} props
 */
export default function WorkflowContextMenu({ open, onOpenChange, anchorPoint, items }) {
  const popupRef = useRef(/** @type {import("tdesign-react").PopupInstanceFunctions | null} */ (null));
  const virtualRectRef = useRef(/** @type {DOMRect | null} */ (null));
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  const getRect = useCallback(() => {
    if (!anchorPoint) return virtualRectRef.current;
    virtualRectRef.current = DOMRect.fromRect({
      x: anchorPoint.x,
      y: anchorPoint.y,
      width: 0,
      height: 0,
    });
    return virtualRectRef.current;
  }, [anchorPoint]);

  const { anchorRef } = useVirtualPopupAnchor({ open, getRect, popupRef });

  const handleVisibleChange = useCallback(
    /** @param {boolean} visible @param {{ trigger?: string }} [context] */
    (visible, context) => {
      if (!visible && context?.trigger === "document" && Date.now() - openedAtRef.current < 80) {
        return;
      }
      onOpenChange(visible);
    },
    [onOpenChange],
  );

  const popupContent = (
    <div
      className="wf-context-menu"
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={cn("wf-context-menu__item", item.danger && "is-danger")}
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
          {item.label}
        </button>
      ))}
    </div>
  );

  return (
    <Popup
      ref={popupRef}
      visible={open}
      attach="body"
      placement="bottom-start"
      trigger="click"
      zIndex={5000}
      destroyOnClose
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={OS_POPUP_INNER_CLASS}
      popperOptions={{
        modifiers: [
          { name: "offset", options: { offset: [0, 4] } },
          { name: "flip", options: { padding: 8 } },
          { name: "preventOverflow", options: { padding: 8 } },
        ],
      }}
      content={popupContent}
      onVisibleChange={handleVisibleChange}
    >
      <span ref={anchorRef} className={OS_POPUP_ANCHOR_CLASS} aria-hidden />
    </Popup>
  );
}
