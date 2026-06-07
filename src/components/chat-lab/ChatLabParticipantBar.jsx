import { useEffect, useId, useMemo, useRef, useState } from "react";
import { agentAvatarGlyph, agentDisplayLabel } from "../../studio/agents.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));

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

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(/** @type {Node} */ (e.target))) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggleAgent = (agentId) => {
    const agent = byId.get(agentId);
    if (!agent) return;
    if (agent.isMain) return;
    const set = new Set(participantIds);
    if (set.has(agentId)) set.delete(agentId);
    else set.add(agentId);
    if (main) set.add(main.id);
    onChange([...set]);
  };

  const removeAgent = (agentId) => {
    const agent = byId.get(agentId);
    if (!agent || agent.isMain) return;
    onChange(participantIds.filter((id) => id !== agentId));
  };

  return (
    <div className="chat-lab__participants" ref={rootRef}>
      <span className="chat-lab__participants-label">{t("chatLab.participantsLabel")}</span>
      <div className="chat-lab__participants-chips" role="list" aria-label={t("chatLab.participantsAria")}>
        {participants.map((a) => (
          <span key={a.id} className="chat-lab__participant-chip" role="listitem">
            <span className="chat-lab__participant-avatar" aria-hidden>
              {agentAvatarGlyph(a)}
            </span>
            <span className="chat-lab__participant-name">{agentDisplayLabel(a)}</span>
            {!a.isMain ? (
              <button
                type="button"
                className="chat-lab__participant-remove"
                disabled={disabled}
                aria-label={t("chatLab.participantRemove", { name: agentDisplayLabel(a) })}
                onClick={() => removeAgent(a.id)}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      <div className="chat-lab__participants-add-wrap">
        <button
          type="button"
          className={cn("chat-lab__participants-add", open && "chat-lab__participants-add--open")}
          disabled={disabled || addable.length === 0}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          {t("chatLab.participantsAdd")}
        </button>
        {open && addable.length > 0 ? (
          <ul id={listId} className="chat-lab__participants-menu" role="listbox">
            {addable.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="chat-lab__participants-menu-item"
                  role="option"
                  onClick={() => {
                    toggleAgent(a.id);
                    setOpen(false);
                  }}
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
  );
}
