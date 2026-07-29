/**
 * Renderer-side page-generation helpers for browser_action observations.
 * Keep in sync with `lib/browser-observation-prune.cjs` (OpenClaw prompt prune).
 */

/**
 * @param {unknown} url
 * @returns {string}
 */
export function normalizePageUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * @param {unknown} action
 * @returns {boolean}
 */
export function isNavigationAction(action) {
  const a = String(action ?? "")
    .trim()
    .toLowerCase();
  return a === "navigate" || a === "reload" || a === "refresh";
}

/**
 * @param {unknown} steps
 * @returns {boolean}
 */
export function stepsIncludeNavigation(steps) {
  if (!Array.isArray(steps)) return false;
  return steps.some((step) => {
    if (!step || typeof step !== "object") return false;
    return isNavigationAction(/** @type {any} */ (step).action);
  });
}

/**
 * @param {{ pageGeneration?: number, lastUrl?: string }} state
 * @param {{ url?: string, forceBump?: boolean }} next
 * @returns {{ pageGeneration: number, lastUrl: string, pageChanged: boolean }}
 */
export function advancePageGeneration(state, next) {
  const prevGen = Math.max(0, Math.floor(Number(state?.pageGeneration) || 0));
  const prevUrl = normalizePageUrl(state?.lastUrl);
  const url = normalizePageUrl(next?.url);
  if (!prevGen) {
    return { pageGeneration: 1, lastUrl: url || prevUrl, pageChanged: false };
  }
  const forceBump = Boolean(next?.forceBump);
  const urlChanged = Boolean(url && url !== prevUrl);
  if (forceBump || urlChanged) {
    return { pageGeneration: prevGen + 1, lastUrl: url || prevUrl, pageChanged: true };
  }
  return { pageGeneration: prevGen, lastUrl: url || prevUrl, pageChanged: false };
}
