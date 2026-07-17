import { ChevronDown, X } from "lucide-react";
import { Popup } from "tdesign-react";
import { Button } from "@open-studio/udesign";
import { useCallback, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { OS_POPUP_INNER_CLASS, OS_POPUP_OVERLAY_CLASS, osPopupPopperOptions } from "../../ui/osPopupShared.js";
import { cn } from "../../ui/cn.js";

/** @param {{ text: string; attachments?: unknown[]; fileRefs?: unknown[] }} q @param {(key: string, opts?: object) => string} t */
function summarizeQueuedMessage(q, t) {
  const trimmed = String(q.text ?? "").trim();
  if (trimmed) {
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
  }
  const images = Array.isArray(q.attachments) ? q.attachments.length : 0;
  const files = Array.isArray(q.fileRefs) ? q.fileRefs.length : 0;
  if (images > 0) return t("chatLab.queuedMessageImages", { count: images });
  if (files > 0) return t("chatLab.queuedMessageFiles", { count: files });
  return t("chatLab.queuedMessageEmpty");
}

/**
 * @param {{
 *   messages: Array<{ id: string; text: string; attachments?: unknown[]; fileRefs?: unknown[] }>;
 *   sendingId?: string | null;
 *   onCancel: (id: string) => void;
 * }} props
 */
export default function ChatLabQueuedMessagesBar({ messages, sendingId = null, onCancel }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const handleCancel = useCallback(
    (id, e) => {
      e?.stopPropagation?.();
      onCancel(id);
      if (messages.length <= 1) setOpen(false);
    },
    [messages.length, onCancel],
  );

  if (!messages.length) return null;

  const single = messages.length === 1 ? messages[0] : null;
  const singleSummary = single ? summarizeQueuedMessage(single, t) : "";
  const multiLabel = t("chatLab.queuedMessagesCount", { count: messages.length });

  const popupContent = (
    <div
      className={cn(
        "chat-lab__context-popover chat-lab__queued-popover",
        "flex w-full flex-col overflow-hidden rounded-[14px] border",
        "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
        "shadow-[var(--os-shadow-soft)]",
      )}
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="chat-lab__context-popover-section">{t("chatLab.queuedMessagesLabel")}</p>
      <ul className="chat-lab__context-popover-list chat-lab__queued-popover-list" role="listbox">
        {messages.map((q, idx) => {
          const summary = summarizeQueuedMessage(q, t);
          return (
            <li key={q.id} className="chat-lab__queued-popover-row">
              <span className="chat-lab__queued-popover-index">#{idx + 1}</span>
              <span className="chat-lab__queued-popover-summary" title={q.text || summary}>
                {summary}
              </span>
              <Button
                variant="text"
                size="small"
                type="button"
                className="chat-lab__queued-popover-cancel"
                onClick={(e) => handleCancel(q.id, e)}
                title={t("chatLab.cancelQueuedMessage")}
                aria-label={t("chatLab.cancelQueuedMessage")}
              >
                <X aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="chat-lab__queued-bar" aria-live="polite">
      {single ? (
        <div
          className={cn(
            "chat-lab__context-trigger chat-lab__queued-trigger chat-lab__queued-trigger--single",
            sendingId === single.id && "chat-lab__queued-trigger--sending",
          )}
        >
          <span className="chat-lab__context-trigger-label" title={single.text || singleSummary}>
            #1 {singleSummary}
          </span>
          <Button
            variant="text"
            size="small"
            type="button"
            className="chat-lab__queued-trigger-cancel"
            onClick={(e) => handleCancel(single.id, e)}
            title={t("chatLab.cancelQueuedMessage")}
            aria-label={t("chatLab.cancelQueuedMessage")}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <Popup
          visible={open}
          trigger="click"
          placement="top-end"
          attach="body"
          zIndex={400}
          destroyOnClose={false}
          overlayClassName={OS_POPUP_OVERLAY_CLASS}
          overlayInnerClassName={OS_POPUP_INNER_CLASS}
          popperOptions={osPopupPopperOptions(8, 8)}
          content={popupContent}
          onVisibleChange={setOpen}
        >
          <Button
            variant="outline"
            shape="round"
            size="small"
            type="button"
            className={cn("chat-lab__context-trigger chat-lab__queued-trigger", open && "chat-lab__context-trigger--open")}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={t("chatLab.queuedMessagesLabel")}
          >
            <span className="chat-lab__context-trigger-label">{multiLabel}</span>
            <ChevronDown className="chat-lab__context-trigger-chevron" aria-hidden />
          </Button>
        </Popup>
      )}
    </div>
  );
}
