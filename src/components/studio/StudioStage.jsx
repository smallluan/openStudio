import { useState } from "react";
import { useStudio } from "../../context/StudioContext.jsx";
import ZoneDebugLayer from "./ZoneDebugLayer.jsx";
import { LobsterLayer } from "./LobsterPawn.jsx";
import Checkbox from "../../ui/Checkbox.jsx";

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
        <button type="button" className="btn-ghost" onClick={() => rotateDemoMode()}>
          演示：切换状态（{agents[0]?.mode ?? "—"}）
        </button>
        <Checkbox
          id="chk-zones"
          checked={debugZones}
          onCheckedChange={setDebugZones}
          label="显示分区"
        />
      </div>
    </div>
  );
}
