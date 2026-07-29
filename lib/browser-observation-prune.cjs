/**
 * Prune stale browser_action page DOM from OpenClaw toolResult history.
 *
 * Policy: only the latest browser_action observation keeps `elements` / `text`.
 * Older observations keep steps + URL/title/pageGeneration (execution trail).
 * Opt-in: `retainPriorPageDom` keeps DOM for the previous pageGeneration too.
 *
 * Used by:
 * - OpenClaw prompt assembly (inlined by patch-openclaw-browser-observation-prune.mjs)
 * - Unit tests (`browser-observation-prune.test.cjs`)
 *
 * Renderer tagging uses the ESM twin `src/chat/chatLabBrowserObservation.js`
 * (Vite cannot default-import this CJS module).
 */
"use strict";

// OPEN_STUDIO_BROWSER_OBSERVATION_PRUNE_BEGIN

/**
 * @param {unknown} url
 * @returns {string}
 */
function openStudioNormalizePageUrl(url) {
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
 * @param {unknown} name
 * @returns {boolean}
 */
function openStudioIsBrowserActionToolName(name) {
  const n = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!n) return false;
  if (n === "browser_action" || n === "sidebar_action") return true;
  return n.endsWith(".browser_action") || n.endsWith("/browser_action") || n.endsWith(".sidebar_action");
}

/**
 * @param {unknown} action
 * @returns {boolean}
 */
function openStudioIsNavigationAction(action) {
  const a = String(action ?? "")
    .trim()
    .toLowerCase();
  return a === "navigate" || a === "reload" || a === "refresh";
}

/**
 * @param {unknown} steps
 * @returns {boolean}
 */
function openStudioStepsIncludeNavigation(steps) {
  if (!Array.isArray(steps)) return false;
  return steps.some((step) => {
    if (!step || typeof step !== "object") return false;
    return openStudioIsNavigationAction(/** @type {any} */ (step).action);
  });
}

/**
 * @param {{ pageGeneration?: number, lastUrl?: string }} state
 * @param {{ url?: string, forceBump?: boolean }} next
 * @returns {{ pageGeneration: number, lastUrl: string, pageChanged: boolean }}
 */
function openStudioAdvancePageGeneration(state, next) {
  const prevGen = Math.max(0, Math.floor(Number(state?.pageGeneration) || 0));
  const prevUrl = openStudioNormalizePageUrl(state?.lastUrl);
  const url = openStudioNormalizePageUrl(next?.url);
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

/**
 * @param {unknown} observation
 * @returns {Record<string, unknown> | null}
 */
function openStudioStripObservationDom(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return null;
  const obs = /** @type {Record<string, unknown>} */ (observation);
  if (obs.domStripped === true) return obs;
  const elements = obs.elements;
  const text = obs.text;
  const elementCount = Array.isArray(elements) ? elements.length : 0;
  const textChars = typeof text === "string" ? text.length : 0;
  if (elementCount === 0 && textChars === 0 && !("elements" in obs) && !("text" in obs)) {
    return obs;
  }
  /** @type {Record<string, unknown>} */
  const next = { ...obs };
  delete next.elements;
  delete next.text;
  next.domStripped = true;
  next.elementCount = elementCount;
  next.textChars = textChars;
  next.note =
    "Prior page DOM stripped after navigation (or superseded on the same page). Use the latest browser_action observation or the injected page snapshot for refs.";
  return next;
}

/**
 * @param {unknown} payload
 * @returns {unknown}
 */
function openStudioStripBrowserActionPayloadDom(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const body = /** @type {Record<string, unknown>} */ (payload);
  const obs = body.observation;
  const stripped = openStudioStripObservationDom(obs);
  if (!stripped || stripped === obs) return payload;
  return { ...body, observation: stripped };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function openStudioTryParseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
function openStudioLooksLikeBrowserActionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const body = /** @type {Record<string, unknown>} */ (payload);
  const obs = body.observation;
  if (obs && typeof obs === "object" && !Array.isArray(obs)) return true;
  return Array.isArray(body.steps) && typeof body.hint === "string" && /observation\.elements/i.test(body.hint);
}

/**
 * @param {{ role?: string, toolName?: string, content?: unknown }} msg
 * @returns {{ payload: Record<string, unknown>, textIndex: number } | null}
 */
function openStudioExtractBrowserActionToolPayload(msg) {
  if (!msg || msg.role !== "toolResult") return null;
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!block || typeof block !== "object") continue;
    if (/** @type {any} */ (block).type !== "text") continue;
    const text = /** @type {any} */ (block).text;
    const payload = openStudioTryParseJsonObject(text);
    if (!payload) continue;
    const named = openStudioIsBrowserActionToolName(msg.toolName);
    if (named || openStudioLooksLikeBrowserActionPayload(payload)) {
      return { payload, textIndex: i };
    }
  }
  return null;
}

/**
 * @param {any} msg
 * @param {Record<string, unknown>} payload
 * @param {number} textIndex
 * @returns {any}
 */
function openStudioReplaceToolResultPayload(msg, payload, textIndex) {
  const content = Array.isArray(msg.content) ? msg.content.slice() : [];
  const prev = content[textIndex];
  content[textIndex] = {
    ...(prev && typeof prev === "object" ? prev : { type: "text" }),
    type: "text",
    text: JSON.stringify(payload, null, 2),
  };
  return { ...msg, content };
}

/**
 * Strip DOM from all but the latest browser_action observation (in-memory; does not rewrite session files).
 * @param {unknown[]} messages
 * @param {{ retainPriorPageDom?: boolean }} [options]
 * @returns {unknown[]}
 */
function openStudioPruneStaleBrowserActionDom(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  /** @type {Array<{ index: number, textIndex: number, payload: Record<string, unknown>, pageGeneration: number }>} */
  const entries = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const extracted = openStudioExtractBrowserActionToolPayload(/** @type {any} */ (msg));
    if (!extracted) continue;
    const obs = extracted.payload.observation;
    const genRaw =
      obs && typeof obs === "object" ? Number(/** @type {any} */ (obs).pageGeneration) : NaN;
    entries.push({
      index: i,
      textIndex: extracted.textIndex,
      payload: extracted.payload,
      pageGeneration: Number.isFinite(genRaw) && genRaw > 0 ? Math.floor(genRaw) : 0,
    });
  }
  if (entries.length <= 1) return messages;

  const latest = entries[entries.length - 1];
  const latestObs = latest.payload.observation;
  const currentGen =
    latest.pageGeneration ||
    (latestObs && typeof latestObs === "object"
      ? Math.floor(Number(/** @type {any} */ (latestObs).pageGeneration) || 0)
      : 0);
  const retainPrior = Boolean(
    options.retainPriorPageDom ||
      latest.payload.retainPriorPageDom === true ||
      (latestObs && typeof latestObs === "object" && /** @type {any} */ (latestObs).retainPriorPageDom === true),
  );
  const retainGen = retainPrior && currentGen > 1 ? currentGen - 1 : null;

  let changed = false;
  const out = messages.slice();
  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e];
    if (e === entries.length - 1) continue;

    const obs = entry.payload.observation;
    const keepDom =
      (obs && typeof obs === "object" && /** @type {any} */ (obs).retainDom === true) ||
      (retainGen != null && entry.pageGeneration === retainGen);
    if (keepDom) continue;

    const nextPayload = openStudioStripBrowserActionPayloadDom(entry.payload);
    if (nextPayload === entry.payload) continue;
    const prevMsg = out[entry.index];
    out[entry.index] = openStudioReplaceToolResultPayload(prevMsg, /** @type {Record<string, unknown>} */ (nextPayload), entry.textIndex);
    changed = true;
  }
  return changed ? out : messages;
}

// OPEN_STUDIO_BROWSER_OBSERVATION_PRUNE_END

module.exports = {
  normalizePageUrl: openStudioNormalizePageUrl,
  isBrowserActionToolName: openStudioIsBrowserActionToolName,
  isNavigationAction: openStudioIsNavigationAction,
  stepsIncludeNavigation: openStudioStepsIncludeNavigation,
  advancePageGeneration: openStudioAdvancePageGeneration,
  stripObservationDom: openStudioStripObservationDom,
  stripBrowserActionPayloadDom: openStudioStripBrowserActionPayloadDom,
  pruneStaleBrowserActionDom: openStudioPruneStaleBrowserActionDom,
  // Prefixed names for OpenClaw inlining
  openStudioNormalizePageUrl,
  openStudioIsBrowserActionToolName,
  openStudioIsNavigationAction,
  openStudioStepsIncludeNavigation,
  openStudioAdvancePageGeneration,
  openStudioStripObservationDom,
  openStudioStripBrowserActionPayloadDom,
  openStudioPruneStaleBrowserActionDom,
};
