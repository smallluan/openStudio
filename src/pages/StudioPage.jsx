import { useEffect, useState } from "react";
import OpenClawRuntimePanel from "../components/dev/OpenClawRuntimePanel.jsx";
import StudioChatBar from "../components/studio/StudioChatBar.jsx";
import StudioStage from "../components/studio/StudioStage.jsx";
import ResizableEdge from "../ui/ResizableEdge.jsx";
import { cn } from "../ui/cn.js";

const DEV_PANEL_KEY = "openstudio_dev_panel_width";
const DEV_PANEL_DEFAULT = 280;
const DEV_PANEL_MIN = 220;
const DEV_PANEL_MAX = 520;

function readDevPanelWidth() {
  try {
    const raw = window.localStorage.getItem(DEV_PANEL_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(DEV_PANEL_MAX, Math.max(DEV_PANEL_MIN, n));
  } catch {
    /* ignore */
  }
  return DEV_PANEL_DEFAULT;
}

export default function StudioPage() {
  const [panelWidth, setPanelWidth] = useState(readDevPanelWidth);
  const [panelDragging, setPanelDragging] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(DEV_PANEL_KEY, String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

  return (
    <div className="route-page route-page--studio">
      <main className={cn("route-page__body", panelDragging && "route-page__body--resizing")}>
        <div className="route-page__stage">
          <StudioStage />
        </div>
        <div
          className="studio-dev-shell relative flex min-h-0 shrink-0 flex-col overflow-hidden"
          style={{ width: panelWidth }}
        >
          <ResizableEdge
            side="left"
            value={panelWidth}
            min={DEV_PANEL_MIN}
            max={DEV_PANEL_MAX}
            onChange={setPanelWidth}
            onActiveChange={setPanelDragging}
          />
          <OpenClawRuntimePanel />
        </div>
      </main>
      <StudioChatBar />
    </div>
  );
}
