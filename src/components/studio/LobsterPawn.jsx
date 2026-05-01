import { useI18n } from "../../context/I18nContext.jsx";
import { anchorForAgent } from "../../studio/agents.js";
import { useStudio } from "../../context/StudioContext.jsx";

export default function LobsterPawn({ agent }) {
  const { t } = useI18n();
  const pt = anchorForAgent(agent);
  if (!pt) return null;

  const displayName = agent.name?.trim() ? agent.name : t("agents.defaultName");
  const lbl = t(`modes.${agent.mode}`);
  const modeLabel = lbl === `modes.${agent.mode}` ? agent.mode : lbl;

  return (
    <div
      className="lobster-pawn"
      style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
      title={`${displayName} · ${modeLabel}`}
    >
      <span className="lobster-pawn__glyph" aria-hidden>
        🦞
      </span>
      <span className="lobster-pawn__label">{displayName}</span>
    </div>
  );
}

export function LobsterLayer() {
  const { agents } = useStudio();
  return (
    <div className="lobster-layer">
      {agents.map((a) => (
        <LobsterPawn key={a.id} agent={a} />
      ))}
    </div>
  );
}
