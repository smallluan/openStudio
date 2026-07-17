import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { filterSkillPickList } from "../../skills/skillRegistry.js";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

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
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const optionRefs = useRef(/** @type {Array<HTMLButtonElement | null>} */ ([]));
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);

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

  const confirmHighlighted = useCallback(() => {
    const row = filtered[highlightIndex];
    if (!row) return;
    onSelect(row);
    setOpen(false);
  }, [filtered, highlightIndex, onSelect]);

  const onPopoverKeyDown = useCallback(
    /** @param {import('react').KeyboardEvent} e */
    (e) => {
      if (!present || filtered.length === 0 || e.nativeEvent.isComposing) return;
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
    [confirmHighlighted, filtered.length, present],
  );

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: (v) => {
      setOpen(v);
      if (!v) setQ("");
    },
    placement: "top-start",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  return (
    <>
      <Button
        ref={refs.setReference}
        type="button"
        className={cn("chat-lab__pill-btn", selected && "chat-lab__pill-btn--liquid")}
        disabled={disabled}
        title={t("chatLab.toolbarSkillHint")}
        aria-haspopup="listbox"
        aria-expanded={present}
        aria-controls={present ? listId : undefined}
        {...getReferenceProps()}
      >
        <span className="chat-lab__pill-ico" aria-hidden>
          {selected ? selected.emoji : "✦"}
        </span>
        {selected ? selected.label : t("chatLab.toolbarSkill")}
        <Chevron open={present} />
      </Button>

      {present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="outline-none z-[400] w-[min(100vw-2rem,320px)] max-w-[min(100vw-2rem,320px)]"
              onKeyDown={onPopoverKeyDown}
              {...getFloatingProps()}
            >
              <FluidPopupAnimatedSurface
                key={surfaceKey}
                leaving={leaving}
                finishLeave={finishLeave}
                placement={context.placement}
                morphBr="14px"
                className={cn(
                  "chat-lab__skill-popover flex w-full flex-col overflow-hidden rounded-[14px] border",
                  "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
                  "shadow-[var(--os-shadow-soft)]",
                )}
              >
              <div className="border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-2.5 py-2">
                <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--os-text-faint)]">
                  {t("chatLab.skillPickerTitle")}
                </div>
                <input
                  className={cn(
                    "mt-1.5 box-border h-8 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2 text-[0.8125rem]",
                    "text-[var(--os-text)] placeholder:text-[var(--os-text-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
                  )}
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("chatLab.skillPickerSearch")}
                  aria-label={t("chatLab.skillPickerSearch")}
                />
              </div>
              <div id={listId} role="listbox" className="max-h-[min(52vh,280px)] overflow-y-auto py-1">
                <Button
                  type="button"
                  role="option"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8rem] text-[var(--os-text-muted)] hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_55%,transparent)]"
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
                      aria-selected={index === highlightIndex}
                      className={cn(
                        "chat-lab__skill-popover-option flex w-full items-start gap-2.5 px-3 py-2 text-left",
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
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
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
  const optionRefs = useRef(/** @type {Array<HTMLButtonElement | null>} */ ([]));
  const filtered = useMemo(() => filterSkillPickList(skills, filterQuery), [skills, filterQuery]);

  useEffect(() => {
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, filtered.length]);

  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: (v) => {
      if (!v) onClose();
    },
    placement: "top-start",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (present && el) refs.setReference(el);
  }, [present, refs.setReference, textareaRef]);

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  if (!present) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="outline-none z-[400] w-[min(100vw-2rem,300px)] max-w-[min(100vw-2rem,300px)]"
        {...getFloatingProps()}
        onMouseDownCapture={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => e.preventDefault()}
      >
        <FluidPopupAnimatedSurface
          key={surfaceKey}
          leaving={leaving}
          finishLeave={finishLeave}
          placement={context.placement}
          morphBr="14px"
          className={cn(
            "chat-lab__skill-popover flex w-full flex-col overflow-hidden rounded-[14px] border",
            "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
            "shadow-[var(--os-shadow-soft)]",
          )}
        >
        <div className="border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-2.5 py-1.5 text-[0.68rem] text-[var(--os-text-faint)]">
          {t("chatLab.skillPickerTitle")}
        </div>
        <div id={listId} role="listbox" className="max-h-[min(44vh,240px)] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-[0.78rem] text-[var(--os-text-faint)]">{t("chatLab.skillPickerEmpty")}</div>
          ) : (
            filtered.map((row, index) => (
              <Button
                key={row.id}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={index === highlightIndex}
                className={cn(
                  "chat-lab__skill-popover-option flex w-full items-start gap-2.5 px-3 py-2 text-left",
                  index === highlightIndex && "chat-lab__skill-popover-option--active",
                )}
                onMouseEnter={() => onHighlightIndexChange?.(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(row)}
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
        </FluidPopupAnimatedSurface>
      </div>
    </FloatingPortal>
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
