import { useState } from "react";
import { Button } from "@open-studio/udesign";
import { useI18n } from "../../context/I18nContext.jsx";
import { useStudio } from "../../context/StudioContext.jsx";
import ZoneDebugLayer from "./ZoneDebugLayer.jsx";
import { LobsterLayer } from "./LobsterPawn.jsx";
import Checkbox from "../../ui/Checkbox.jsx";

export default function StudioStage() {
  const { t } = useI18n();
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
        <Button type="button" className="btn-ghost" onClick={() => rotateDemoMode()}>
          {t("studio.demoRotateMode", {
            mode: (() => {
              const mode = agents[0]?.mode;
              if (!mode) return t("studio.modeFallback");
              const lbl = t(`modes.${mode}`);
              return lbl === `modes.${mode}` ? mode : lbl;
            })(),
          })}
        </Button>
        <Checkbox
          id="chk-zones"
          checked={debugZones}
          onCheckedChange={setDebugZones}
          label={t("studio.showZones")}
        />
      </div>
    </div>
  );
}
