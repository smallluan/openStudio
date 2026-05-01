import OpenClawRuntimePanel from "../components/dev/OpenClawRuntimePanel.jsx";
import StudioChatBar from "../components/studio/StudioChatBar.jsx";
import StudioStage from "../components/studio/StudioStage.jsx";

export default function StudioPage() {
  return (
    <div className="route-page route-page--studio">
      <main className="route-page__body">
        <div className="route-page__stage">
          <StudioStage />
        </div>
        <OpenClawRuntimePanel />
      </main>
      <StudioChatBar />
    </div>
  );
}
