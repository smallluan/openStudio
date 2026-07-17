import { cn } from "../../ui/cn.js";
import { Button } from "@open-studio/udesign";
import { emojiForFileRefKind } from "../../chat/chatLabComposerFileRefs.js";

/**
 * @param {{
 *   row: import("../../chat/chatLabComposerFileRefs.js").ComposerFileRef;
 *   onClear: () => void;
 *   disabled?: boolean;
 *   t: (k: string) => string;
 * }} props
 */
export function ComposerFileRefChip({ row, onClear, disabled, t }) {
  const emoji = emojiForFileRefKind(row.kind);
  const kindLabel =
    row.kind === "directory" ? t("chatLab.fileRefKindFolder") : t("chatLab.fileRefKindFile");
  return (
    <span className="chat-lab__skill-chip chat-lab__file-chip" title={`${row.path}\n(${kindLabel})`}>
      <span className="chat-lab__skill-chip-ico" aria-hidden>
        {emoji}
      </span>
      <span className="chat-lab__skill-chip-label">{row.name}</span>
      <Button
                variant="text"
                size="small"
        type="button"
        className="chat-lab__skill-chip-x"
        disabled={disabled}
        onClick={onClear}
        aria-label={t("chatLab.fileRefChipClose")}
        title={t("chatLab.fileRefChipClose")}
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
 *   refs: import("../../chat/chatLabComposerFileRefs.js").ComposerFileRef[];
 *   leaving?: boolean;
 *   onRemove: (id: string) => void;
 *   disabled?: boolean;
 *   t: (k: string) => string;
 * }} props
 */
export function ComposerFileRefRow({ refs, leaving, onRemove, disabled, t }) {
  if (!refs.length && !leaving) return null;
  return (
    <div
      className={cn("chat-lab__shell-skill-row", leaving && "chat-lab__shell-skill-row--leaving")}
      aria-label={t("chatLab.composerFileRefsLabel")}
    >
      {refs.map((row) => (
        <ComposerFileRefChip
          key={row.id}
          row={row}
          disabled={disabled}
          onClear={() => onRemove(row.id)}
          t={t}
        />
      ))}
    </div>
  );
}
