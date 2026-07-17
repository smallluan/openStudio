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
import { initChatSessionsStore } from "./chat/chatSessionsStore.js";
import StartupBootstrapGate from "./shell/StartupBootstrapGate.jsx";
import "./index.css";
import "@open-studio/udesign/styles/css-variables.css";

applyUiMotionMode();

function bootstrap() {
  /**
   * Do not block first paint on chat-session disk hydrate.
   * Slow startup I/O previously delayed React mount and caused a blank splash.
   */
  void initChatSessionsStore().catch(() => {});
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
}

void bootstrap();
