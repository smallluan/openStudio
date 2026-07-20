import { ChevronRightIcon } from "tdesign-icons-react";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   items: Array<{ label: string; onClick?: () => void }>;
 *   className?: string;
 * }} props
 */
export default function WorkflowBreadcrumb({ items, className }) {
  return (
    <nav className={cn("flex min-w-0 items-center gap-1", className)} aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 ? (
            <ChevronRightIcon className="shrink-0 text-[var(--os-text-faint)]" size="14px" />
          ) : null}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className="truncate text-[0.82rem] text-[var(--os-text-muted)] transition-colors hover:text-[var(--os-accent)]"
            >
              {item.label}
            </button>
          ) : (
            <span className="truncate text-[0.82rem] font-medium text-[var(--os-text)]">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
