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

export default function Select({ id, value, onChange, options, ariaLabel, className }) {
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
  });

  useEffect(() => {
    if (!open) setHoverKey(null);
  }, [open]);

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

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const floatingProps = getFloatingProps();

  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative min-w-[8.5rem]", className)}>
      <button
        ref={refs.setReference}
        id={id}
        type="button"
        aria-label={ariaLabel}
        {...getReferenceProps()}
        className={cn(
          "flex h-8 w-full min-w-[10rem] items-center justify-between gap-2 rounded-lg border border-[var(--os-border)]",
          "bg-[var(--os-bg-elevated)] px-2.5 text-left text-[0.8125rem] font-medium text-[var(--os-text)] shadow-[var(--os-control-inset)]",
          "transition-[border-color,box-shadow] duration-150 hover:border-[color-mix(in_srgb,var(--os-accent)_32%,var(--os-border))]",
          "focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]",
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? "—"}</span>
        <Chevron open={present} />
      </button>

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
                  className="fluid-select-list relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5 outline-none"
                >
                  <div
                    aria-hidden
                    className="fluid-nav__blob fluid-select__blob pointer-events-none absolute top-0 left-0 z-0 rounded-lg"
                    style={blobStyle}
                  />
                  {options.map((opt) => (
                    <li key={opt.value} role="option" aria-selected={opt.value === value}>
                      <div
                        ref={(node) => setItemRef(String(opt.value), node)}
                        className="fluid-select__measure w-full"
                        onPointerEnter={() => setHoverKey(String(opt.value))}
                      >
                        <button
                          type="button"
                          className={cn(
                            "fluid-select__hit flex h-8 w-full items-center rounded-md border-none px-2.5 text-left text-[0.8125rem] outline-none transition-colors duration-[0.45s] ease-[cubic-bezier(0.34,1.2,0.52,1)]",
                            "bg-transparent",
                            opt.value === value ?
                              "fluid-select__hit--selected font-semibold"
                            : "font-medium text-[var(--os-text-muted)] hover:text-[var(--os-text)]",
                          )}
                          onClick={() => {
                            onChange(opt.value);
                            setOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </div>
  );
}
