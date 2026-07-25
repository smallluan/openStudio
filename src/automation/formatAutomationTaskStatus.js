import {
  isAutomationBackoffActive,
  resolveAutomationEffectiveNextRunAtMs,
} from "./automationScheduleNext.js";

/**
 * @param {number} remainingMs
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 */
export function formatAutomationCountdown(remainingMs, t) {
  const ms = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0;
  if (ms <= 0) return t("automationPage.runStartsNow");
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return t("automationPage.runStartsInSeconds", { n: totalSec });
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    if (seconds === 0) return t("automationPage.runStartsInMinutes", { n: minutes });
    return t("automationPage.runStartsInMinutesSeconds", { min: minutes, sec: seconds });
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return t("automationPage.runStartsInHours", { n: hours });
  return t("automationPage.runStartsInHoursMinutes", { hr: hours, min: remMinutes });
}

/**
 * @param {{
 *   lastRunStatus?: string;
 *   nextRunAtMs?: number;
 *   consecutiveErrors?: number;
 *   schedule?: { kind?: string; everyMs?: number; anchorMs?: number };
 *   lastError?: string;
 *   lastDiagnosticSummary?: string;
 * }} task
 * @param {number} nowMs
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 */
export function formatAutomationTaskStatusLabel(task, nowMs, t) {
  const status = String(task.lastRunStatus ?? "").trim();
  const displayNext = resolveAutomationEffectiveNextRunAtMs(task, nowMs);
  const nextPart =
    displayNext != null && displayNext > nowMs
      ? formatAutomationCountdown(displayNext - nowMs, t)
      : "";

  if (status === "running") return t("automationPage.runStatusRunning");
  if (status === "error") {
    if (nextPart && isAutomationBackoffActive(task, nowMs)) {
      return t("automationPage.runStatusErrorRetry", { time: nextPart });
    }
    const base = t("automationPage.runStatusError");
    return nextPart ? `${base} · ${nextPart}` : base;
  }
  if (status === "skipped") return nextPart || t("automationPage.runStatusSkipped");
  if (status === "ok") return nextPart || t("automationPage.runStatusOk");
  if (nextPart) return nextPart;
  return t("automationPage.runStatusUnknown");
}

/**
 * @param {{
 *   lastRunStatus?: string;
 *   lastError?: string;
 *   lastDiagnosticSummary?: string;
 * }} task
 */
export function formatAutomationTaskErrorDetail(task) {
  if (String(task.lastRunStatus ?? "") !== "error") return "";
  const summary = String(task.lastDiagnosticSummary ?? "").trim();
  if (summary) return summary;
  const raw = String(task.lastError ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^FailoverError:\s*/i, "").trim();
}

/**
 * @param {{
 *   lastRunStatus?: string;
 *   nextRunAtMs?: number;
 *   schedule?: { kind?: string; everyMs?: number; anchorMs?: number };
 * }} task
 * @param {number} [nowMs]
 */
export function automationTaskStatusTone(task, nowMs = Date.now()) {
  const status = String(task.lastRunStatus ?? "").trim();
  if (status === "running") return "accent";
  if (status === "error") return "danger";
  if (status === "ok") return "success";
  const displayNext = resolveAutomationEffectiveNextRunAtMs(task, nowMs);
  if (displayNext != null && displayNext > nowMs) return "accent";
  return "muted";
}
