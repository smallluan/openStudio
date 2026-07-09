import { normalizeAutomationSteps } from "./chatLabPreviewAutomation.js";

/** @typedef {import("./chatLabPreviewAutomation.js").SidebarAutomationStep} SidebarAutomationStep */

/** Max sidebar-action steps executed in one assistant message (shown as tool-trace rows). */
export const SIDEBAR_AUTOMATION_MAX_STEPS_PER_TURN = 16;

/** Max automatic model re-plans after sidebar automation failures. */
export const SIDEBAR_AUTOMATION_MAX_RETRIES = 3;

function createFenceRe() {
  return /```\s*sidebar-action[^\n]*\r?\n([\s\S]*?)```/gi;
}

const SIDEBAR_ACTION_HINT_RE = /"action"\s*:\s*"(click|focus|blur|type|type_chars|press|wait|scroll|snapshot|navigate|verify)"/i;

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
  const steps = Array.isArray(result.steps) ? result.steps : [];
  return steps.some((s) => s && s.ok === false);
}

/**
 * @param {unknown} result
 */
export function shouldTriggerSidebarAutomationReplan(result) {
  return automationHadFailure(result);
}

/**
 * @param {{
 *   originalRequest?: string;
 *   requestedSteps?: SidebarAutomationStep[];
 *   result?: { ok?: boolean; error?: string; steps?: Array<Record<string, unknown>> };
 *   attempt?: number;
 *   maxAttempts?: number;
 * }} input
 */
export function formatSidebarAutomationRetryMessage(input) {
  const attempt = Math.max(1, Number(input.attempt) || 1);
  const maxAttempts = Math.max(attempt, Number(input.maxAttempts) || SIDEBAR_AUTOMATION_MAX_RETRIES);
  const requested = Array.isArray(input.requestedSteps) ? input.requestedSteps : [];
  const executed = Array.isArray(input.result?.steps) ? input.result.steps : [];
  const failed = executed
    .map((row, index) => ({
      index: index + 1,
      requested: requested[index] ?? null,
      executed: row,
      verifyHint:
        requested[index] && typeof requested[index].verifyHint === "string"
          ? requested[index].verifyHint
          : undefined,
    }))
    .filter((row) => row.executed && row.executed.ok === false);
  const stoppedAt =
    typeof input.result?.stoppedAt === "number" && Number.isFinite(input.result.stoppedAt)
      ? input.result.stoppedAt + 1
      : failed[0]?.index ?? null;

  return `[sidebar-automation-retry]
右侧边栏自动化第 ${attempt}/${maxAttempts} 次重规划：第 ${stoppedAt ?? "?"} 步执行或**验证未通过**，流程已暂停。系统已将**最新页面快照**注入到 sidebarPreviewContext，请根据快照和用户原始意图**重新输出完整** sidebar-action 步骤数组（写在回复正文，最多 12 步）。

**原始用户请求：**
${String(input.originalRequest ?? "").trim() || "（未找到）"}

**失败步骤（含 verify 期望）：**
\`\`\`json
${JSON.stringify(failed, null, 2)}
\`\`\`

**要求：**
- 每一步必须带 \`verify\`（或单独的 verify 步骤），写明如何确认上一步成功
- 用快照里的可见文字/DOM 结构解析模糊描述，换成可执行的 selector、label、placeholder、title 或 parentSelector
- 一次输出**全部**修正步骤（从第 1 步开始），不要分多条回复
- 搜索/提交：focus → type → press Enter（press 带 selector/title）
- 不要向用户解释失败，直接给出可执行步骤`;
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
