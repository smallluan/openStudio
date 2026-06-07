/** @typedef {"full" | "reduced" | "system"} UiMotionMode */

export const UI_MOTION_STORAGE_KEY = "openstudio_ui_motion";

/** @returns {UiMotionMode} */
export function readUiMotionMode() {
  try {
    const raw = localStorage.getItem(UI_MOTION_STORAGE_KEY);
    if (raw === "full" || raw === "reduced" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "full";
}

/** @param {UiMotionMode} mode */
export function writeUiMotionMode(mode) {
  try {
    localStorage.setItem(UI_MOTION_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  applyUiMotionMode(mode);
}

export function systemPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** @param {UiMotionMode} mode @returns {"full" | "reduced"} */
export function resolveEffectiveUiMotion(mode) {
  if (mode === "full") return "full";
  if (mode === "reduced") return "reduced";
  return systemPrefersReducedMotion() ? "reduced" : "full";
}

/** @param {UiMotionMode} [mode] @returns {"full" | "reduced"} */
export function applyUiMotionMode(mode = readUiMotionMode()) {
  if (typeof document === "undefined") return resolveEffectiveUiMotion(mode);
  const effective = resolveEffectiveUiMotion(mode);
  document.documentElement.dataset.osMotion = effective;
  return effective;
}
