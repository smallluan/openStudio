import { useState } from "react";
import { useStudio } from "../../context/StudioContext.jsx";
import ZoneDebugLayer from "./ZoneDebugLayer.jsx";
import { LobsterLayer } from "./LobsterPawn.jsx";

export default function StudioStage() {
  const { rotateDemoMode, agents } = useStudio();
  const [debugZones, setDebugZones] = useState(true);

  return (
    <div className="studio-stage">
      <div className="studio-stage__canvas">
        <div className="studio-stage__bg" />
        <ZoneDebugLayer visible={debugZones} />
        <LobsterLayer />
      </div>
      <div className="studio-stage__toolbar">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => rotateDemoMode()}
        >
          演示：切换状态（{agents[0]?.mode ?? "—"}）
        </button>
        <label className="chk">
          <input
            type="checkbox"
            checked={debugZones}
            onChange={(e) => setDebugZones(e.target.checked)}
          />
          显示分区
        </label>
      </div>
    </div>
  );
}
