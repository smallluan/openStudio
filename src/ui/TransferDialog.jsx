import { useEffect, useMemo, useState } from "react";
import { Transfer } from "tdesign-react";
import { useI18n } from "../context/I18nContext.jsx";
import Avatar from "./Avatar.jsx";
import FluidConfirmDialog from "./FluidConfirmDialog.jsx";

/**
 * @typedef {object} TransferItem
 * @property {string} key
 * @property {import("react").ReactNode} label
 * @property {import("react").ReactNode} [description]
 * @property {import("react").ReactNode | string} [icon]
 * @property {string} [searchText]
 * @property {boolean} [disabled]
 * @property {boolean} [locked]
 */

/**
 * @param {{ icon?: import("react").ReactNode | string; name?: string }} props
 */
function TransferRowIcon({ icon, name }) {
  // Explicit string icons (URL or "") use Avatar so empty glyphs fall back to text initials.
  if (typeof icon === "string") {
    const isUrl =
      Boolean(icon) &&
      (icon.startsWith("data:") ||
        icon.startsWith("http://") ||
        icon.startsWith("https://") ||
        icon.startsWith("file:") ||
        (icon.startsWith("/") && !icon.startsWith("//")));
    if (!isUrl && !name) return null;
    return <Avatar src={isUrl ? icon : ""} name={name} size="xs" shape="rounded" />;
  }

  if (!icon) return null;
  return <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>;
}

/**
 * Modal wrapper for {@link Transfer} with draft state and confirm/cancel.
 *
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   title?: string;
 *   items: TransferItem[];
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
        value: item.key,
        label: item.label,
        icon: item.icon,
        description: item.description,
        searchText: item.searchText,
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
    setDraftKeys([...new Set([...lockedKeys, ...next.map(String)])]);
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
      size="transfer"
    >
      <div className="os-transfer-dialog__wrap">
      <Transfer
        data={normalizedItems}
        value={draftKeys}
        title={[sourceTitle ?? t("transfer.sourceTitle"), targetTitle ?? t("transfer.targetTitle")]}
        empty={[emptySource ?? t("transfer.emptySource"), emptyTarget ?? t("transfer.emptyTarget")]}
        search={
          showSearch
            ? [
                { placeholder: searchPlaceholder ?? t("transfer.searchPlaceholder") },
                { placeholder: searchPlaceholder ?? t("transfer.searchPlaceholder") },
              ]
            : false
        }
        keys={{ value: "value", label: "label" }}
        transferItem={({ data }) => {
          const name =
            typeof data.label === "string"
              ? data.label
              : typeof data.searchText === "string"
                ? data.searchText
                : undefined;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <TransferRowIcon icon={data.icon} name={name} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: "18px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {data.label}
                </div>
                {data.description ? (
                  <div style={{ fontSize: 12, lineHeight: "16px", opacity: 0.72, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {data.description}
                  </div>
                ) : null}
              </div>
            </div>
          );
        }}
        onChange={handleDraftChange}
      />
      </div>
    </FluidConfirmDialog>
  );
}
