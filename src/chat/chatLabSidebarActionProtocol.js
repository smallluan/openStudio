import {
  normalizeAutomationSteps,
  SIDEBAR_AUTOMATION_DEFAULT_MAX_STEPS_PER_TURN,
  SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN,
} from "./chatLabPreviewAutomation.js";

/** @typedef {import("./chatLabPreviewAutomation.js").SidebarAutomationStep} SidebarAutomationStep */

export { SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN };

/** Max observe→act continue turns after sidebar-action executions. */
export const SIDEBAR_AUTOMATION_MAX_CONTINUES = 12;

function createFenceRe() {
  return /```\s*sidebar-action[^\n]*\r?\n([\s\S]*?)```/gi;
}

const SIDEBAR_ACTION_HINT_RE = /"action"\s*:\s*"(click|measure-click|focus|blur|type|type_chars|press|wait|scroll|snapshot|navigate|mousedown|mouseup|pointerdown|pointerup|mousemove|pointermove|hover|dblclick|rightclick|contextmenu|drag)"/i;

/**
 * @param {unknown} row
 */
function isClientSidebarAutomationToolRow(row) {
  const id = String(row && typeof row === "object" ? row.id : "");
  const toolName = String(row && typeof row === "object" ? row.toolName : "");
  return (
    id.startsWith("sidebar-auto:") ||
    id.startsWith("browser-auto:") ||
    toolName === "browser_action" ||
    toolName === "sidebar_action" ||
    toolName.endsWith(".browser_action") ||
    toolName.endsWith("/browser_action") ||
    toolName.endsWith(".sidebar_action") ||
    toolName.endsWith("/sidebar_action")
  );
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
  const maxPerTurn = Math.min(
    SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN,
    Math.max(1, opts.maxPerTurn ?? SIDEBAR_AUTOMATION_DEFAULT_MAX_STEPS_PER_TURN),
  );
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
 * Prefers `sidebarAutomationSteps` when the UI already parsed & stashed them
 * (content fences may have been stripped for display).
 * @param {{
 *   content?: string;
 *   sidebarAutomationSteps?: SidebarAutomationStep[];
 *   toolTrace?: Array<{ id?: string; toolName?: string; args?: unknown; result?: string; partialResult?: string; summary?: string }>;
 *   activityLog?: Array<{ text?: string }>;
 *   assistantTimeline?: Array<{ kind?: string; body?: string }>;
 * }} message
 * @param {{ maxPerTurn?: number }} [opts]
 * @returns {SidebarAutomationStep[]}
 */
export function extractSidebarActionStepsFromAssistantMessage(message, opts = {}) {
  const maxPerTurn = Math.min(
    SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN,
    Math.max(1, opts.maxPerTurn ?? SIDEBAR_AUTOMATION_DEFAULT_MAX_STEPS_PER_TURN),
  );
  const stashed = normalizeAutomationSteps(message?.sidebarAutomationSteps, { maxSteps: maxPerTurn });
  if (stashed.length) return stashed;

  /** @type {string[]} */
  const sources = [];
  sources.push(String(message?.content ?? ""));
  for (const seg of message?.assistantTimeline ?? []) {
    if (seg?.kind === "text") sources.push(String(seg.body ?? ""));
  }
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
export function isSidebarAutomationContinueUserMessage(content) {
  return String(content ?? "").startsWith("[sidebar-automation-continue]");
}

/**
 * @param {string} content
 */
export function isSidebarAutomationInternalUserMessage(content) {
  return (
    isSidebarAutomationHandoffUserMessage(content) ||
    isSidebarAutomationRetryUserMessage(content) ||
    isSidebarAutomationContinueUserMessage(content)
  );
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
 * @param {Array<{ id?: string; role?: string; content?: string }>} messages
 * @param {string} assistantId
 */
export function findUserRequestBeforeAssistant(messages, assistantId) {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return "";
  for (let i = idx - 1; i >= 0; i--) {
    const row = messages[i];
    if (row?.role !== "user") continue;
    const text = String(row.content ?? "");
    if (isSidebarAutomationInternalUserMessage(text)) continue;
    return text;
  }
  return "";
}

/**
 * @param {unknown} result
 */
export function automationHadFailure(result) {
  if (!result || result.ok === false) return true;
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  return steps.some((s) => s && s.ok === false);
}

/**
 * @param {unknown} result
 */
export function formatSidebarAutomationResultMessage(result) {
  return `[sidebar-automation-result]\n请根据以下执行结果直接用自然语言回答用户；不要输出 sidebar-action 代码块，不要重复操作步骤。\n${JSON.stringify(result, null, 2)}`;
}

/**
 * Observe→act handoff after each sidebar-action batch.
 * @param {{
 *   originalRequest?: string;
 *   requestedSteps?: SidebarAutomationStep[];
 *   result?: { ok?: boolean; error?: string; steps?: Array<Record<string, unknown>>; stoppedAt?: number };
 *   observationBlock?: string;
 *   turn?: number;
 *   maxTurns?: number;
 * }} input
 */
export function formatSidebarAutomationContinueMessage(input) {
  const turn = Math.max(1, Number(input.turn) || 1);
  const maxTurns = Math.max(turn, Number(input.maxTurns) || SIDEBAR_AUTOMATION_MAX_CONTINUES);
  const requested = Array.isArray(input.requestedSteps) ? input.requestedSteps : [];
  const executed = Array.isArray(input.result?.steps) ? input.result.steps : [];
  const failed = automationHadFailure(input.result);
  const observationRaw = String(input.observationBlock ?? "").trim();
  const observation =
    observationRaw.length > 6000
      ? `${observationRaw.slice(0, 6000)}\n…(observation truncated; full snapshot also in system previewContext)`
      : observationRaw;

  return `[sidebar-automation-continue]
页面操作工具已执行完本轮步骤（第 ${turn}/${maxTurns} 轮观察）。请根据**执行结果**与下方**最新页面观测**决定下一步。

**原始用户请求：**
${String(input.originalRequest ?? "").trim() || "（未找到）"}

**本轮请求步骤：**
\`\`\`json
${JSON.stringify(requested, null, 2)}
\`\`\`

**执行结果：**
\`\`\`json
${JSON.stringify(
  {
    ok: input.result?.ok !== false && !failed,
    error: input.result?.error ?? null,
    stoppedAt:
      typeof input.result?.stoppedAt === "number" ? input.result.stoppedAt + 1 : null,
    steps: executed,
  },
  null,
  2,
)}
\`\`\`

${observation ? `**最新页面观测（已注入系统上下文，此处为摘要）：**\n${observation}\n` : ""}
**要求：**
- 若任务未完成：再输出下一批 \`\`\`sidebar-action\`\`\`（最多 ${SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN} 步）；优先用观测清单里的 \`ref\`（如 \`"ref":"e3"\`）或 \`selector\`
- 禁止臆造自然语言 \`target\`；禁止一次规划超长剧本
- 若任务已完成或无法继续：用自然语言直接回答用户，**不要**再输出 sidebar-action
- 不要向用户解释内部协议标签`;
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

/**
 * Strip sidebar-action fences from assistant timeline text segments (display + merge).
 * @param {Array<{ kind?: string; body?: string; refId?: string }> | undefined | null} timeline
 */
export function stripSidebarActionFencesFromTimeline(timeline) {
  if (!Array.isArray(timeline) || !timeline.length) return timeline ?? undefined;
  /** @type {typeof timeline} */
  const out = [];
  for (const seg of timeline) {
    if (!seg || typeof seg !== "object") continue;
    if (seg.kind === "text") {
      const body = stripSidebarActionFences(String(seg.body ?? ""));
      if (!body) continue;
      out.push({ ...seg, body });
      continue;
    }
    out.push(seg);
  }
  return out.length ? out : undefined;
}
