import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@open-studio/udesign";
import FluidPopupAnimatedSurface from "./FluidPopupAnimatedSurface.jsx";
import { cn } from "./cn.js";
import { useFluidPopupBlob } from "./useFluidPopupBlob.js";
import { useFloatingPresence } from "./useFloatingPresence.js";

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
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);

  const layoutKey = useMemo(() => options.map((o) => String(o.value)).join("\x1e"), [options]);

  const { rootRef: blobRootRef, setItemRef, blobStyle } = useFluidPopupBlob({
    open,
    hoverKey,
    fallbackKey: String(value),
    layoutKey,
    inset: 2, // blob内缩2px，避免覆盖到button边缘
  });

  useEffect(() => {
    if (!open) setHoverKey(null);
    else setHoverKey(String(value)); // 打开时立即显示选中项的高亮
  }, [open, value]);

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "bottom-end",
    strategy: "fixed",
    middleware: [
      offset(6),
      flip({ padding: 8, fallbackAxisSideDirection: "end" }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxHeight: `min(280px, calc(100vh - 24px))`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const floatingProps = getFloatingProps();

  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative min-w-[8.5rem]", className)}>
      <Button
        ref={refs.setReference}
        id={id}
        type="button"
        variant="outline"
        size="small"
        block
        aria-label={ariaLabel}
        disabled={disabled}
        {...getReferenceProps()}
        className="w-full min-w-[10rem]"
      >
        <span className="min-w-0 truncate">{selected?.label ?? "—"}</span>
        <Chevron open={present} />
      </Button>

      {present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={{ ...floatingStyles, zIndex: 300 }}
              className="outline-none"
              {...floatingProps}
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
                morphBr="10px"
                className={cn(
                  "relative flex max-h-[min(280px,calc(100vh-24px))] min-w-0 flex-col overflow-hidden rounded-lg",
                  "border border-[var(--os-border-strong)] bg-[var(--os-bg-popover)] shadow-[var(--os-shadow-soft)]",
                )}
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
                      <div
                        className="fluid-select__measure w-full"
                        onPointerEnter={() => setHoverKey(String(opt.value))}
                      >
                        <Button
                          ref={(node) => setItemRef(String(opt.value), node)}
                          type="button"
                          variant="text"
                          size="small"
                          block
                          className={cn(
                            "fluid-select__hit w-full",
                            opt.value === value && "fluid-select__hit--selected",
                          )}
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
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </div>
  );
}
