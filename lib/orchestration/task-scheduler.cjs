"use strict";

const { patchPlanTask, taskIsExecutable } = require("./core.cjs");

const ORCHESTRATION_TASK_CONCURRENCY = 4;

function taskKindRank(task) {
  const kind = task.taskKind || (task.phase === "review" ? "review" : "work");
  return kind === "review" ? 0 : 1;
}

/**
 * @param {import("./core.cjs").OrchestrationPlan} initialPlan
 * @param {object} hooks
 * @param {{ maxConcurrency?: number }} [opts]
 */
async function runOrchestrationTaskDag(initialPlan, hooks, opts = {}) {
  const maxConcurrency = Math.max(1, opts.maxConcurrency ?? ORCHESTRATION_TASK_CONCURRENCY);
  let plan = { ...initialPlan, tasks: initialPlan.tasks.map((t) => ({ ...t })) };
  /** @type {Record<string, unknown>} */
  let runPatch = {};

  const inflight = new Map();
  const busyAgentIds = new Set();
  const loadByAgent = new Map();

  const doneIds = () => new Set(plan.tasks.filter((t) => t.status === "done").map((t) => t.id));

  const isPending = (t) => taskIsExecutable(t);

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
    const ready = plan.tasks
      .filter(isReady)
      .sort((a, b) => taskKindRank(a) - taskKindRank(b));
    for (const task of ready) {
      if (inflight.size >= maxConcurrency) break;
      const owner = hooks.pickOwner(task, busyAgentIds, loadByAgent);
      if (!owner) continue;

      busyAgentIds.add(owner.id);
      loadByAgent.set(owner.id, (loadByAgent.get(owner.id) ?? 0) + 1);
      plan = patchPlanTask(plan, task.id, { status: "in_progress", ownerAgentId: owner.id });
      const planSnapshot = { ...plan, tasks: plan.tasks.map((t) => ({ ...t })) };
      hooks.onTaskStart?.(task, owner, planSnapshot);
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

module.exports = {
  ORCHESTRATION_TASK_CONCURRENCY,
  runOrchestrationTaskDag,
};
