import { cn } from "./cn.js";

/** Compact toggle; checked state fills track + shifts knob for clear on/off contrast. */
export default function Switch({ checked, onCheckedChange, disabled, id, label, className, compact }) {
  const knob = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={compact ? undefined : id}
      aria-label={compact ? label : undefined}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full border transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.33,1,0.68,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--os-bg-panel)]",
        "hover:brightness-[1.03] active:scale-[0.97]",
        checked ?
          "border-[color-mix(in_srgb,var(--os-accent)_65%,transparent)] bg-[var(--os-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
        : "border-[var(--os-border-strong)] bg-[color-mix(in_srgb,var(--os-bg-subtle)_78%,var(--os-bg-hover))] shadow-[var(--os-control-inset)]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-[3px] top-1/2 size-[16px] -translate-y-1/2 rounded-full will-change-transform",
          "shadow-[0_1px_4px_rgba(15,23,42,0.18)] transition-[transform,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.34,1.35,0.64,1)]",
          checked ?
            "translate-x-[16px] bg-white shadow-[0_2px_6px_rgba(15,23,42,0.15)]"
          : "bg-[var(--os-bg-elevated)] ring-1 ring-[color-mix(in_srgb,var(--os-border-strong)_55%,transparent)]",
        )}
      />
    </button>
  );

  if (compact) {
    return <div className={cn(disabled && "cursor-not-allowed opacity-55", className)}>{knob}</div>;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg px-1 py-2 text-[0.8125rem] font-medium leading-snug text-[var(--os-text)]",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
    >
      <span className="min-w-0 flex-1 pr-2" id={id}>
        {label}
      </span>
      {knob}
    </div>
  );
}
