import { Dialog } from "tdesign-react";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "./cn.js";

/**
 * Confirm dialog backed by TDesign Dialog.
 *
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   title?: string;
 *   children: import("react").ReactNode;
 *   confirmLabel?: string;
 *   cancelLabel?: string;
 *   onConfirm?: () => void;
 *   onCancel?: () => void;
 *   danger?: boolean;
 *   morphBr?: string;
 *   size?: "default" | "wide" | "transfer";
 * }} props
 */
const DIALOG_WIDTH = {
  default: 480,
  wide: 720,
  transfer: 860,
};

export default function FluidConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger = false,
  size = "default",
}) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("dialog.titleDefault");
  const confirmText = confirmLabel ?? t("dialog.confirm");
  const cancelText = cancelLabel ?? t("dialog.cancel");

  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog
      visible={open}
      attach="body"
      placement="center"
      header={resolvedTitle}
      theme={danger ? "danger" : "default"}
      width={DIALOG_WIDTH[size] ?? DIALOG_WIDTH.default}
      zIndex={6000}
      destroyOnClose={false}
      closeOnOverlayClick
      closeOnEscKeydown
      confirmBtn={{ content: confirmText, theme: danger ? "danger" : "primary" }}
      cancelBtn={{ content: cancelText, variant: "outline" }}
      dialogClassName={cn(
        "os-tdesign-dialog",
        size === "wide" && "os-tdesign-dialog--wide",
        size === "transfer" && "os-tdesign-dialog--transfer",
      )}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      onClose={({ trigger }) => {
        if (trigger === "confirm" || trigger === "cancel") return;
        handleCancel();
      }}
    >
      {children}
    </Dialog>
  );
}
