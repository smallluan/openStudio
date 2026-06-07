import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useId, useMemo, useState } from "react";
import { agentAvatarGlyph, agentDisplayLabel } from "../../studio/agents.js";
import { useI18n } from "../../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

function MembersChevron({ open }) {
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

/**
 * @param {{
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   participantIds: string[];
 *   onChange: (ids: string[]) => void;
 *   disabled?: boolean;
 * }} props
 */
export default function ChatLabParticipantBar({ agents, participantIds, onChange, disabled }) {
  const { t } = useI18n();
  const autoId = useId();
  const panelId = `${autoId}-members`;
  const addListId = `${autoId}-members-add`;
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);

  const main = useMemo(() => agents.find((a) => a.isMain) ?? agents[0] ?? null, [agents]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const participants = useMemo(() => {
    /** @type {import("../../studio/agents.js").LobsterAgent[]} */
    const out = [];
    const seen = new Set();
    for (const id of participantIds) {
      const a = byId.get(id);
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
    if (main && !seen.has(main.id)) out.unshift(main);
    return out;
  }, [byId, main, participantIds]);

  const addable = useMemo(
    () => agents.filter((a) => !participants.some((p) => p.id === a.id)),
    [agents, participants],
  );

  const removeAgent = (agentId) => {
    const agent = byId.get(agentId);
    if (!agent || agent.isMain) return;
    onChange(participantIds.filter((id) => id !== agentId));
  };

  const addAgent = (agentId) => {
    const agent = byId.get(agentId);
    if (!agent || agent.isMain) return;
    const set = new Set(participantIds);
    set.add(agentId);
    if (main) set.add(main.id);
    onChange([...set]);
    setAddOpen(false);
  };

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) setAddOpen(false);
    },
    placement: "top-end",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn("chat-lab__pill-btn chat-lab__members-pill", present && "chat-lab__members-pill--open")}
        disabled={disabled}
        title={t("chatLab.participantsLabel")}
        aria-label={t("chatLab.participantsAria")}
        aria-haspopup="dialog"
        aria-expanded={present}
        aria-controls={present ? panelId : undefined}
        {...getReferenceProps()}
      >
        <span className="chat-lab__members-pill-label">{t("chatLab.participantsLabel")}</span>
        {participants.length > 0 ? (
          <span className="chat-lab__members-pill-count" aria-hidden>
            {participants.length}
          </span>
        ) : null}
        <MembersChevron open={present} />
      </button>

      {present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="outline-none z-[400] w-[min(100vw-2rem,280px)] max-w-[min(100vw-2rem,280px)]"
              {...getFloatingProps()}
            >
              <FluidPopupAnimatedSurface
                key={surfaceKey}
                leaving={leaving}
                finishLeave={finishLeave}
                placement={context.placement}
                morphBr="14px"
                className={cn(
                  "chat-lab__members-popover flex w-full flex-col overflow-hidden rounded-[14px] border",
                  "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
                  "shadow-[var(--os-shadow-soft)]",
                )}
              >
                <div id={panelId} className="chat-lab__members-popover-inner">
                  <ul className="chat-lab__members-list" role="list" aria-label={t("chatLab.participantsAria")}>
                    {participants.map((a) => (
                      <li key={a.id} className="chat-lab__members-row" role="listitem">
                        <span className="chat-lab__participant-avatar" aria-hidden>
                          {agentAvatarGlyph(a)}
                        </span>
                        <span className="chat-lab__members-row-name">{agentDisplayLabel(a)}</span>
                        {!a.isMain ? (
                          <button
                            type="button"
                            className="chat-lab__members-row-remove"
                            disabled={disabled}
                            aria-label={t("chatLab.participantRemove", { name: agentDisplayLabel(a) })}
                            onClick={() => removeAgent(a.id)}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path
                                d="M18 6 6 18M6 6l12 12"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        ) : (
                          <span className="chat-lab__members-row-remove-spacer" aria-hidden />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="chat-lab__members-add-section">
                    <button
                      type="button"
                      className={cn("chat-lab__participants-add", addOpen && "chat-lab__participants-add--open")}
                      disabled={disabled || addable.length === 0}
                      aria-expanded={addOpen}
                      aria-controls={addOpen ? addListId : undefined}
                      onClick={() => setAddOpen((v) => !v)}
                    >
                      {t("chatLab.participantsAdd")}
                    </button>
                    {addOpen && addable.length > 0 ? (
                      <ul id={addListId} className="chat-lab__members-add-list" role="listbox">
                        {addable.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              className="chat-lab__participants-menu-item"
                              role="option"
                              onClick={() => addAgent(a.id)}
                            >
                              <span className="chat-lab__participant-avatar" aria-hidden>
                                {agentAvatarGlyph(a)}
                              </span>
                              <span>{agentDisplayLabel(a)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
