import { Route, Routes, useLocation } from "react-router-dom";
import MainLayout from "./layouts/MainLayout.jsx";
import LobsterManagementPage from "./pages/LobsterManagementPage.jsx";
import SettingsModalShell from "./routes/SettingsModalShell.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import StudioPage from "./pages/StudioPage.jsx";

export default function App() {
  const location = useLocation();
  const isSettings = location.pathname === "/settings";
  const backgroundLocation =
    location.state?.backgroundLocation ??
    (isSettings
      ? { pathname: "/", search: "", hash: "", state: null, key: "settings-bg" }
      : location);

  return (
    <>
      <Routes location={isSettings ? backgroundLocation : location}>
        <Route element={<MainLayout railResizeEnabled />}>
          <Route index element={<StudioPage />} />
          <Route path="lobster" element={<LobsterManagementPage />} />
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
