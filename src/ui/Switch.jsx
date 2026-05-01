import { cn } from "./cn.js";

/** Proportions: 52×30 track, 22px thumb — calmer than a tall skinny pill */
export default function Switch({ checked, onCheckedChange, disabled, id, label, className }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl py-2.5 text-[0.875rem] font-medium leading-snug text-[var(--os-text)]",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
    >
      <span className="min-w-0 flex-1 pr-2" id={id}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange?.(!checked)}
        className={cn(
          "relative h-[30px] w-[52px] shrink-0 rounded-[15px] border border-[var(--os-border-strong)] bg-[var(--os-bg-subtle)]",
          "shadow-[inset_0_2px_4px_rgba(15,23,42,0.06)] transition-[background-color,border-color,box-shadow] duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--os-bg-panel)]",
          checked &&
            "border-[color-mix(in_srgb,var(--os-accent)_55%,transparent)] bg-[var(--os-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]",
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute left-[4px] top-1/2 size-[22px] -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(15,23,42,0.18)] transition-transform duration-220 ease-[cubic-bezier(0.34,1.25,0.64,1)]",
            checked && "translate-x-[22px]",
          )}
        />
      </button>
    </div>
  );
}
