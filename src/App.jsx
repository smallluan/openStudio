import { Route, Routes, useLocation } from "react-router-dom";
import MainLayout from "./layouts/MainLayout.jsx";
import LobsterManagementPage from "./pages/LobsterManagementPage.jsx";
import SkillMarketPage from "./pages/SkillMarketPage.jsx";
import SettingsModalShell from "./routes/SettingsModalShell.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ChatLabPage from "./pages/ChatLabPage.jsx";
import AutomationPage from "./pages/AutomationPage.jsx";
import WorkflowPage from "./pages/WorkflowPage.jsx";
import WorkflowEditorPage from "./pages/WorkflowEditorPage.jsx";
import WebExplorePage from "./pages/WebExplorePage.jsx";

export default function App() {
  const location = useLocation();
  const isSettings = location.pathname === "/settings";
  const backgroundLocation =
    location.state?.backgroundLocation ??
    (isSettings
      ? { pathname: "/chat", search: "", hash: "", state: null, key: "settings-bg" }
      : location);

  return (
    <>
      <Routes location={isSettings ? backgroundLocation : location}>
        <Route element={<MainLayout railResizeEnabled />}>
          {/** Index must render chat directly — `<Navigate>` here breaks the settings overlay when background is `/` (it replaces `/settings`). */}
          <Route index element={<ChatLabPage />} />
          <Route path="chat" element={<ChatLabPage />} />
          <Route path="lobster" element={<LobsterManagementPage />} />
          <Route path="skills" element={<SkillMarketPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="workflow" element={<WorkflowPage />} />
          <Route path="workflow/:id" element={<WorkflowEditorPage />} />
          <Route path="explore" element={<WebExplorePage />} />
        </Route>
      </Routes>
      {isSettings ? (
        <Routes>
          <Route path="settings" element={<SettingsModalShell />}>
            <Route index element={<SettingsPage />} />
          </Route>
        </Routes>
      ) : null}
    </>
  );
}
