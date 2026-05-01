import { anchorForAgent } from "../../studio/agents.js";
import { useStudio } from "../../context/StudioContext.jsx";

export default function LobsterPawn({ agent }) {
  const pt = anchorForAgent(agent);
  if (!pt) return null;

  return (
    <div
      className="lobster-pawn"
      style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
      title={`${agent.name} · ${agent.mode}`}
    >
      <span className="lobster-pawn__glyph" aria-hidden>
        🦞
      </span>
      <span className="lobster-pawn__label">{agent.name}</span>
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
