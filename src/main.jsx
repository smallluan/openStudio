import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { ChatLabStreamingProvider } from "./context/ChatLabStreamingContext.jsx";
import { I18nProvider } from "./context/I18nContext.jsx";
import { StudioProvider } from "./context/StudioContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { MotionPreferenceProvider } from "./context/MotionPreferenceContext.jsx";
import { applyUiMotionMode } from "./motion/motionPreference.js";
import StartupBootstrapGate from "./shell/StartupBootstrapGate.jsx";
import "./index.css";

applyUiMotionMode();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <I18nProvider>
        <ThemeProvider>
          <MotionPreferenceProvider>
            <StudioProvider>
              <StartupBootstrapGate>
                <ChatLabStreamingProvider>
                  <App />
                </ChatLabStreamingProvider>
              </StartupBootstrapGate>
            </StudioProvider>
          </MotionPreferenceProvider>
        </ThemeProvider>
      </I18nProvider>
    </HashRouter>
  </StrictMode>,
);
