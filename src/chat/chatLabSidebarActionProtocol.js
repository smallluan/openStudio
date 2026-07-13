import { normalizeAutomationSteps, SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN } from "./chatLabPreviewAutomation.js";

/** @typedef {import("./chatLabPreviewAutomation.js").SidebarAutomationStep} SidebarAutomationStep */

export { SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN };

function createFenceRe() {
  return /```\s*sidebar-action[^\n]*\r?\n([\s\S]*?)```/gi;
}

const SIDEBAR_ACTION_HINT_RE = /"action"\s*:\s*"(click|focus|blur|type|type_chars|press|wait|scroll|snapshot|navigate|mousedown|mouseup|pointerdown|pointerup|mousemove|pointermove|hover|dblclick|rightclick|contextmenu|drag)"/i;

/**
 * @param {unknown} row
 */
function isClientSidebarAutomationToolRow(row) {
  const id = String(row && typeof row === "object" ? row.id : "");
  const toolName = String(row && typeof row === "object" ? row.toolName : "");
  return id.startsWith("sidebar-auto:") || toolName === "sidebar-action";
}

/**
 * @param {unknown} value
 * @param {string[]} out
 */
function collectSidebarActionSourceTexts(value, out) {
  if (value == null) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;
    if (/```\s*sidebar-action\b/i.test(text) || SIDEBAR_ACTION_HINT_RE.test(text)) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSidebarActionSourceTexts(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectSidebarActionSourceTexts(v, out);
  }
}

/**
 * @param {string} body
 * @param {number} maxSteps
 * @returns {SidebarAutomationStep[]}
 */
function parseSidebarActionPayload(body, maxSteps) {
  const text = String(body ?? "").trim();
  if (!text) return [];
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  return normalizeAutomationSteps(parsed, { maxSteps });
}

/**
 * @param {string} content
 */
export function looksLikeSidebarActionMessage(content) {
  return /```\s*sidebar-action\b/i.test(String(content ?? "")) || SIDEBAR_ACTION_HINT_RE.test(String(content ?? ""));
}

/**
 * @param {string} text
 * @param {{ maxPerTurn?: number }} [opts]
 * @returns {SidebarAutomationStep[]}
 */
export function extractSidebarActionStepsFromText(text, opts = {}) {
  const maxPerTurn = Math.max(1, opts.maxPerTurn ?? SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN);
  const blob = String(text ?? "");
  /** @type {SidebarAutomationStep[]} */
  const all = [];
  for (const match of blob.matchAll(createFenceRe())) {
    all.push(...parseSidebarActionPayload(match[1], maxPerTurn - all.length));
    if (all.length >= maxPerTurn) break;
  }
  if (!all.length && SIDEBAR_ACTION_HINT_RE.test(blob)) {
    all.push(...parseSidebarActionPayload(blob, maxPerTurn));
  }
  return all.slice(0, maxPerTurn);
}

/**
 * @param {string} content
 * @param {{ maxPerTurn?: number }} [opts]
 * @returns {SidebarAutomationStep[]}
 */
export function extractSidebarActionSteps(content, opts = {}) {
  return extractSidebarActionStepsFromText(content, opts);
}

/**
 * Extract sidebar-action steps from assistant body **and** gateway tool args/results
 * (e.g. when the model wrongly nests steps inside `sessions_yield.message`).
 * @param {{
 *   content?: string;
 *   toolTrace?: Array<{ id?: string; toolName?: string; args?: unknown; result?: string; partialResult?: string; summary?: string }>;
 *   activityLog?: Array<{ text?: string }>;
 * }} message
 * @param {{ maxPerTurn?: number }} [opts]
 * @returns {SidebarAutomationStep[]}
 */
export function extractSidebarActionStepsFromAssistantMessage(message, opts = {}) {
  const maxPerTurn = Math.max(1, opts.maxPerTurn ?? SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN);
  /** @type {string[]} */
  const sources = [];
  sources.push(String(message?.content ?? ""));
  for (const row of message?.toolTrace ?? []) {
    if (isClientSidebarAutomationToolRow(row)) continue;
    sources.push(String(row?.result ?? ""));
    sources.push(String(row?.partialResult ?? ""));
    sources.push(String(row?.summary ?? ""));
    collectSidebarActionSourceTexts(row?.args, sources);
  }
  for (const row of message?.activityLog ?? []) {
    collectSidebarActionSourceTexts(row?.text, sources);
  }

  /** @type {SidebarAutomationStep[]} */
  const all = [];
  const seen = new Set();
  for (const src of sources) {
    for (const step of extractSidebarActionStepsFromText(src, { maxPerTurn: maxPerTurn - all.length })) {
      const key = JSON.stringify(step);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(step);
      if (all.length >= maxPerTurn) return all;
    }
  }
  return all;
}

/**
 * @param {string} content
 */
export function isSidebarAutomationHandoffUserMessage(content) {
  return String(content ?? "").startsWith("[sidebar-automation-result]");
}

/**
 * @param {string} content
 */
export function isSidebarAutomationRetryUserMessage(content) {
  return String(content ?? "").startsWith("[sidebar-automation-retry]");
}

/**
 * @param {string} content
 */
export function isSidebarAutomationInternalUserMessage(content) {
  return isSidebarAutomationHandoffUserMessage(content) || isSidebarAutomationRetryUserMessage(content);
}

/**
 * @param {string} content
 * @param {boolean} [streaming]
 */
export function isSidebarAutomationCarrierContent(content, streaming = false) {
  const text = String(content ?? "");
  if (!looksLikeSidebarActionMessage(text)) return false;
  if (streaming) return true;
  return extractSidebarActionSteps(text).length > 0;
}

/**
 * @param {{
 *   content?: string;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 * }} message
 * @param {boolean} [streaming]
 */
export function isSidebarAutomationCarrierMessage(message, streaming = false) {
  if (streaming) {
    const text = String(message?.content ?? "");
    if (looksLikeSidebarActionMessage(text)) return true;
    /** @type {string[]} */
    const probe = [];
    for (const row of message?.toolTrace ?? []) {
      if (isClientSidebarAutomationToolRow(row)) continue;
      collectSidebarActionSourceTexts(row, probe);
    }
    return probe.length > 0;
  }
  return extractSidebarActionStepsFromAssistantMessage(message).length > 0;
}

/**
 * @deprecated Prefer isSidebarAutomationCarrierMessage for UI; kept for narrow hide checks.
 * @param {string} content
 */
export function shouldHideSidebarActionAssistantMessage(content) {
  return isSidebarAutomationCarrierContent(content, false);
}

/**
 * @param {unknown} result
 */
export function formatSidebarAutomationResultMessage(result) {
  return `[sidebar-automation-result]\n请根据以下执行结果直接用自然语言回答用户；不要输出 sidebar-action 代码块，不要重复操作步骤。\n${JSON.stringify(result, null, 2)}`;
}

/**
 * @param {string} content
 */
export function stripSidebarActionFences(content) {
  return String(content ?? "")
    .replace(createFenceRe(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
