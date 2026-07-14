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
import { ChevronDown, X } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

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
  const triggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [open, setOpen] = useState(false);
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "top-end",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    if (present && triggerRef.current) {
      refs.setReference(triggerRef.current);
    }
  }, [present, refs]);

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

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
          <button
            type="button"
            className="chat-lab__queued-trigger-cancel"
            onClick={(e) => handleCancel(single.id, e)}
            title={t("chatLab.cancelQueuedMessage")}
            aria-label={t("chatLab.cancelQueuedMessage")}
          >
            <X aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <button
            ref={triggerRef}
            type="button"
            className={cn("chat-lab__context-trigger chat-lab__queued-trigger", open && "chat-lab__context-trigger--open")}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={t("chatLab.queuedMessagesLabel")}
          >
            <span className="chat-lab__context-trigger-label">{multiLabel}</span>
            <ChevronDown className="chat-lab__context-trigger-chevron" aria-hidden />
          </button>

          {present ? (
            <FloatingPortal>
              <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
                <div
                  ref={refs.setFloating}
                  style={floatingStyles}
                  className="outline-none z-[400]"
                  onMouseDown={(e) => e.preventDefault()}
                  {...getFloatingProps()}
                >
                  <FluidPopupAnimatedSurface
                    key={surfaceKey}
                    leaving={leaving}
                    finishLeave={finishLeave}
                    placement={context.placement}
                    morphBr="14px"
                    className={cn(
                      "chat-lab__context-popover chat-lab__queued-popover",
                      "flex w-full flex-col overflow-hidden rounded-[14px] border",
                      "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
                      "shadow-[var(--os-shadow-soft)]",
                    )}
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
                            <button
                              type="button"
                              className="chat-lab__queued-popover-cancel"
                              onClick={(e) => handleCancel(q.id, e)}
                              title={t("chatLab.cancelQueuedMessage")}
                              aria-label={t("chatLab.cancelQueuedMessage")}
                            >
                              <X aria-hidden />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </FluidPopupAnimatedSurface>
                </div>
              </FloatingFocusManager>
            </FloatingPortal>
          ) : null}
        </>
      )}
    </div>
  );
}
