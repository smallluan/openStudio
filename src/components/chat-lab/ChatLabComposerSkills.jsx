import { Puzzle, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Popup, Select as TSelect } from "tdesign-react";
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

/** @param {{ row: import("../../skills/skillRegistry.js").SkillPickRow; index: number; highlightIndex: number; onPick: (row: import("../../skills/skillRegistry.js").SkillPickRow) => void; optionRef?: (node: HTMLButtonElement | null) => void; }} props */
function SkillPopoverOption({ row, index, highlightIndex, onPick, optionRef }) {
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
  const scrollHighlightIntoViewRef = useRef(false);

  const filtered = useMemo(() => filterSkillPickList(skills, q), [skills, q]);
  const skillOptions = useMemo(
    () => skills.map((row) => ({ value: row.id, label: row.label })),
    [skills],
  );

  useEffect(() => {
    scrollHighlightIntoViewRef.current = true;
    setHighlightIndex(0);
  }, [q, open]);

  useEffect(() => {
    setHighlightIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    if (!scrollHighlightIntoViewRef.current) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
    scrollHighlightIntoViewRef.current = false;
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
        scrollHighlightIntoViewRef.current = true;
        setHighlightIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollHighlightIntoViewRef.current = true;
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
      className="chat-lab__skill-popover"
      onKeyDown={onPopoverKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="chat-lab__skill-popover-search">
        <Input
          ref={inputRef}
          block
          borderless
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
      <div id={listId} role="listbox" className="chat-lab__skill-popover-list">
        {selected ? (
          <button
            type="button"
            role="option"
            className="chat-lab__skill-popover-option chat-lab__skill-popover-option--clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            {t("chatLab.skillPickerClear")}
          </button>
        ) : null}
        {filtered.length === 0 ? (
          <div className="chat-lab__skill-popover-empty">{t("chatLab.skillPickerEmpty")}</div>
        ) : (
          filtered.map((row, index) => (
            <SkillPopoverOption
              key={row.id}
              row={row}
              index={index}
              highlightIndex={highlightIndex}
              onPick={(picked) => {
                onSelect(picked);
                setOpen(false);
              }}
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
    <TSelect
      id="chat-toolbar-skill"
      borderless
      clearable={Boolean(selected)}
      autoWidth
      prefixIcon={<Puzzle size={14} strokeWidth={2} aria-hidden />}
      className={cn("chat-lab__pill-skill", open && "chat-lab__pill-skill--open")}
      disabled={disabled}
      title={t("chatLab.toolbarSkillHint")}
      placeholder={t("chatLab.toolbarSkill")}
      value={selected?.id ?? ""}
      options={skillOptions}
      empty={null}
      panelTopContent={popupContent}
      popupVisible={open}
      onPopupVisibleChange={(visible) => {
        setOpen(visible);
        if (!visible) setQ("");
      }}
      onChange={(value) => {
        if (!value) onSelect(null);
      }}
      onClear={() => onSelect(null)}
      valueDisplay={selected ? () => `${selected.emoji} ${selected.label}` : undefined}
      selectInputProps={{
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        "aria-controls": open ? listId : undefined,
      }}
      popupProps={{
        attach: () => document.body,
        placement: "top-start",
        zIndex: 400,
        destroyOnClose: false,
        overlayClassName: OS_POPUP_OVERLAY_CLASS,
        overlayInnerClassName: cn(OS_POPUP_INNER_CLASS, "chat-lab__pill-skill-popup"),
        overlayInnerStyle: { overflow: "visible", maxHeight: "none" },
        popperOptions: osPopupPopperOptions(8, 8),
      }}
    />
  );
}

/**
 * @param {{
 *   row: import("../../skills/skillRegistry.js").SkillPickRow;
 *   index: number;
 *   highlightIndex: number;
 *   onPick: (row: import("../../skills/skillRegistry.js").SkillPickRow) => void;
 *   optionRef?: (node: HTMLButtonElement | null) => void;
 * }} props
 */
function SkillSlashPopoverOption(props) {
  return <SkillPopoverOption {...props} />;
}

/**
 * Slash-triggered picker anchored above the composer textarea (not at the caret rect).
 * @param {{
 *   open: boolean;
 *   textareaRef: import("react").RefObject<HTMLTextAreaElement | null>;
 *   filterQuery: string;
 *   skills: import("../../skills/skillRegistry.js").SkillPickRow[];
 *   highlightIndex?: number;
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
    if (!open) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  const popupContent = (
    <div
      className="chat-lab__skill-popover"
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
    >
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
