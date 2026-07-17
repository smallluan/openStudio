import { Dialog } from "tdesign-react";
import { useI18n } from "../../context/I18nContext.jsx";

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

  return (
    <Dialog
      visible={open}
      attach="body"
      placement="center"
      header={title}
      width={432}
      zIndex={2600}
      destroyOnClose={false}
      closeOnOverlayClick
      closeOnEscKeydown
      dialogClassName="os-tdesign-dialog os-tdesign-dialog--model-profile"
      onClose={onCancel}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmBtn={{ content: t("dialog.confirm"), disabled: confirmDisabled }}
      cancelBtn={{ content: t("dialog.cancel"), variant: "outline" }}
    >
      {error ?
        <p role="alert" className="mb-2 text-[0.72rem] leading-snug text-[var(--os-accent)]">
          {error}
        </p>
      : null}
      {children}
    </Dialog>
  );
}
