import { MAIN_AGENT_STUDIO_ID } from "../studio/agents.js";

/**
 * @param {number} everyMs
 */
function intervalUnitFromEveryMs(everyMs) {
  const ms = Number(everyMs);
  if (!Number.isFinite(ms) || ms <= 0) return { intervalValue: 1, intervalUnit: "hour" };
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms % day === 0) return { intervalValue: ms / day, intervalUnit: "day" };
  if (ms % hour === 0) return { intervalValue: ms / hour, intervalUnit: "hour" };
  if (ms % minute === 0) return { intervalValue: ms / minute, intervalUnit: "minute" };
  return { intervalValue: Math.max(1, Math.round(ms / hour)), intervalUnit: "hour" };
}

/**
 * @param {Record<string, unknown>} meta
 * @param {{ kind?: string; everyMs?: number; expr?: string; at?: string } | null | undefined} schedule
 */
function resolveFrequencyFields(meta, schedule) {
  const frequencyMode = String(meta.frequencyMode ?? "").trim();
  if (frequencyMode === "interval" || frequencyMode === "once" || frequencyMode === "period") {
    return {
      frequencyMode,
      periodCycle: String(meta.periodCycle ?? "daily"),
      periodTime: String(meta.periodTime ?? "09:00"),
      intervalValue: Number(meta.intervalValue) > 0 ? Number(meta.intervalValue) : 1,
      intervalUnit: String(meta.intervalUnit ?? "hour"),
      onceDate: String(meta.onceDate ?? "").trim(),
      onceTime: String(meta.onceTime ?? "09:00"),
    };
  }

  const kind = String(schedule?.kind ?? "").trim();
  if (kind === "every" && schedule?.everyMs != null) {
    const { intervalValue, intervalUnit } = intervalUnitFromEveryMs(Number(schedule.everyMs));
    return {
      frequencyMode: "interval",
      periodCycle: "daily",
      periodTime: "09:00",
      intervalValue,
      intervalUnit,
      onceDate: "",
      onceTime: "09:00",
    };
  }
  if (kind === "at" && schedule?.at) {
    const at = new Date(String(schedule.at));
    if (!Number.isNaN(at.getTime())) {
      const pad = (n) => String(n).padStart(2, "0");
      return {
        frequencyMode: "once",
        periodCycle: "daily",
        periodTime: "09:00",
        intervalValue: 1,
        intervalUnit: "hour",
        onceDate: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
        onceTime: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
      };
    }
  }
  if (kind === "cron" && schedule?.expr) {
    const parts = String(schedule.expr).trim().split(/\s+/);
    const minute = parts[0] ?? "0";
    const hour = parts[1] ?? "9";
    const dayOfMonth = parts[2] ?? "*";
    const dayOfWeek = parts[4] ?? "*";
    let periodCycle = "daily";
    if (dayOfWeek !== "*") periodCycle = "weekly";
    else if (dayOfMonth !== "*") periodCycle = "monthly";
    return {
      frequencyMode: "period",
      periodCycle,
      periodTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      intervalValue: 1,
      intervalUnit: "hour",
      onceDate: "",
      onceTime: "09:00",
    };
  }

  return {
    frequencyMode: "period",
    periodCycle: String(meta.periodCycle ?? "daily"),
    periodTime: String(meta.periodTime ?? "09:00"),
    intervalValue: Number(meta.intervalValue) > 0 ? Number(meta.intervalValue) : 1,
    intervalUnit: String(meta.intervalUnit ?? "hour"),
    onceDate: String(meta.onceDate ?? "").trim(),
    onceTime: String(meta.onceTime ?? "09:00"),
  };
}

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
  const frequency = resolveFrequencyFields(meta, schedule);

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
