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
import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { filterSkillPickList } from "../../skills/skillRegistry.js";
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
      <button
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
      </button>
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

  const filtered = useMemo(() => filterSkillPickList(skills, q), [skills, q]);

  const { refs, floatingStyles, context } = useFloating({
    open,
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
      <button
        ref={refs.setReference}
        type="button"
        className="chat-lab__pill-btn"
        disabled={disabled}
        title={t("chatLab.toolbarSkillHint")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        {...getReferenceProps()}
      >
        <span className="chat-lab__pill-ico" aria-hidden>
          {selected ? selected.emoji : "✦"}
        </span>
        {selected ? selected.label : t("chatLab.toolbarSkill")}
        <Chevron open={open} />
      </button>

      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={cn(
                "chat-lab__skill-popover z-[400] flex w-[min(100vw-2rem,320px)] flex-col overflow-hidden rounded-[14px] border",
                "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
                "shadow-[var(--os-shadow-soft)]",
              )}
              {...getFloatingProps()}
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
                <button
                  type="button"
                  role="option"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8rem] text-[var(--os-text-muted)] hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_55%,transparent)]"
                  onClick={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                >
                  {t("chatLab.skillPickerClear")}
                </button>
                {filtered.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[0.78rem] text-[var(--os-text-faint)]">
                    {t("chatLab.skillPickerEmpty")}
                  </div>
                ) : (
                  filtered.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="option"
                      className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_55%,transparent)]"
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
                    </button>
                  ))
                )}
              </div>
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
 *   onPick: (row: import("../../skills/skillRegistry.js").SkillPickRow) => void;
 *   onClose: () => void;
 *   t: (k: string) => string;
 * }} props
 */
export function ComposerSkillSlashPopover({ open, textareaRef, filterQuery, skills, onPick, onClose, t }) {
  const autoId = useId();
  const listId = `${autoId}-slash-skills`;
  const filtered = useMemo(() => filterSkillPickList(skills, filterQuery), [skills, filterQuery]);

  const { refs, floatingStyles, context } = useFloating({
    open,
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
    if (open && el) refs.setReference(el);
  }, [open, refs.setReference, textareaRef]);

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  if (!open) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={cn(
          "chat-lab__skill-popover z-[400] flex w-[min(100vw-2rem,300px)] flex-col overflow-hidden rounded-[14px] border",
          "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
          "shadow-[var(--os-shadow-soft)]",
        )}
        {...getFloatingProps()}
      >
        <div className="border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-2.5 py-1.5 text-[0.68rem] text-[var(--os-text-faint)]">
          {t("chatLab.skillPickerTitle")}
        </div>
        <div id={listId} role="listbox" className="max-h-[min(44vh,240px)] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-[0.78rem] text-[var(--os-text-faint)]">{t("chatLab.skillPickerEmpty")}</div>
          ) : (
            filtered.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_55%,transparent)]"
                onClick={() => onPick(row)}
              >
                <span className="text-lg leading-none" aria-hidden>
                  {row.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.82rem] font-medium text-[var(--os-text)]">{row.label}</span>
                  <span className="mt-0.5 line-clamp-2 text-[0.72rem] text-[var(--os-text-muted)]">{row.description}</span>
                </span>
              </button>
            ))
          )}
        </div>
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
