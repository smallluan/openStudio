import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { I18nProvider } from "./context/I18nContext.jsx";
import { StudioProvider } from "./context/StudioContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import StartupBootstrapGate from "./shell/StartupBootstrapGate.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <I18nProvider>
        <ThemeProvider>
          <StudioProvider>
            <StartupBootstrapGate>
              <App />
            </StartupBootstrapGate>
          </StudioProvider>
        </ThemeProvider>
      </I18nProvider>
    </HashRouter>
  </StrictMode>,
);
