import { Route, Routes } from "react-router-dom";
import MainLayout from "./layouts/MainLayout.jsx";
import LobsterManagementPage from "./pages/LobsterManagementPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import StudioPage from "./pages/StudioPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<StudioPage />} />
        <Route path="lobster" element={<LobsterManagementPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
