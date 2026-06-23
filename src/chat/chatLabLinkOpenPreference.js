export const LINK_OPEN_MODE_KEY = "openstudio_chat_link_open_mode";
export const LINK_OPEN_MODE_EVENT = "openstudio-link-open-mode-change";

/** @typedef {"sidebar" | "external"} ChatLabLinkOpenMode */

/** @param {unknown} value @returns {ChatLabLinkOpenMode} */
export function normalizeLinkOpenMode(value) {
  return value === "external" ? "external" : "sidebar";
}

/** @returns {ChatLabLinkOpenMode} */
export function readLinkOpenModeLocal() {
  try {
    const raw = window.localStorage.getItem(LINK_OPEN_MODE_KEY);
    if (raw === "external" || raw === "sidebar") return raw;
  } catch {
    /* ignore */
  }
  return "sidebar";
}

/** @param {ChatLabLinkOpenMode} mode */
export function writeLinkOpenModeLocal(mode) {
  const next = normalizeLinkOpenMode(mode);
  try {
    window.localStorage.setItem(LINK_OPEN_MODE_KEY, next);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(LINK_OPEN_MODE_EVENT, { detail: { mode: next } }));
  } catch {
    /* ignore */
  }
  return next;
}

/** @param {string} href @returns {boolean} */
export function openChatLabExternalUrl(href) {
  const h = String(href ?? "").trim();
  if (!h) return false;
  let resolved;
  try {
    resolved = new URL(h, window.location.href).href;
  } catch {
    return false;
  }
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  if (bridge && typeof bridge.openExternalUrl === "function") {
    void bridge.openExternalUrl(resolved);
    return true;
  }
  window.open(resolved, "_blank", "noreferrer,noopener");
  return true;
}
