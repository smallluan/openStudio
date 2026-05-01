import { cn } from "./cn.js";

/**
 * @param {{
 *   className?: string;
 *   title: string;
 *   illustration?: import("react").ReactNode | null;
 *   hideDecoration?: boolean;
 *   action?: import("react").ReactNode;
 * }} props
 */
export default function EmptyState({ title, illustration, hideDecoration, action, className }) {
  return (
    <div
      className={cn(
        "flex min-h-[7rem] w-full flex-col items-center justify-center gap-4 px-3 py-8 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {hideDecoration && !illustration ? null : illustration ?
        <div className="text-[color-mix(in_srgb,var(--os-text-muted)_55%,transparent)] [&_svg]:size-11 [&_svg]:opacity-95 [&_svg]:text-[color-mix(in_srgb,var(--os-text-muted)_75%,transparent)]">
          {illustration}
        </div>
      : hideDecoration ?
        null
      : (
        <div
          className="pointer-events-none h-10 w-[2.375rem] rounded-[10px] border border-[var(--os-border)] bg-[var(--os-bg-elevated)] shadow-[var(--os-control-inset)]"
          aria-hidden
        />
      )}
      <p className="max-w-[15rem] text-[0.8125rem] font-medium leading-snug text-[var(--os-text-muted)]">
        {title}
      </p>
      {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
