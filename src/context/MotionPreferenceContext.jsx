import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  applyUiMotionMode,
  readUiMotionMode,
  resolveEffectiveUiMotion,
  systemPrefersReducedMotion,
  writeUiMotionMode,
} from "../motion/motionPreference.js";

/** @typedef {import("../motion/motionPreference.js").UiMotionMode} UiMotionMode */

/** @type {import("react").Context<{ mode: UiMotionMode; effective: "full" | "reduced"; setMode: (mode: UiMotionMode) => void } | null>} */
const MotionPreferenceContext = createContext(null);

export function MotionPreferenceProvider({ children }) {
  const [mode, setModeState] = useState(() => readUiMotionMode());
  const [systemReduced, setSystemReduced] = useState(() => systemPrefersReducedMotion());

  useEffect(() => {
    applyUiMotionMode(mode);
  }, [mode, systemReduced]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemReduced(mq.matches);
    onChange();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      effective: resolveEffectiveUiMotion(mode),
      setMode: (next) => {
        setModeState(next);
        writeUiMotionMode(next);
      },
    }),
    [mode, systemReduced],
  );

  return <MotionPreferenceContext.Provider value={value}>{children}</MotionPreferenceContext.Provider>;
}

export function useMotionPreference() {
  const ctx = useContext(MotionPreferenceContext);
  if (!ctx) {
    throw new Error("useMotionPreference must be used within MotionPreferenceProvider");
  }
  return ctx;
}
