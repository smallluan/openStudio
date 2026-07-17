import { createPortal } from "react-dom";
import { Button } from "@open-studio/udesign";
import { useEffect } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import ModalCloseButton from "../../ui/ModalCloseButton.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   open: boolean;
 *   title: string;
 *   error?: string | null;
 *   confirmDisabled?: boolean;
 *   onCancel: () => void;
 *   onConfirm: () => void;
 *   children: import("react").ReactNode;
 * }} props
 */
export default function ModelProfileEditorDialog({
  open,
  title,
  error,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-4 sm:p-6" role="presentation">
      <Button
        type="button"
        className="os-modal-backdrop absolute inset-0"
        aria-label={t("dialog.cancel")}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-profile-editor-title"
        className={cn(
          "os-modal-panel relative flex max-h-[min(84vh,560px)] w-full max-w-[27rem] flex-col overflow-hidden rounded-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2.5">
          <h2 id="model-profile-editor-title" className="min-w-0 truncate text-[0.9rem] font-semibold tracking-tight">
            {title}
          </h2>
          <ModalCloseButton onClick={onCancel} className="size-8 rounded-[9px]" aria-label={t("dialog.cancel")} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1 pt-0">{children}</div>

        {error ?
          <p role="alert" className="shrink-0 px-4 pb-1 text-[0.72rem] leading-snug text-[var(--os-accent)]">
            {error}
          </p>
        : null}

        <footer className="flex shrink-0 items-center justify-end gap-2 px-4 pb-2.5 pt-2">
          <Button
            type="button"
            className="rounded-md border-none bg-transparent px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--os-text-muted)] hover:text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]"
            onClick={onCancel}
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            type="button"
            className="btn-primary px-4 py-1.5 text-[0.8125rem] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {t("dialog.confirm")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
