import { createContext, useContext } from "react";

const BootstrapGateContext = createContext({
  shellPhase: "ready",
  landingRevealReady: true,
  playHeroTitleEntrance: true,
  progressFrac: 0.15,
  progressExiting: false,
  gatePortalEl: null,
});

export function BootstrapGateProvider({ value, children }) {
  return <BootstrapGateContext.Provider value={value}>{children}</BootstrapGateContext.Provider>;
}

export function useBootstrapGate() {
  return useContext(BootstrapGateContext);
}
