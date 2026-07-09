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
import { Users } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { agentAvatarGlyph, agentDisplayLabel } from "../../studio/agents.js";
import { useI18n } from "../../context/I18nContext.jsx";
import Avatar from "../../ui/Avatar.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import TransferDialog from "../../ui/TransferDialog.jsx";
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
 *   variant?: "pill" | "icon";
 * }} props
 */
export default function ChatLabParticipantBar({ agents, participantIds, onChange, disabled, variant = "pill" }) {
  const { t } = useI18n();
  const autoId = useId();
  const panelId = `${autoId}-members`;
  const [open, setOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
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

  const transferItems = useMemo(
    () =>
      agents.map((a) => ({
        key: a.id,
        label: agentDisplayLabel(a),
        searchText: agentDisplayLabel(a),
        icon: agentAvatarGlyph(a),
        locked: Boolean(a.isMain),
      })),
    [agents],
  );

  const transferTargetKeys = useMemo(() => participants.map((a) => a.id), [participants]);

  const removeAgent = (agentId) => {
    const agent = byId.get(agentId);
    if (!agent || agent.isMain) return;
    onChange(participantIds.filter((id) => id !== agentId));
  };

  const handleTransferConfirm = (keys) => {
    const nonMain = keys.filter((id) => id !== main?.id);
    // Close the dialog first
    setTransferOpen(false);
    // Then update state - onChange will be called with the new participant list
    // Note: onChange may be debounced in parent, but dialog closing shouldn't cancel it
    onChange(nonMain);
  };

  const iconVariant = variant === "icon";

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: iconVariant ? "bottom-end" : "top-end",
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
        className={cn(
          iconVariant
            ? cn("chat-lab__turn-nav-icon-btn", present && "chat-lab__turn-nav-icon-btn--open")
            : cn("chat-lab__pill-btn chat-lab__members-pill", present && "chat-lab__members-pill--open"),
        )}
        disabled={disabled}
        title={t("chatLab.participantsLabel")}
        aria-label={t("chatLab.participantsAria")}
        aria-haspopup="dialog"
        aria-expanded={present}
        aria-controls={present ? panelId : undefined}
        {...getReferenceProps()}
      >
        {iconVariant ? (
          <Users size={16} strokeWidth={2.1} aria-hidden />
        ) : (
          <>
            <span className="chat-lab__members-pill-label">{t("chatLab.participantsLabel")}</span>
            {participants.length > 0 ? (
              <span className="chat-lab__members-pill-count" aria-hidden>
                {participants.length}
              </span>
            ) : null}
            <MembersChevron open={present} />
          </>
        )}
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
                        <Avatar
                          src={agentAvatarGlyph(a)}
                          name={agentDisplayLabel(a)}
                          size="sm"
                          shape="rounded"
                        />
                        <span className="chat-lab__members-row-name text-[var(--os-text-muted)]">{agentDisplayLabel(a)}</span>
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
                      className={cn("chat-lab__participants-add", transferOpen && "chat-lab__participants-add--open")}
                      disabled={disabled}
                      aria-haspopup="dialog"
                      aria-expanded={transferOpen}
                      onClick={() => setTransferOpen(true)}
                    >
                      {t("chatLab.participantsAdd")}
                    </button>
                  </div>
                </div>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title={t("chatLab.participantsTransferTitle")}
        items={transferItems}
        targetKeys={transferTargetKeys}
        lockedKeys={main ? [main.id] : []}
        sourceTitle={t("chatLab.participantsTransferSource")}
        targetTitle={t("chatLab.participantsTransferTarget")}
        searchPlaceholder={t("chatLab.participantsTransferSearch")}
        emptySource={t("chatLab.participantsTransferEmptySource")}
        emptyTarget={t("chatLab.participantsTransferEmptyTarget")}
        onConfirm={handleTransferConfirm}
      />
    </>
  );
}
