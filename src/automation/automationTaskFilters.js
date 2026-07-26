import { resolveAutomationEffectiveNextRunAtMs } from "./automationScheduleNext.js";

export const AUTOMATION_TASK_TAB_ALL = "all";
export const AUTOMATION_TASK_TAB_EXPIRED = "expired";
export const AUTOMATION_TASK_TAB_UPCOMING = "upcoming";
export const AUTOMATION_TASK_TAB_RECENT = "recent";

export const AUTOMATION_TASK_TAB_WINDOW_MS = 30 * 60 * 1000;

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 */
export function isAutomationOnceTask(task) {
  const meta = task?.meta && typeof task.meta === "object" ? task.meta : {};
  if (String(meta.frequencyMode ?? "").trim() === "once") return true;
  const schedule = task?.schedule;
  return Boolean(schedule && typeof schedule === "object" && String(schedule.kind ?? "").trim() === "at");
}

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 */
export function resolveAutomationOnceScheduledAtMs(task) {
  const schedule = task?.schedule;
  if (schedule && typeof schedule === "object" && schedule.kind === "at" && schedule.at) {
    const atMs = Date.parse(String(schedule.at));
    if (Number.isFinite(atMs)) return atMs;
  }

  const meta = task?.meta && typeof task.meta === "object" ? task.meta : {};
  const date = String(meta.onceDate ?? "").trim();
  if (!date) return null;
  const time = String(meta.onceTime ?? "09:00").trim();
  const parts = date.split("-").map((x) => Number.parseInt(x, 10));
  if (parts.length < 3 || !parts.every(Number.isFinite)) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(time);
  const hour = clock ? Number.parseInt(clock[1], 10) : 9;
  const minute = clock ? Number.parseInt(clock[2], 10) : 0;
  const dt = new Date(parts[0], parts[1] - 1, parts[2], hour, minute, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/**
 * One-time tasks that have finished or missed their only scheduled slot.
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 * @param {number} nowMs
 */
export function isAutomationTaskExpired(task, nowMs) {
  if (!isAutomationOnceTask(task)) return false;

  const lastRunAt = Number(task.lastRunAtMs);
  if (Number.isFinite(lastRunAt) && lastRunAt > 0) return true;

  const displayNext = resolveAutomationEffectiveNextRunAtMs(task, nowMs);
  if (displayNext != null && displayNext > nowMs) return false;

  const scheduledAt = resolveAutomationOnceScheduledAtMs(task);
  if (scheduledAt != null && scheduledAt <= nowMs) return true;

  const status = String(task.lastRunStatus ?? "").trim();
  if (
    (status === "ok" || status === "error" || status === "skipped") &&
    (displayNext == null || displayNext <= nowMs)
  ) {
    return true;
  }

  return false;
}

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 * @param {number} nowMs
 * @param {number} [windowMs]
 */
export function isAutomationTaskUpcoming(task, nowMs, windowMs = AUTOMATION_TASK_TAB_WINDOW_MS) {
  if (task.enabled === false) return false;
  if (isAutomationTaskExpired(task, nowMs)) return false;
  if (String(task.lastRunStatus ?? "").trim() === "running") return false;

  const displayNext = resolveAutomationEffectiveNextRunAtMs(task, nowMs);
  if (displayNext == null || !Number.isFinite(displayNext)) return false;
  return displayNext > nowMs && displayNext <= nowMs + windowMs;
}

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 * @param {number} nowMs
 * @param {number} [windowMs]
 */
export function isAutomationTaskRecentlyExecuted(task, nowMs, windowMs = AUTOMATION_TASK_TAB_WINDOW_MS) {
  if (String(task.lastRunStatus ?? "").trim() === "running") return true;

  const lastRunAt = Number(task.lastRunAtMs);
  if (!Number.isFinite(lastRunAt) || lastRunAt <= 0) return false;
  return lastRunAt >= nowMs - windowMs && lastRunAt <= nowMs;
}

/**
 * @param {import("./useAutomationTasks.js").AutomationTaskCard} task
 * @param {string} tab
 * @param {number} nowMs
 */
export function matchesAutomationTaskTab(task, tab, nowMs) {
  switch (tab) {
    case AUTOMATION_TASK_TAB_EXPIRED:
      return isAutomationTaskExpired(task, nowMs);
    case AUTOMATION_TASK_TAB_UPCOMING:
      return isAutomationTaskUpcoming(task, nowMs);
    case AUTOMATION_TASK_TAB_RECENT:
      return isAutomationTaskRecentlyExecuted(task, nowMs);
    case AUTOMATION_TASK_TAB_ALL:
    default:
      return true;
  }
}
