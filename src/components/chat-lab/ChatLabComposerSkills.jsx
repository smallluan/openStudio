import { Search } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Popup } from "tdesign-react";
import { Button, Input } from "@open-studio/udesign";
import { filterSkillPickList } from "../../skills/skillRegistry.js";
import {
  OS_POPUP_ANCHOR_CLASS,
  OS_POPUP_INNER_CLASS,
  OS_POPUP_OVERLAY_CLASS,
  osPopupPopperOptions,
} from "../../ui/osPopupShared.js";
import { useVirtualPopupAnchor } from "../../ui/useVirtualPopupAnchor.js";
import { cn } from "../../ui/cn.js";

function Chevron({ open }) {
  return (
    <svg
      className={cn("chat-lab__pill-chevron shrink-0 transition-transform duration-200", open && "rotate-180")}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** @param {{ row: import("../../skills/skillRegistry.js").SkillPickRow; onClear: () => void; disabled?: boolean; t: (k: string) => string }} props */
export function ComposerSkillChip({ row, onClear, disabled, t }) {
  return (
    <span className="chat-lab__skill-chip">
      <span className="chat-lab__skill-chip-ico" aria-hidden>
        {row.emoji}
      </span>
      <span className="chat-lab__skill-chip-label">{row.label}</span>
      <Button
        type="button"
        variant="text"
        shape="circle"
        size="small"
        className="chat-lab__skill-chip-x"
        disabled={disabled}
        onClick={onClear}
        aria-label={t("chatLab.skillChipClose")}
        title={t("chatLab.skillChipClose")}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </Button>
    </span>
  );
}

/**
 * @param {{
 *   skills: import("../../skills/skillRegistry.js").SkillPickRow[];
 *   selected: import("../../skills/skillRegistry.js").SkillPickRow | null;
 *   onSelect: (row: import("../../skills/skillRegistry.js").SkillPickRow | null) => void;
 *   disabled?: boolean;
 *   t: (k: string) => string;
 * }} props
 */
export function ComposerSkillToolbarPicker({ skills, selected, onSelect, disabled, t }) {
  const autoId = useId();
  const listId = `${autoId}-skill-list`;
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const optionRefs = useRef(/** @type {Array<HTMLButtonElement | null>} */ ([]));

  const filtered = useMemo(() => filterSkillPickList(skills, q), [skills, q]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [q, open]);

  useEffect(() => {
    setHighlightIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, filtered.length]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    setQ("");
    return undefined;
  }, [open]);

  const confirmHighlighted = useCallback(() => {
    const row = filtered[highlightIndex];
    if (!row) return;
    onSelect(row);
    setOpen(false);
  }, [filtered, highlightIndex, onSelect]);

  const onPopoverKeyDown = useCallback(
    /** @param {import('react').KeyboardEvent} e */
    (e) => {
      if (!open || filtered.length === 0 || e.nativeEvent.isComposing) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        confirmHighlighted();
      }
    },
    [confirmHighlighted, filtered.length, open],
  );

  const popupContent = (
    <div
      className={cn(
        "chat-lab__skill-popover flex w-full flex-col overflow-hidden rounded-[14px] border",
        "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
        "shadow-[var(--os-shadow-soft)]",
      )}
      onKeyDown={onPopoverKeyDown}
    >
      <div className="border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-2.5 py-2">
        <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--os-text-faint)]">
          {t("chatLab.skillPickerTitle")}
        </div>
        <div className="mt-1.5">
          <Input
            ref={inputRef}
            block
            clearable
            size="small"
            type="search"
            prefixIcon={<Search size={14} aria-hidden />}
            value={q}
            onChange={(value) => setQ(value)}
            placeholder={t("chatLab.skillPickerSearch")}
            aria-label={t("chatLab.skillPickerSearch")}
          />
        </div>
      </div>
      <div id={listId} role="listbox" className="max-h-[min(52vh,280px)] overflow-y-auto py-1">
        <Button
          type="button"
          role="option"
          variant="text"
          block
          className="chat-lab__skill-popover-option w-full"
          onClick={() => {
            onSelect(null);
            setOpen(false);
          }}
        >
          {t("chatLab.skillPickerClear")}
        </Button>
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[0.78rem] text-[var(--os-text-faint)]">
            {t("chatLab.skillPickerEmpty")}
          </div>
        ) : (
          filtered.map((row, index) => (
            <Button
              key={row.id}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              variant="text"
              block
              aria-selected={index === highlightIndex}
              className={cn(
                "chat-lab__skill-popover-option w-full",
                index === highlightIndex && "chat-lab__skill-popover-option--active",
              )}
              onMouseEnter={() => setHighlightIndex(index)}
              onClick={() => {
                onSelect(row);
                setOpen(false);
              }}
            >
              <span className="text-lg leading-none" aria-hidden>
                {row.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.82rem] font-medium text-[var(--os-text)]">{row.label}</span>
                <span className="mt-0.5 line-clamp-2 text-[0.72rem] text-[var(--os-text-muted)]">{row.description}</span>
              </span>
            </Button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popup
      visible={open}
      trigger="click"
      placement="top-start"
      attach="body"
      zIndex={400}
      disabled={disabled}
      destroyOnClose={false}
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={cn(OS_POPUP_INNER_CLASS, "w-[min(100vw-2rem,320px)]")}
      popperOptions={osPopupPopperOptions(8, 8)}
      content={popupContent}
      onVisibleChange={(visible) => {
        setOpen(visible);
        if (!visible) setQ("");
      }}
    >
      <Button
        type="button"
        variant="outline"
        shape="round"
        size="small"
        className={cn("chat-lab__pill-btn", selected && "chat-lab__pill-btn--liquid")}
        disabled={disabled}
        title={t("chatLab.toolbarSkillHint")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="chat-lab__pill-ico" aria-hidden>
          {selected ? selected.emoji : "✦"}
        </span>
        {selected ? selected.label : t("chatLab.toolbarSkill")}
        <Chevron open={open} />
      </Button>
    </Popup>
  );
}

/**
 * @param {{
 *   row: import("../../skills/skillRegistry.js").SkillPickRow;
 *   index: number;
 *   highlightIndex: number;
 *   onHighlightIndexChange?: (index: number) => void;
 *   onPick: (row: import("../../skills/skillRegistry.js").SkillPickRow) => void;
 *   optionRef?: (node: HTMLButtonElement | null) => void;
 * }} props
 */
function SkillSlashPopoverOption({ row, index, highlightIndex, onHighlightIndexChange, onPick, optionRef }) {
  return (
    <button
      ref={optionRef}
      type="button"
      role="option"
      aria-selected={index === highlightIndex}
      className={cn(
        "chat-lab__skill-popover-option",
        index === highlightIndex && "chat-lab__skill-popover-option--active",
      )}
      onMouseEnter={() => onHighlightIndexChange?.(index)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(row)}
    >
      <span className="chat-lab__skill-popover-option-emoji" aria-hidden>
        {row.emoji}
      </span>
      <span className="chat-lab__skill-popover-option-body">
        <span className="chat-lab__skill-popover-option-label">{row.label}</span>
        {row.description ? (
          <span className="chat-lab__skill-popover-option-desc">{row.description}</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Slash-triggered picker anchored above the composer textarea (not at the caret rect).
 * @param {{
 *   open: boolean;
 *   textareaRef: import("react").RefObject<HTMLTextAreaElement | null>;
 *   filterQuery: string;
 *   skills: import("../../skills/skillRegistry.js").SkillPickRow[];
 *   highlightIndex?: number;
 *   onHighlightIndexChange?: (index: number) => void;
 *   onPick: (row: import("../../skills/skillRegistry.js").SkillPickRow) => void;
 *   onClose: () => void;
 *   t: (k: string) => string;
 * }} props
 */
export function ComposerSkillSlashPopover({
  open,
  textareaRef,
  filterQuery,
  skills,
  highlightIndex = 0,
  onHighlightIndexChange,
  onPick,
  onClose,
  t,
}) {
  const autoId = useId();
  const listId = `${autoId}-slash-skills`;
  const popupRef = useRef(/** @type {import("tdesign-react").PopupInstanceFunctions | null} */ (null));
  const optionRefs = useRef(/** @type {Array<HTMLButtonElement | null>} */ ([]));
  const filtered = useMemo(() => filterSkillPickList(skills, filterQuery), [skills, filterQuery]);

  const getRect = useCallback(() => textareaRef.current?.getBoundingClientRect() ?? null, [textareaRef]);
  const { anchorRef } = useVirtualPopupAnchor({ open, getRect, popupRef });

  useEffect(() => {
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, filtered.length, open]);

  const popupContent = (
    <div
      className="chat-lab__skill-popover"
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className="chat-lab__skill-popover-header">{t("chatLab.skillPickerTitle")}</div>
      <div id={listId} role="listbox" className="chat-lab__skill-popover-list">
        {filtered.length === 0 ? (
          <div className="chat-lab__skill-popover-empty">{t("chatLab.skillPickerEmpty")}</div>
        ) : (
          filtered.map((row, index) => (
            <SkillSlashPopoverOption
              key={row.id}
              row={row}
              index={index}
              highlightIndex={highlightIndex}
              onHighlightIndexChange={onHighlightIndexChange}
              onPick={onPick}
              optionRef={(node) => {
                optionRefs.current[index] = node;
              }}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popup
      ref={popupRef}
      visible={open}
      attach="body"
      placement="top-left"
      trigger="click"
      zIndex={4000}
      destroyOnClose={false}
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={cn(OS_POPUP_INNER_CLASS, "w-[min(100vw-2rem,320px)]")}
      popperOptions={osPopupPopperOptions(8, 8)}
      content={popupContent}
      onVisibleChange={(visible) => {
        if (!visible) onClose();
      }}
    >
      <span ref={anchorRef} className={OS_POPUP_ANCHOR_CLASS} aria-hidden />
    </Popup>
  );
}

/**
 * Remove a leading `/query` on the first line after choosing a skill.
 * @param {string} input
 */
export function stripSlashPickerPrefix(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;
  const [first, ...rest] = lines;
  if (!first.startsWith("/")) return input;
  const next = rest.join("\n");
  return next.length ? next : "";
}

/** @param {string} text @param {boolean} hasChip */
export function isSlashOnlyComposerDraft(text, hasChip) {
  if (hasChip) return false;
  const head = text.split("\n")[0] ?? "";
  if (!head.startsWith("/")) return false;
  if (text.includes("\n")) return false;
  return true;
}
