import { patchPlanTask } from "../studio/orchestration.js";

/** Default parallel task cap for orchestration development/review. */
export const ORCHESTRATION_TASK_CONCURRENCY = 8;

/**
 * @typedef {import("../studio/orchestration.js").OrchestrationPlan} OrchestrationPlan
 * @typedef {import("../studio/orchestration.js").OrchestrationTask} OrchestrationTask
 * @typedef {import("../studio/agents.js").LobsterAgent} LobsterAgent
 */

/**
 * @typedef {object} TaskRunOutcome
 * @property {Array<{ taskId: string; patch: Record<string, unknown> }>} planPatches
 * @property {Record<string, unknown>} [runPatch]
 */

/**
 * @typedef {object} OrchestrationDagHooks
 * @property {(task: OrchestrationTask, busyAgentIds: Set<string>, loadByAgent: Map<string, number>) => LobsterAgent | null} pickOwner
 * @property {(task: OrchestrationTask, owner: LobsterAgent, planSnapshot: OrchestrationPlan) => Promise<TaskRunOutcome>} executeTask
 * @property {(task: OrchestrationTask, owner: LobsterAgent) => void} [onTaskStart]
 * @property {() => void} [checkPaused]
 * @property {() => Promise<void>} [waitIfPaused]
 * @property {(plan: OrchestrationPlan, runPatch: Record<string, unknown>) => void | Promise<void>} [onPlanUpdate]
 * @property {(readyTasks: OrchestrationTask[], plan: OrchestrationPlan) => OrchestrationPlan | void} [resolveBlockedTasks]
 */

/**
 * Event-driven DAG scheduler — tasks start as soon as dependencies complete; no batch barriers.
 *
 * @param {OrchestrationPlan} initialPlan
 * @param {OrchestrationDagHooks} hooks
 * @param {{ maxConcurrency?: number }} [opts]
 * @returns {Promise<{ plan: OrchestrationPlan; runPatch: Record<string, unknown> }>}
 */
export async function runOrchestrationTaskDag(initialPlan, hooks, opts = {}) {
  const maxConcurrency = Math.max(1, opts.maxConcurrency ?? ORCHESTRATION_TASK_CONCURRENCY);
  let plan = { ...initialPlan, tasks: initialPlan.tasks.map((t) => ({ ...t })) };
  /** @type {Record<string, unknown>} */
  let runPatch = {};

  /** @type {Map<string, Promise<void>>} */
  const inflight = new Map();
  /** @type {Set<string>} */
  const busyAgentIds = new Set();
  /** @type {Map<string, number>} */
  const loadByAgent = new Map();

  const doneIds = () => new Set(plan.tasks.filter((t) => t.status === "done").map((t) => t.id));

  const isPending = (t) =>
    (t.phase === "development" || t.phase === "review") && t.status !== "done" && t.status !== "blocked";

  const isReady = (t) => {
    if (!isPending(t)) return false;
    if (t.status !== "todo" && t.status !== "blocked") return false;
    if (inflight.has(t.id)) return false;
    return t.dependsOn.every((dep) => doneIds().has(dep));
  };

  const applyPatches = (patches) => {
    for (const { taskId, patch } of patches) {
      plan = patchPlanTask(plan, taskId, patch);
    }
  };

  const dispatchReady = () => {
    const ready = plan.tasks.filter(isReady);
    for (const task of ready) {
      if (inflight.size >= maxConcurrency) break;
      const owner = hooks.pickOwner(task, busyAgentIds, loadByAgent);
      if (!owner) continue;

      busyAgentIds.add(owner.id);
      loadByAgent.set(owner.id, (loadByAgent.get(owner.id) ?? 0) + 1);
      plan = patchPlanTask(plan, task.id, { status: "in_progress", ownerAgentId: owner.id });
      hooks.onTaskStart?.(task, owner);

      const planSnapshot = { ...plan, tasks: plan.tasks.map((t) => ({ ...t })) };
      const runPromise = hooks
        .executeTask(task, owner, planSnapshot)
        .then(async (outcome) => {
          applyPatches(outcome.planPatches);
          if (outcome.runPatch && typeof outcome.runPatch === "object") {
            runPatch = { ...runPatch, ...outcome.runPatch };
          }
          await hooks.onPlanUpdate?.(plan, runPatch);
        })
        .finally(() => {
          inflight.delete(task.id);
          busyAgentIds.delete(owner.id);
          loadByAgent.set(owner.id, Math.max(0, (loadByAgent.get(owner.id) ?? 1) - 1));
        });

      inflight.set(task.id, runPromise);
    }
  };

  while (true) {
    await hooks.waitIfPaused?.();
    hooks.checkPaused?.();

    const pending = plan.tasks.filter(isPending);
    if (!pending.length && inflight.size === 0) break;

    dispatchReady();

    if (inflight.size === 0) {
      const blockedInProgress = pending.some((t) => t.status === "in_progress");
      if (blockedInProgress) break;
      const stillReady = plan.tasks.filter(isReady);
      if (stillReady.length) {
        const patched = hooks.resolveBlockedTasks?.(stillReady, plan);
        if (patched) {
          plan = patched;
          await hooks.onPlanUpdate?.(plan, runPatch);
        }
        const retryReady = plan.tasks.filter(isReady);
        if (retryReady.length) throw new Error("orchestration_deadlock");
        continue;
      }
      if (pending.length) break;
      break;
    }

    await Promise.race([...inflight.values()]);
    dispatchReady();
  }

  if (inflight.size) {
    await Promise.all([...inflight.values()]);
  }

  return { plan, runPatch };
}
