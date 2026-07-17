import { useEffect, useId, useMemo, useState } from "react";
import { Popup } from "tdesign-react";
import { Button } from "@open-studio/udesign";
import { useFluidPopupBlob } from "./useFluidPopupBlob.js";
import { OS_POPUP_INNER_CLASS, OS_POPUP_OVERLAY_CLASS, osPopupPopperOptions } from "./osPopupShared.js";
import { cn } from "./cn.js";

function Chevron({ open }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      className={cn("shrink-0 text-[var(--os-text-muted)] transition-transform duration-200", open && "rotate-180")}
      aria-hidden
    >
      <path d="M3.5 5.25 7 8.75l3.5-3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Select({ id, value, onChange, options, ariaLabel, className, disabled = false }) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [hoverKey, setHoverKey] = useState(/** @type {string | null} */ (null));

  const layoutKey = useMemo(() => options.map((o) => String(o.value)).join("\x1e"), [options]);

  const { rootRef: blobRootRef, setItemRef, blobStyle } = useFluidPopupBlob({
    open,
    hoverKey,
    fallbackKey: String(value),
    layoutKey,
    inset: 2,
  });

  useEffect(() => {
    if (!open) setHoverKey(null);
    else setHoverKey(String(value));
  }, [open, value]);

  const selected = options.find((o) => o.value === value);

  const popupContent = (
    <div
      className={cn(
        "relative flex max-h-[min(280px,calc(100vh-24px))] min-w-0 flex-col overflow-hidden rounded-lg",
        "border border-[var(--os-border-strong)] bg-[var(--os-bg-popover)] shadow-[var(--os-shadow-soft)]",
      )}
      onPointerLeave={() => setHoverKey(null)}
    >
      <ul
        ref={blobRootRef}
        id={listId}
        role="listbox"
        className="fluid-select-list relative flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto outline-none"
      >
        <div className="flex flex-col gap-1 p-1.5">
          <div
            aria-hidden
            className="fluid-nav__blob fluid-select__blob pointer-events-none absolute top-0 left-0 z-0 rounded-lg"
            style={blobStyle}
          />
          {options.map((opt) => (
            <li key={opt.value} role="option" aria-selected={opt.value === value}>
              <div className="fluid-select__measure w-full" onPointerEnter={() => setHoverKey(String(opt.value))}>
                <Button
                  ref={(node) => setItemRef(String(opt.value), node)}
                  type="button"
                  variant="text"
                  size="small"
                  block
                  className={cn("fluid-select__hit w-full", opt.value === value && "fluid-select__hit--selected")}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </Button>
              </div>
            </li>
          ))}
        </div>
      </ul>
    </div>
  );

  return (
    <div className={cn("relative min-w-[8.5rem]", className)}>
      <Popup
        visible={open}
        trigger="click"
        placement="bottom-end"
        attach="body"
        zIndex={300}
        disabled={disabled}
        destroyOnClose={false}
        overlayClassName={OS_POPUP_OVERLAY_CLASS}
        overlayInnerClassName={OS_POPUP_INNER_CLASS}
        overlayInnerStyle={(triggerEl) => ({
          minWidth: `${triggerEl?.offsetWidth ?? 0}px`,
          maxHeight: "min(280px, calc(100vh - 24px))",
        })}
        popperOptions={osPopupPopperOptions(6, 8)}
        content={popupContent}
        onVisibleChange={setOpen}
      >
        <Button
          id={id}
          type="button"
          variant="outline"
          size="small"
          block
          aria-label={ariaLabel}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          className="w-full min-w-[10rem]"
        >
          <span className="min-w-0 truncate">{selected?.label ?? "—"}</span>
          <Chevron open={open} />
        </Button>
      </Popup>
    </div>
  );
}
