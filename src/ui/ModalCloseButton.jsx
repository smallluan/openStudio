import { cn } from "./cn.js";

function CloseGlyph({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ModalCloseButton({ onClick, "aria-label": ariaLabel = "关闭", className }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "os-modal-close inline-flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-transparent",
        "text-[var(--os-text-muted)] transition-colors duration-150",
        "hover:border-[var(--os-border)] hover:bg-[var(--os-bg-subtle)] hover:text-[var(--os-text)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
        className,
      )}
    >
      <CloseGlyph />
    </button>
  );
}
