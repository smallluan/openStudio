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
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
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

export default function Select({ id, value, onChange, options, ariaLabel, className }) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const listRootRef = useRef(null);
  const itemRefs = useRef(new Map());
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });

  const setItemRef = useCallback((optionValue, node) => {
    const m = itemRefs.current;
    if (node) m.set(optionValue, node);
    else m.delete(optionValue);
  }, []);

  const { refs, floatingStyles, context } = useFloating({
    open,
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

  useLayoutEffect(() => {
    const root = listRootRef.current;
    if (!open || !root) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }
    const el = itemRefs.current.get(value);
    if (!el) {
      setBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }

    const measure = () => {
      const r = root.getBoundingClientRect();
      const e = el.getBoundingClientRect();
      const left = Math.round((e.left - r.left + root.scrollLeft) * 100) / 100;
      const top = Math.round((e.top - r.top + root.scrollTop) * 100) / 100;
      const width = Math.round(e.width * 100) / 100;
      const height = Math.round(e.height * 100) / 100;
      setBlob((prev) => {
        if (prev.opacity === 1 && prev.left === left && prev.top === top && prev.width === width && prev.height === height) {
          return prev;
        }
        return { left, top, width, height, opacity: 1 };
      });
    };

    measure();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    ro?.observe(el);

    const onScroll = () => measure();
    root.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro?.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [open, value, options]);

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
        <Chevron open={open} />
      </button>

      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <ul
              ref={(node) => {
                listRootRef.current = node;
                refs.setFloating(node);
              }}
              id={listId}
              role="listbox"
              style={{ ...floatingStyles, zIndex: 300 }}
              className={cn(
                "fluid-select-list relative flex flex-col gap-1 overflow-y-auto rounded-lg p-1.5 outline-none",
                "border border-[var(--os-border-strong)] bg-[var(--os-bg-popover)] shadow-[var(--os-shadow-soft)]",
              )}
              {...getFloatingProps()}
            >
              <div
                aria-hidden
                className="fluid-nav__blob fluid-select__blob pointer-events-none absolute top-0 left-0 z-0 rounded-lg"
                style={{
                  transform: `translate3d(${blob.left}px, ${blob.top}px, 0)`,
                  width: `${blob.width}px`,
                  height: `${blob.height}px`,
                  opacity: blob.opacity,
                }}
              />
              {options.map((opt) => (
                <li key={opt.value} role="option" aria-selected={opt.value === value}>
                  <div ref={(node) => setItemRef(opt.value, node)} className="fluid-select__measure w-full">
                    <button
                      type="button"
                      className={cn(
                        "fluid-select__hit flex h-8 w-full items-center rounded-md border-none px-2.5 text-left text-[0.8125rem] outline-none transition-[color,background-color] duration-[0.45s] ease-[cubic-bezier(0.34,1.2,0.52,1)]",
                        "bg-transparent",
                        opt.value === value ?
                          "fluid-select__hit--selected font-semibold"
                        : "font-medium text-[var(--os-text-muted)] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)]",
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
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </div>
  );
}
