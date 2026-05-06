import { Route, Routes, useLocation } from "react-router-dom";
import MainLayout from "./layouts/MainLayout.jsx";
import LobsterManagementPage from "./pages/LobsterManagementPage.jsx";
import SkillMarketPage from "./pages/SkillMarketPage.jsx";
import SettingsModalShell from "./routes/SettingsModalShell.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import StudioPage from "./pages/StudioPage.jsx";
import ChatLabPage from "./pages/ChatLabPage.jsx";

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
          <Route path="studio" element={<StudioPage />} />
          <Route path="chat" element={<ChatLabPage />} />
          <Route path="lobster" element={<LobsterManagementPage />} />
          <Route path="skills" element={<SkillMarketPage />} />
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
