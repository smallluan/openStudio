import { resolveAutomationFrequencyFields } from "./resolveAutomationFrequency.js";

/**
 * @param {{
 *   frequencyMode?: string;
 *   periodCycle?: string;
 *   periodTime?: string;
 *   intervalValue?: number;
 *   intervalUnit?: string;
 *   onceDate?: string;
 *   onceTime?: string;
 * }} meta
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 * @param {{ kind?: string; everyMs?: number; expr?: string; at?: string } | null | undefined} [schedule]
 */
export function formatAutomationScheduleLabel(meta, t, schedule) {
  const frequency = resolveAutomationFrequencyFields(meta ?? {}, schedule);
  const mode = frequency.frequencyMode;
  if (mode === "once") {
    const date = String(frequency.onceDate ?? "").trim();
    const time = String(frequency.onceTime ?? "").trim();
    if (date && time) return t("automationPage.scheduleOnceAt", { date, time });
    if (date) return date;
    return t("automationPage.taskFrequencyOnce");
  }
  if (mode === "interval") {
    const value = Number(frequency.intervalValue) > 0 ? Number(frequency.intervalValue) : 1;
    const unit = String(frequency.intervalUnit ?? "hour").trim();
    const unitLabelKey =
      unit === "minute"
        ? "automationPage.taskIntervalUnitMinute"
        : unit === "day"
          ? "automationPage.taskIntervalUnitDay"
          : unit === "month"
            ? "automationPage.taskIntervalUnitMonth"
            : unit === "quarter"
              ? "automationPage.taskIntervalUnitQuarter"
              : unit === "year"
                ? "automationPage.taskIntervalUnitYear"
                : "automationPage.taskIntervalUnitHour";
    return t("automationPage.scheduleEvery", { value, unit: t(unitLabelKey) });
  }
  const time = String(frequency.periodTime ?? "09:00").trim();
  const cycle = String(frequency.periodCycle ?? "daily");
  if (cycle === "weekly") return t("automationPage.scheduleWeeklyAt", { time });
  if (cycle === "monthly") return t("automationPage.scheduleMonthlyAt", { time });
  return t("automationPage.scheduleDailyAt", { time });
}

/**
 * @param {string} channel
 * @param {(key: string) => string} t
 */
export function formatAutomationChannelLabel(channel, t) {
  if (channel === "wechat") return t("automationPage.taskChannelWechat");
  if (channel === "open-studio") return t("automationPage.taskChannelOpenStudio");
  return channel || t("automationPage.taskChannelOpenStudio");
}

/**
 * @param {string | undefined} status
 * @param {(key: string) => string} t
 */
export function formatAutomationRunStatus(status, t) {
  const s = String(status ?? "").trim();
  if (s === "ok") return t("automationPage.runStatusOk");
  if (s === "error") return t("automationPage.runStatusError");
  if (s === "skipped") return t("automationPage.runStatusSkipped");
  if (s === "running") return t("automationPage.runStatusRunning");
  return t("automationPage.runStatusUnknown");
}
