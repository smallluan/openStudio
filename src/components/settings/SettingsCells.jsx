import { cn } from "../../ui/cn.js";

/** Outer chrome for paired cells (single rounded frame + column divider on wide screens). */
export function SettingsCellRow({ children, className }) {
  return (
    <div
      className={cn(
        "settings-cell-row overflow-hidden rounded-xl border border-[var(--os-border)] bg-[var(--os-bg-subtle)]",
        className,
      )}
    >
      <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-[var(--os-border)]">{children}</div>
    </div>
  );
}

/** One logical setting inside a {@link SettingsCellRow}. */
export function SettingsCell({ label, children, className }) {
  return (
    <div className={cn("flex flex-col justify-center gap-2 px-4 py-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[0.875rem]">
        <span className="font-medium text-[var(--os-text-muted)]">{label}</span>
        {children}
      </div>
    </div>
  );
}
