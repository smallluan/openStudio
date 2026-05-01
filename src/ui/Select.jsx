import { useEffect, useId, useRef, useState } from "react";
import { cn } from "./cn.js";

function Chevron({ open }) {
  return (
    <svg
      width="14"
      height="14"
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
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={cn("relative min-w-[10rem]", className)}>
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        className={cn(
          "flex w-full min-w-[11rem] items-center justify-between gap-2 rounded-[10px] border border-[var(--os-border)]",
          "bg-[var(--os-bg-elevated)] px-3 py-2.5 text-left text-[0.8125rem] font-medium text-[var(--os-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
          "transition-[border-color,box-shadow] duration-150 hover:border-[color-mix(in_srgb,var(--os-accent)_35%,var(--os-border))]",
          "focus-visible:border-[var(--os-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 truncate">{selected?.label ?? "—"}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-[300] min-w-full overflow-hidden rounded-[10px] py-1",
            "border border-[color-mix(in_srgb,var(--os-border)_75%,var(--os-glass-stroke))]",
            "bg-[color-mix(in_srgb,var(--os-bg-panel)_92%,transparent)] shadow-[var(--os-shadow-soft)]",
            "backdrop-blur-[var(--os-blur-sm)]",
          )}
        >
          {options.map((opt) => (
            <li key={opt.value} role="option" aria-selected={opt.value === value}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center px-3 py-2 text-left text-[0.8125rem] font-medium transition-colors duration-100",
                  opt.value === value
                    ? "bg-[color-mix(in_srgb,var(--os-accent)_14%,transparent)] text-[var(--os-accent)]"
                    : "text-[var(--os-text)] hover:bg-[var(--os-bg-hover)]",
                )}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
