import { useI18n } from "../context/I18nContext.jsx";
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

export default function ModalCloseButton({ onClick, "aria-label": ariaLabel, className }) {
  const { t } = useI18n();
  const label = ariaLabel ?? t("modalClose.close");
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "os-modal-close inline-flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-transparent",
        "text-[var(--os-text-muted)] transition-[background,color] duration-150 ease-out",
        "hover:bg-[#e05454] hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
        className,
      )}
    >
      <CloseGlyph />
    </button>
  );
}
