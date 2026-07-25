export const AUTOMATION_EXECUTION_PREFIX = "[openstudio-automation-run]";

/**
 * @param {string} content
 */
export function isAutomationExecutionUserMessage(content) {
  return String(content ?? "").startsWith(AUTOMATION_EXECUTION_PREFIX);
}

/**
 * Wrap a scheduled-task payload for the gateway so the model executes the task
 * instead of treating the prompt as a request to create a new reminder/cron job.
 *
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {{ taskName?: string; prompt?: string; message?: string }} input
 */
export function formatAutomationExecutionUserMessage(t, input) {
  const instruction = String(input?.message ?? input?.prompt ?? "").trim();
  if (!instruction) return "";

  const taskName = String(input?.taskName ?? "").trim();
  const taskNameLine = taskName
    ? t("chatLab.automationExecutionTaskNameLine", { name: taskName })
    : "";

  const body = t("chatLab.automationExecutionUserTurn", {
    taskNameLine,
    instruction,
  });

  return `${AUTOMATION_EXECUTION_PREFIX}\n${body}`.trim();
}
