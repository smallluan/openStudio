import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { StudioProvider } from "./context/StudioContext.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <StudioProvider>
        <App />
      </StudioProvider>
    </HashRouter>
  </StrictMode>
);
