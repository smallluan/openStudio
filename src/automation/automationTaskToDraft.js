import { MAIN_AGENT_STUDIO_ID } from "../studio/agents.js";
import { resolveAutomationFrequencyFields } from "./resolveAutomationFrequency.js";

/**
 * @param {unknown[]} values
 */
function pickFirstNonEmptyText(values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * @param {unknown[]} values
 */
function resolveDraftChannel(values) {
  const raw = pickFirstNonEmptyText(values).toLowerCase();
  if (!raw) return "open-studio";
  if (raw === "internal" || raw === "studio" || raw === "openstudio") return "open-studio";
  if (raw === "weixin") return "wechat";
  return raw;
}

/**
 * @returns {import("../components/automation/AutomationTaskDialog.jsx").AutomationTaskDraft}
 */
export function emptyAutomationTaskDraft() {
  return {
    name: "",
    prompt: "",
    modelId: "",
    agentId: "",
    skillRow: null,
    workflowId: "",
    channel: "",
    frequencyMode: "period",
    periodCycle: "daily",
    periodTime: "09:00",
    intervalValue: 1,
    intervalUnit: "hour",
    onceDate: "",
    onceTime: "09:00",
    effectiveRange: [],
  };
}

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 * @returns {import("../components/automation/AutomationTaskDialog.jsx").AutomationTaskDraft}
 */
export function automationTaskToDraft(task) {
  const meta = task.meta && typeof task.meta === "object" ? task.meta : {};
  const cronJob =
    task.cronJob && typeof task.cronJob === "object"
      ? /** @type {Record<string, unknown>} */ (task.cronJob)
      : null;
  const schedule =
    (meta.schedule && typeof meta.schedule === "object" ? meta.schedule : null) ??
    (task.schedule && typeof task.schedule === "object" ? task.schedule : null) ??
    (cronJob?.schedule && typeof cronJob.schedule === "object" ? cronJob.schedule : null);
  const frequency = resolveAutomationFrequencyFields(meta, schedule);

  const cronName = typeof cronJob?.name === "string" ? cronJob.name.trim() : "";
  const cronPayload =
    cronJob?.payload && typeof cronJob.payload === "object"
      ? /** @type {{ message?: string }} */ (cronJob.payload)
      : null;
  const storedMessage = typeof meta.message === "string" ? meta.message.trim() : "";
  const payloadMessage =
    typeof cronPayload?.message === "string" ? cronPayload.message.trim() : "";
  const name = pickFirstNonEmptyText([
    task.name,
    meta.name,
    cronName,
    meta.title,
    task.prompt,
    meta.prompt,
    storedMessage,
    payloadMessage,
  ]);
  const prompt = pickFirstNonEmptyText([task.prompt, meta.prompt, storedMessage, payloadMessage]);
  const channel = resolveDraftChannel([task.channel, meta.channel, "open-studio"]);
  const modelId = pickFirstNonEmptyText([meta.modelProfileId]);
  const agentId = pickFirstNonEmptyText([meta.agentId, MAIN_AGENT_STUDIO_ID]);
  const workflowId = pickFirstNonEmptyText([meta.workflowId]);

  return {
    name,
    prompt,
    modelId,
    agentId,
    skillRow: null,
    workflowId,
    channel,
    ...frequency,
    effectiveRange: Array.isArray(meta.effectiveRange)
      ? meta.effectiveRange.map((v) => String(v ?? "").trim()).filter(Boolean)
      : [],
  };
}

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 */
export function automationTaskSkillMeta(task) {
  const meta = task.meta && typeof task.meta === "object" ? task.meta : {};
  const sm = meta.skillMeta;
  if (!sm || typeof sm !== "object") return null;
  return sm;
}
