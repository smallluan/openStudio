import { cn } from "./cn.js";

/** Native text/password input styled for dense forms (settings, model profiles). */
export default function TextField({ className, type = "text", ...props }) {
  return (
    <input
      type={type}
      className={cn(
        "box-border h-8 min-h-8 min-w-0 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 text-[0.8125rem] leading-8 text-[var(--os-text)] shadow-[var(--os-control-inset)]",
        "placeholder:text-[var(--os-text-faint)]",
        "transition-[border-color,box-shadow] duration-150",
        "focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}
