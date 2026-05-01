import StudioStage from "../studio/StudioStage.jsx";
import StudioChatBar from "../studio/StudioChatBar.jsx";
import OpenClawRuntimePanel from "../dev/OpenClawRuntimePanel.jsx";
import UserSettingsStrip from "./UserSettingsStrip.jsx";

export default function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <h1 className="app-shell__title">
          {window.appInfo?.name ?? "Lobster Studio"}
        </h1>
        <p className="app-shell__subtitle muted">
          像素工作室壳 · OpenClaw 底层（见 <code>docs/DEVELOPMENT_PLAN.md</code>）
        </p>
        <UserSettingsStrip />
      </header>

      <div className="app-shell__body">
        <div className="app-shell__stage-wrap">
          <StudioStage />
        </div>
        <OpenClawRuntimePanel />
      </div>

      <StudioChatBar />
    </div>
  );
}
