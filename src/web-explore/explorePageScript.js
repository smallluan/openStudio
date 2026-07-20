/**
 * Per-tab page scripts for Web Explore URL combos.
 */

/** @typedef {'beforeLoad'} ExplorePageScriptLifecycle */

/**
 * @typedef {{
 *   lifecycle: ExplorePageScriptLifecycle;
 *   code: string;
 * }} ExploreTabPageScript
 */

export const EXPLORE_PAGE_SCRIPT_LIFECYCLES = /** @type {const} */ (["beforeLoad"]);

/**
 * @param {unknown} raw
 * @returns {ExploreTabPageScript | null}
 */
export function normalizeExploreTabPageScript(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lifecycle = String(/** @type {Record<string, unknown>} */ (raw).lifecycle ?? "").trim();
  if (lifecycle !== "beforeLoad") return null;
  const code = String(/** @type {Record<string, unknown>} */ (raw).code ?? "");
  if (!code.trim()) return null;
  return { lifecycle: "beforeLoad", code };
}

/**
 * @param {unknown} raw
 * @param {number} [lengthHint]
 * @returns {(ExploreTabPageScript | null)[]}
 */
export function normalizeExploreTabPageScripts(raw, lengthHint = 0) {
  const len = Math.max(Number(lengthHint) || 0, Array.isArray(raw) ? raw.length : 0);
  /** @type {(ExploreTabPageScript | null)[]} */
  const out = [];
  for (let i = 0; i < len; i += 1) {
    out.push(normalizeExploreTabPageScript(Array.isArray(raw) ? raw[i] : null));
  }
  return out;
}

/**
 * Resize scripts array to match tab count, preserving existing entries.
 * @param {(ExploreTabPageScript | null)[]} scripts
 * @param {number} tabCount
 */
export function resizeExploreTabPageScripts(scripts, tabCount) {
  const count = Math.max(0, Number(tabCount) || 0);
  const prev = Array.isArray(scripts) ? scripts : [];
  /** @type {(ExploreTabPageScript | null)[]} */
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(prev[i] ?? null);
  }
  return out;
}

/**
 * @param {(ExploreTabPageScript | null)[]} scripts
 */
export function serializeExploreTabPageScripts(scripts) {
  if (!Array.isArray(scripts)) return [];
  return scripts.map((row) =>
    row && row.lifecycle === "beforeLoad" && String(row.code ?? "").trim()
      ? { lifecycle: "beforeLoad", code: String(row.code) }
      : null,
  );
}
