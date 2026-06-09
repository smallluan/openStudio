/**
 * @param {string} eventKey
 */
function camelOrchestrationEventKey(eventKey) {
  return String(eventKey ?? "").replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {Record<string, unknown>} eventMsg
 * @param {import("./orchestration.js").OrchestrationRun | null | undefined} run
 */
export function orchestrationEventVars(eventMsg, run) {
  /** @type {Record<string, string | number>} */
  const vars = {};
  if (typeof eventMsg.orchestrationWorkerId === "string" && eventMsg.orchestrationWorkerId) {
    vars.workerAgentId = eventMsg.orchestrationWorkerId;
  }
  const taskId =
    typeof eventMsg.orchestrationTaskId === "string" ? eventMsg.orchestrationTaskId.trim() : "";
  if (taskId && run?.plan?.tasks) {
    const task = run.plan.tasks.find((t) => t.id === taskId);
    if (task?.title) vars.title = task.title;
  }
  return vars;
}

/**
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {string} eventKey
 * @param {Record<string, string | number>} [vars]
 */
export function formatOrchestrationEvent(t, eventKey, vars = {}) {
  const key = String(eventKey ?? "").trim();
  if (!key) return "";
  const normalized = { ...vars };
  if (typeof normalized.agentLabel === "string" && !normalized.agent) {
    normalized.agent = normalized.agentLabel;
  }
  const snake = t(`orchestration.events.${key}`, { ...normalized, defaultValue: "" });
  if (snake && snake !== `orchestration.events.${key}`) return snake;
  const camel = camelOrchestrationEventKey(key);
  const camelLabel = t(`orchestration.events.${camel}`, { ...normalized, defaultValue: key });
  return camelLabel || key;
}

/**
 * Re-label persisted rows that still store raw event keys (e.g. task_start).
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {Record<string, unknown>} eventMsg
 * @param {import("./orchestration.js").OrchestrationRun} run
 * @param {Map<string, string>} [agentLabels]
 */
export function resolveOrchestrationEventTitle(t, eventMsg, run, agentLabels) {
  const stored = String(eventMsg.content ?? "").trim();
  const eventKey =
    typeof eventMsg.orchestrationEventKey === "string" ? eventMsg.orchestrationEventKey.trim() : "";
  if (!eventKey) return stored;
  if (stored && stored !== eventKey && !/^[a-z][a-z0-9_]*$/i.test(stored)) return stored;

  const vars = orchestrationEventVars(eventMsg, run);
  const workerId = typeof vars.workerAgentId === "string" ? vars.workerAgentId : "";
  if (workerId && agentLabels?.has(workerId)) {
    vars.agent = agentLabels.get(workerId);
    vars.agentLabel = vars.agent;
  }
  return formatOrchestrationEvent(t, eventKey, vars);
}
