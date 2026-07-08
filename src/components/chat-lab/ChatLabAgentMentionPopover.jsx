import {
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
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { agentAvatarGlyph, agentDisplayLabel } from "../../studio/agents.js";
import Avatar from "../../ui/Avatar.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

/**
 * @param {import("../../studio/agents.js").LobsterAgent} agent
 * @param {string} mainFallback
 */
function mentionLabel(agent, mainFallback) {
  const name = agent.name?.trim();
  if (name) return name;
  if (agent.isMain) return mainFallback;
  return agent.gatewayAgentId || "Agent";
}

/**
 * @param {{
 *   open: boolean;
 *   textareaRef: import("react").RefObject<HTMLTextAreaElement | null>;
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   query: string;
 *   highlightIndex?: number;
 *   onHighlightIndexChange?: (index: number) => void;
 *   everyoneLabel?: string;
 *   showEveryone?: boolean;
 *   onPickEveryone?: () => void;
 *   onPick: (agent: import("../../studio/agents.js").LobsterAgent) => void;
 *   onClose: () => void;
 * }} props
 */
export default function ChatLabAgentMentionPopover({
  open,
  textareaRef,
  agents,
  query,
  highlightIndex = 0,
  onHighlightIndexChange,
  everyoneLabel = "",
  showEveryone = false,
  onPickEveryone,
  onPick,
  onClose,
}) {
  const { t } = useI18n();
  const autoId = useId();
  const listId = `${autoId}-mention-agents`;
  const optionRefs = useRef(/** @type {Array<HTMLButtonElement | null>} */ ([]));
  const mainFallback = t("agents.defaultName");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      const label = mentionLabel(a, mainFallback).toLowerCase();
      const gid = (a.gatewayAgentId || "").toLowerCase();
      return !q || label.includes(q) || gid.includes(q);
    });
  }, [agents, mainFallback, query]);

  const everyoneVisible = useMemo(() => {
    if (!showEveryone || !everyoneLabel.trim()) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return everyoneLabel.trim().toLowerCase().includes(q);
  }, [everyoneLabel, query, showEveryone]);

  const optionCount = (everyoneVisible ? 1 : 0) + filtered.length;

  useEffect(() => {
    onHighlightIndexChange?.(0);
  }, [query, open, onHighlightIndexChange]);

  useEffect(() => {
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, optionCount]);

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
          onMouseDown={(e) => e.preventDefault()}
          data-mention-popover=""
          {...getFloatingProps()}
        >
        <FluidPopupAnimatedSurface
          key={surfaceKey}
          leaving={leaving}
          finishLeave={finishLeave}
          placement={context.placement}
          morphBr="14px"
          className={cn(
            "chat-lab__mention-popover-surface flex w-full flex-col overflow-hidden rounded-[14px] border",
            "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
            "shadow-[var(--os-shadow-soft)]",
          )}
        >
          <div className="border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-2.5 py-1.5 text-[0.68rem] text-[var(--os-text-faint)]">
            {t("chatLab.mentionPickerAria")}
          </div>
          <div id={listId} role="listbox" aria-label={t("chatLab.mentionPickerAria")} className="max-h-[min(44vh,240px)] overflow-y-auto py-1">
            {optionCount === 0 ? (
              <p className="chat-lab__mention-empty">{t("chatLab.mentionEmpty")}</p>
            ) : (
              <>
                {everyoneVisible ? (
                  <button
                    ref={(node) => {
                      optionRefs.current[0] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={highlightIndex === 0}
                    className={cn(
                      "chat-lab__mention-item chat-lab__mention-item--everyone flex w-full items-center gap-2.5 px-3 py-2 text-left",
                      highlightIndex === 0 && "chat-lab__mention-item--active",
                    )}
                    onMouseEnter={() => onHighlightIndexChange?.(0)}
                    onClick={() => onPickEveryone?.()}
                  >
                    <span className="chat-lab__participant-avatar" aria-hidden>
                      👥
                    </span>
                    <span className="chat-lab__mention-item-name min-w-0 flex-1 truncate">
                      @{everyoneLabel}
                    </span>
                  </button>
                ) : null}
                {filtered.map((a, index) => {
                  const optionIndex = index + (everyoneVisible ? 1 : 0);
                  return (
                    <button
                      key={a.id}
                      ref={(node) => {
                        optionRefs.current[optionIndex] = node;
                      }}
                      type="button"
                      role="option"
                      aria-selected={optionIndex === highlightIndex}
                      className={cn(
                        "chat-lab__mention-item flex w-full items-center gap-2.5 px-3 py-2 text-left",
                        optionIndex === highlightIndex && "chat-lab__mention-item--active",
                      )}
                      onMouseEnter={() => onHighlightIndexChange?.(optionIndex)}
                      onClick={() => onPick(a)}
                    >
                      <Avatar
                        src={agentAvatarGlyph(a)}
                        name={agentDisplayLabel(a)}
                        size="xs"
                        shape="rounded"
                      />
                      <span className="chat-lab__mention-item-name min-w-0 flex-1 truncate">
                        {mentionLabel(a, mainFallback)}
                      </span>
                      {a.isMain ? (
                        <span className="chat-lab__mention-item-badge shrink-0">{t("agents.mainBadge")}</span>
                      ) : null}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </FluidPopupAnimatedSurface>
      </div>
    </FloatingPortal>
  );
}
