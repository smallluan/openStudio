import { useEffect } from "react";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   x: number;
 *   y: number;
 *   items: Array<{ id: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }>;
 *   onClose: () => void;
 * }} props
 */
export default function WorkflowContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const onDocClick = () => onClose();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onDocClick);
    window.addEventListener("contextmenu", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("contextmenu", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="wf-context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cn("wf-context-menu__item", item.danger && "is-danger")}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
