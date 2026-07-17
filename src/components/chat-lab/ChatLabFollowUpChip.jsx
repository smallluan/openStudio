import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@open-studio/udesign";
import { followUpPreviewText } from "../../chat/chatLabFollowUp.js";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   agentName: string;
 *   quoteText: string;
 *   onNavigate: () => void;
 *   onClear?: () => void;
 *   disabled?: boolean;
 *   clearLabel: string;
 *   className?: string;
 * }} props
 */
export function ComposerFollowUpChip({
  agentName,
  quoteText,
  onNavigate,
  onClear,
  disabled,
  clearLabel,
  className,
}) {
  const preview = followUpPreviewText(quoteText);
  return (
    <span className={cn("chat-lab__follow-up-chip", className)}>
      <Button
                variant="text"
                size="small"
        type="button"
        className="chat-lab__follow-up-chip-main"
        disabled={disabled}
        onClick={onNavigate}
        title={quoteText}
      >
        <MessageCircleQuestion className="chat-lab__follow-up-chip-ico" size={14} strokeWidth={2} aria-hidden />
        <span className="chat-lab__follow-up-chip-agent">{agentName}</span>
        <span className="chat-lab__follow-up-chip-preview">{preview}</span>
      </Button>
      {onClear ?
        <Button
                variant="text"
                size="small"
          type="button"
          className="chat-lab__follow-up-chip-x"
          disabled={disabled}
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Button>
      : null}
    </span>
  );
}

/**
 * @param {{
 *   followUpRef: import("../../chat/chatSessionsStore.js").MessageFollowUpRef;
 *   onNavigate: () => void;
 *   className?: string;
 * }} props
 */
export function MessageFollowUpTag({ followUpRef, onNavigate, className }) {
  const preview = followUpPreviewText(followUpRef.quoteText);
  return (
    <Button
                variant="text"
                size="small"
      type="button"
      className={cn("chat-lab__msg-follow-up-pill", className)}
      onClick={onNavigate}
      title={followUpRef.quoteText}
    >
      <MessageCircleQuestion className="chat-lab__msg-follow-up-ico" size={13} strokeWidth={2} aria-hidden />
      <span className="chat-lab__msg-follow-up-agent">{followUpRef.agentName}</span>
      <span className="chat-lab__msg-follow-up-preview">{preview}</span>
    </Button>
  );
}
