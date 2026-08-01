const DOM_READ_LEVELS = new Set(["auto", "none", "metadata", "target", "inventory", "full"]);

const TARGET_ACTIONS = new Set([
  "click",
  "focus",
  "blur",
  "type",
  "type_chars",
  "press",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "mousemove",
  "pointermove",
  "hover",
  "dblclick",
  "rightclick",
  "contextmenu",
  "drag",
  "set_files",
  "upload",
  "attach",
]);

const NON_DOM_ACTIONS = new Set(["wait", "navigate", "reload", "refresh", "scroll"]);

/**
 * @param {unknown} value
 * @param {"auto"|"none"|"metadata"|"target"|"inventory"|"full"} [fallback]
 * @returns {"auto"|"none"|"metadata"|"target"|"inventory"|"full"}
 */
export function normalizeDomReadLevel(value, fallback = "auto") {
  const level = String(value ?? "").trim().toLowerCase();
  if (DOM_READ_LEVELS.has(level)) return /** @type {any} */ (level);
  return fallback;
}

/**
 * @param {unknown} step
 * @returns {boolean}
 */
export function stepNeedsDomTarget(step) {
  if (!step || typeof step !== "object") return false;
  const action = String(/** @type {any} */ (step).action ?? "").trim().toLowerCase();
  return TARGET_ACTIONS.has(action) || action === "query" || action === "inspect";
}

/**
 * @param {unknown} step
 * @returns {boolean}
 */
export function stepHasExplicitSelector(step) {
  if (!step || typeof step !== "object") return false;
  const row = /** @type {any} */ (step);
  return typeof row.selector === "string" && row.selector.trim().length > 0;
}

/**
 * Resolve the amount of DOM needed for a browser_action request.
 *
 * `auto` is intentionally conservative for refs and semantic targets: those need
 * an inventory or the existing inventory cache. Explicit CSS selectors can be
 * executed without scanning unrelated page DOM.
 *
 * @param {unknown} requested
 * @param {unknown[]} steps
 * @param {{ hasInventory?: boolean; inventoryRefs?: string[] }} [opts]
 * @returns {"none"|"metadata"|"target"|"inventory"|"full"}
 */
export function resolveDomReadLevel(requested, steps, opts = {}) {
  const level = normalizeDomReadLevel(requested);
  if (level !== "auto") return level;

  const list = Array.isArray(steps) ? steps : [];
  const targetSteps = list.filter(stepNeedsDomTarget);
  if (!targetSteps.length) return "metadata";

  const hasQuery = targetSteps.some((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    return action === "query" || action === "inspect";
  });
  if (hasQuery && targetSteps.every(stepHasExplicitSelector)) return "target";

  const allExplicit = targetSteps.every(stepHasExplicitSelector);
  if (allExplicit) return "none";

  const hasRef = targetSteps.some((step) => typeof step?.ref === "string" && step.ref.trim());
  const inventoryRefs = new Set(
    Array.isArray(opts.inventoryRefs) ? opts.inventoryRefs.map((ref) => String(ref ?? "").trim().toLowerCase()) : [],
  );
  const refsResolvable =
    hasRef &&
    targetSteps
      .filter((step) => typeof step?.ref === "string" && step.ref.trim())
      .every((step) => inventoryRefs.has(String(step.ref).trim().toLowerCase()));
  if (Boolean(opts.hasInventory) && refsResolvable) return "none";
  if (hasRef) return "inventory";
  return "full";
}

/**
 * @param {unknown} action
 */
export function isDomReadLevelAction(action) {
  const a = String(action ?? "").trim().toLowerCase();
  return !NON_DOM_ACTIONS.has(a);
}
