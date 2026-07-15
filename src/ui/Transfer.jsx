import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useI18n } from "../context/I18nContext.jsx";
import { getColorFromString, getInitials } from "./Avatar.jsx";
import Checkbox from "./Checkbox.jsx";
import { cn } from "./cn.js";

/** Render an item icon: URL string → <img>, ReactNode → as-is, empty → colored text-initial badge. */
function RowIcon({ icon, label }) {
  const isUrl =
    typeof icon === "string" &&
    (icon.startsWith("data:") ||
      icon.startsWith("http://") ||
      icon.startsWith("https://") ||
      icon.startsWith("file:") ||
      (icon.startsWith("/") && !icon.startsWith("//")));

  const labelText = typeof label === "string" ? label : "";
  const initial = getInitials(labelText) || "?";
  const colorClass = getColorFromString(labelText);

  if (icon) {
    return (
      <span className="os-transfer__row-icon">
        {isUrl ? (
          <img src={icon} alt="" className="os-transfer__row-icon-img" draggable={false} />
        ) : (
          icon
        )}
      </span>
    );
  }

  return (
    <span
      className={cn("os-transfer__row-icon os-transfer__row-icon-fallback flex items-center justify-center font-semibold text-gray-700", colorClass)}
      style={{ width: "1.4rem", height: "1.4rem", fontSize: "0.75rem", borderRadius: "6px" }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

/**
 * @typedef {object} TransferItem
 * @property {string} key
 * @property {import("react").ReactNode} label
 * @property {import("react").ReactNode} [description]
 * @property {import("react").ReactNode} [icon]
 * @property {string} [searchText]
 * @property {boolean} [disabled]
 * @property {boolean} [locked]
 */

/**
 * Generic shuttle / transfer picker — two lists with move controls.
 *
 * @param {{
 *   items: TransferItem[];
 *   targetKeys: string[];
 *   onChange: (targetKeys: string[]) => void;
 *   sourceTitle?: string;
 *   targetTitle?: string;
 *   searchPlaceholder?: string;
 *   emptySource?: string;
 *   emptyTarget?: string;
 *   showSearch?: boolean;
 *   className?: string;
 * }} props
 */
export default function Transfer({
  items,
  targetKeys,
  onChange,
  sourceTitle,
  targetTitle,
  searchPlaceholder,
  emptySource,
  emptyTarget,
  showSearch = true,
  className,
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [sourceSelected, setSourceSelected] = useState(() => new Set());
  const [targetSelected, setTargetSelected] = useState(() => new Set());

  const itemByKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const targetSet = useMemo(() => new Set(targetKeys), [targetKeys]);
  const lockedKeys = useMemo(
    () => new Set(items.filter((item) => item.locked).map((item) => item.key)),
    [items],
  );

  const normalizedQuery = query.trim().toLowerCase();

  const matchesQuery = useCallback(
    /** @param {TransferItem} item */
    (item) => {
      if (!normalizedQuery) return true;
      const hay = (item.searchText ?? (typeof item.label === "string" ? item.label : "")).toLowerCase();
      return hay.includes(normalizedQuery);
    },
    [normalizedQuery],
  );

  const sourceItems = useMemo(
    () => items.filter((item) => !targetSet.has(item.key) && !item.disabled && matchesQuery(item)),
    [items, targetSet, matchesQuery],
  );

  const targetItems = useMemo(
    () =>
      targetKeys
        .map((key) => itemByKey.get(key))
        .filter((item) => item && matchesQuery(item)),
    [targetKeys, itemByKey, matchesQuery],
  );

  const selectableSourceKeys = useMemo(
    () => sourceItems.filter((item) => !item.disabled).map((item) => item.key),
    [sourceItems],
  );

  const removableTargetKeys = useMemo(
    () => targetItems.filter((item) => !item.locked).map((item) => item.key),
    [targetItems],
  );

  const sourceAllChecked =
    selectableSourceKeys.length > 0 && selectableSourceKeys.every((key) => sourceSelected.has(key));
  const targetAllChecked =
    removableTargetKeys.length > 0 && removableTargetKeys.every((key) => targetSelected.has(key));

  const commitTargetKeys = useCallback(
    /** @param {string[]} next */
    (next) => {
      const merged = [...new Set([...lockedKeys, ...next])];
      onChange(merged);
      setSourceSelected(new Set());
      setTargetSelected(new Set());
    },
    [lockedKeys, onChange],
  );

  const moveToTarget = useCallback(
    /** @param {string[]} keys */
    (keys) => {
      if (!keys.length) return;
      commitTargetKeys([...targetKeys, ...keys]);
    },
    [commitTargetKeys, targetKeys],
  );

  const moveToSource = useCallback(
    /** @param {string[]} keys */
    (keys) => {
      if (!keys.length) return;
      const remove = new Set(keys.filter((key) => !lockedKeys.has(key)));
      commitTargetKeys(targetKeys.filter((key) => !remove.has(key)));
    },
    [commitTargetKeys, lockedKeys, targetKeys],
  );

  const toggleSource = useCallback(
    /** @param {string} key */
    (key) => {
      setSourceSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  const toggleTarget = useCallback(
    /** @param {string} key */
    (key) => {
      if (lockedKeys.has(key)) return;
      setTargetSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [lockedKeys],
  );

  const toggleSourceAll = useCallback(() => {
    setSourceSelected((prev) => {
      if (sourceAllChecked) return new Set();
      return new Set(selectableSourceKeys);
    });
  }, [sourceAllChecked, selectableSourceKeys]);

  const toggleTargetAll = useCallback(() => {
    setTargetSelected((prev) => {
      if (targetAllChecked) return new Set();
      return new Set(removableTargetKeys);
    });
  }, [targetAllChecked, removableTargetKeys]);

  const resolvedSourceTitle = sourceTitle ?? t("transfer.sourceTitle");
  const resolvedTargetTitle = targetTitle ?? t("transfer.targetTitle");
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("transfer.searchPlaceholder");
  const resolvedEmptySource = emptySource ?? t("transfer.emptySource");
  const resolvedEmptyTarget = emptyTarget ?? t("transfer.emptyTarget");

  return (
    <div className={cn("os-transfer", className)}>
      <div className="os-transfer__panel">
        <div className="os-transfer__panel-head">
          <Checkbox
            tone="toolbar"
            checked={sourceAllChecked}
            disabled={selectableSourceKeys.length === 0}
            onCheckedChange={toggleSourceAll}
            label={
              <span className="os-transfer__panel-title">
                {resolvedSourceTitle}
                <span className="os-transfer__panel-count">{sourceItems.length}</span>
              </span>
            }
            className="chat-lab__orch-check os-transfer__panel-check"
          />
        </div>
        {showSearch ? (
          <label className="os-transfer__search">
            <Search className="os-transfer__search-icon" aria-hidden />
            <input
              type="search"
              className="os-transfer__search-input"
              value={query}
              placeholder={resolvedSearchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={resolvedSearchPlaceholder}
            />
          </label>
        ) : null}
        <ul className="os-transfer__list" role="listbox" aria-multiselectable="true" style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {sourceItems.length ? (
            sourceItems.map((item) => {
              const checked = sourceSelected.has(item.key);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={cn("os-transfer__row", checked && "os-transfer__row--selected")}
                    onClick={() => toggleSource(item.key)}
                  >
                    <span
                      className={cn("os-transfer__row-check", checked && "os-transfer__row-check--on")}
                      aria-hidden
                    >
                      {checked ? (
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                          <path
                            d="M2 5.5 4.2 7.7 9 2.8"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <RowIcon icon={item.icon} label={item.label} />
                    <span className="os-transfer__row-body">
                      <span className="os-transfer__row-label">{item.label}</span>
                      {item.description ? (
                        <span className="os-transfer__row-desc">{item.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="os-transfer__empty">{resolvedEmptySource}</li>
          )}
        </ul>
      </div>

      <div className="os-transfer__actions" aria-label={t("transfer.actionsAria")}>
        <button
          type="button"
          className="os-transfer__action-btn"
          disabled={sourceSelected.size === 0}
          aria-label={t("transfer.moveSelectedRight")}
          title={t("transfer.moveSelectedRight")}
          onClick={() => moveToTarget([...sourceSelected])}
        >
          <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
        </button>
        <button
          type="button"
          className="os-transfer__action-btn"
          disabled={selectableSourceKeys.length === 0}
          aria-label={t("transfer.moveAllRight")}
          title={t("transfer.moveAllRight")}
          onClick={() => moveToTarget(selectableSourceKeys)}
        >
          <ChevronsRight size={16} strokeWidth={2.2} aria-hidden />
        </button>
        <button
          type="button"
          className="os-transfer__action-btn"
          disabled={targetSelected.size === 0}
          aria-label={t("transfer.moveSelectedLeft")}
          title={t("transfer.moveSelectedLeft")}
          onClick={() => moveToSource([...targetSelected])}
        >
          <ChevronLeft size={16} strokeWidth={2.2} aria-hidden />
        </button>
        <button
          type="button"
          className="os-transfer__action-btn"
          disabled={removableTargetKeys.length === 0}
          aria-label={t("transfer.moveAllLeft")}
          title={t("transfer.moveAllLeft")}
          onClick={() => moveToSource(removableTargetKeys)}
        >
          <ChevronsLeft size={16} strokeWidth={2.2} aria-hidden />
        </button>
      </div>

      <div className="os-transfer__panel">
        <div className="os-transfer__panel-head">
          <Checkbox
            tone="toolbar"
            checked={targetAllChecked}
            disabled={removableTargetKeys.length === 0}
            onCheckedChange={toggleTargetAll}
            label={
              <span className="os-transfer__panel-title">
                {resolvedTargetTitle}
                <span className="os-transfer__panel-count">{targetItems.length}</span>
              </span>
            }
            className="chat-lab__orch-check os-transfer__panel-check"
          />
        </div>
        <ul className="os-transfer__list" role="listbox" aria-multiselectable="true" style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {targetItems.length ? (
            targetItems.map((item) => {
              const checked = targetSelected.has(item.key);
              const locked = Boolean(item.locked);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    aria-disabled={locked || undefined}
                    disabled={locked}
                    className={cn(
                      "os-transfer__row",
                      checked && "os-transfer__row--selected",
                      locked && "os-transfer__row--locked",
                    )}
                    onClick={() => toggleTarget(item.key)}
                  >
                    <span
                      className={cn(
                        "os-transfer__row-check",
                        checked && "os-transfer__row-check--on",
                        locked && "os-transfer__row-check--locked",
                      )}
                      aria-hidden
                    >
                      {checked ? (
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                          <path
                            d="M2 5.5 4.2 7.7 9 2.8"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <RowIcon icon={item.icon} label={item.label} />
                    <span className="os-transfer__row-body">
                      <span className="os-transfer__row-label">{item.label}</span>
                      {item.description ? (
                        <span className="os-transfer__row-desc">{item.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="os-transfer__empty">{resolvedEmptyTarget}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
