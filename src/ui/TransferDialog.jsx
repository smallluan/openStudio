import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../context/I18nContext.jsx";
import FluidConfirmDialog from "./FluidConfirmDialog.jsx";
import Transfer from "./Transfer.jsx";

/**
 * Modal wrapper for {@link Transfer} with draft state and confirm/cancel.
 *
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   title?: string;
 *   items: import("./Transfer.jsx").TransferItem[];
 *   targetKeys: string[];
 *   lockedKeys?: string[];
 *   onConfirm: (targetKeys: string[]) => void;
 *   sourceTitle?: string;
 *   targetTitle?: string;
 *   searchPlaceholder?: string;
 *   emptySource?: string;
 *   emptyTarget?: string;
 *   showSearch?: boolean;
 *   confirmLabel?: string;
 *   cancelLabel?: string;
 * }} props
 */
export default function TransferDialog({
  open,
  onOpenChange,
  title,
  items,
  targetKeys,
  lockedKeys = [],
  onConfirm,
  sourceTitle,
  targetTitle,
  searchPlaceholder,
  emptySource,
  emptyTarget,
  showSearch = true,
  confirmLabel,
  cancelLabel,
}) {
  const { t } = useI18n();
  const [draftKeys, setDraftKeys] = useState(targetKeys);

  const lockedSet = useMemo(() => new Set(lockedKeys), [lockedKeys]);

  const normalizedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        locked: item.locked || lockedSet.has(item.key),
        disabled: item.disabled || lockedSet.has(item.key),
      })),
    [items, lockedSet],
  );

  useEffect(() => {
    if (!open) return;
    setDraftKeys([...new Set([...lockedKeys, ...targetKeys])]);
  }, [open, lockedKeys, targetKeys]);

  const handleDraftChange = (next) => {
    setDraftKeys([...new Set([...lockedKeys, ...next])]);
  };

  const handleConfirm = () => {
    onConfirm(draftKeys);
  };

  return (
    <FluidConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("transfer.dialogTitle")}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={handleConfirm}
      onCancel={() => onOpenChange(false)}
      morphBr="16px"
      size="wide"
    >
      <Transfer
        items={normalizedItems}
        targetKeys={draftKeys}
        onChange={handleDraftChange}
        sourceTitle={sourceTitle}
        targetTitle={targetTitle}
        searchPlaceholder={searchPlaceholder}
        emptySource={emptySource}
        emptyTarget={emptyTarget}
        showSearch={showSearch}
      />
    </FluidConfirmDialog>
  );
}
