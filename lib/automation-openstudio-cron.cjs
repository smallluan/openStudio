const { isStudioOnlyAutomationTaskId, resolveAutomationTaskChannel } = require("./automation-channel.cjs");
const { buildCronAddParams, draftToCronSchedule } = require("./automation-cron-bridge.cjs");
const { resolveAutomationDueSlotMs } = require("./automation-schedule-due.cjs");
const { syncGatewayCronJobsToAutomationStore } = require("./automation-cron-store-sync.cjs");
const { addCronJob, cancelGatewayTask, listCronJobs } = require("./openclaw-gateway-cron.cjs");
const { getStudioLog } = require("./studio-logger.cjs");

/**
 * @param {Record<string, unknown>} meta
 */
function metaToAutomationDraft(meta) {
  return {
    name: typeof meta.name === "string" ? meta.name : "",
    prompt: typeof meta.prompt === "string" ? meta.prompt : "",
    modelId: typeof meta.modelProfileId === "string" ? meta.modelProfileId : "",
    channel:
      typeof meta.channel === "string" && meta.channel.trim()
        ? meta.channel.trim()
        : "open-studio",
    frequencyMode: typeof meta.frequencyMode === "string" ? meta.frequencyMode : "period",
    periodCycle: typeof meta.periodCycle === "string" ? meta.periodCycle : "daily",
    periodTime: typeof meta.periodTime === "string" ? meta.periodTime : "09:00",
    intervalValue: Number(meta.intervalValue) > 0 ? Number(meta.intervalValue) : 1,
    intervalUnit: typeof meta.intervalUnit === "string" ? meta.intervalUnit : "hour",
    onceDate: typeof meta.onceDate === "string" ? meta.onceDate : "",
    onceTime: typeof meta.onceTime === "string" ? meta.onceTime : "09:00",
    effectiveRange: Array.isArray(meta.effectiveRange)
      ? meta.effectiveRange.map((v) => String(v ?? "").trim()).filter(Boolean)
      : [],
  };
}

/**
 * @param {Record<string, unknown>} draft
 */
function storedScheduleFromDraft(draft) {
  const schedule = draftToCronSchedule(draft);
  /** @type {Record<string, unknown>} */
  const storedSchedule = { ...schedule };
  if (schedule.kind === "every") {
    const everyMs = Number(schedule.everyMs);
    if (Number.isFinite(everyMs) && everyMs > 0) {
      storedSchedule.anchorMs = Date.now() + everyMs;
    }
  }
  return storedSchedule;
}

/**
 * Migrate legacy `studio:{uuid}` rows to real OpenClaw cron jobs.
 *
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {ReturnType<import("./automation-tasks-store.cjs").createAutomationTasksStore>} store
 * @param {Record<string, unknown>} meta
 */
async function migrateStudioOnlyAutomationTask(cfg, store, meta) {
  const cronJobId = typeof meta.cronJobId === "string" ? meta.cronJobId.trim() : "";
  if (!cronJobId || !isStudioOnlyAutomationTaskId(cronJobId)) return meta;

  const message = String(meta.message ?? meta.prompt ?? "").trim();
  if (!message) {
    store.deleteOne(cronJobId);
    return null;
  }

  const draft = metaToAutomationDraft(meta);
  const jobCreate = buildCronAddParams(cfg, draft, message);
  const job = await addCronJob(cfg, jobCreate);
  const newCronJobId = typeof job?.id === "string" ? job.id.trim() : "";
  if (!newCronJobId) throw new Error("missing_job_id");

  const schedule =
    meta.schedule && typeof meta.schedule === "object"
      ? /** @type {Record<string, unknown>} */ (meta.schedule)
      : storedScheduleFromDraft(draft);

  store.deleteOne(cronJobId);
  const next = {
    ...meta,
    cronJobId: newCronJobId,
    channel: "open-studio",
    message,
    schedule,
    enabled: meta.enabled !== false,
  };
  store.upsert(next);
  getStudioLog().info("[automation] migrated studio-only task to openclaw cron", {
    from: cronJobId,
    to: newCronJobId,
  });
  return next;
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {string} cronJobId
 * @param {number} runningAtMs
 */
async function cancelCronDetachedTaskBestEffort(cfg, cronJobId, runningAtMs) {
  const id = String(cronJobId ?? "").trim();
  if (!id || !Number.isFinite(runningAtMs) || runningAtMs <= 0) return;
  const candidates = [`cron:${id}:${runningAtMs}`, id];
  for (const taskId of candidates) {
    try {
      const result = await cancelGatewayTask(cfg, taskId);
      if (result?.cancelled) return;
    } catch {
      /* try next lookup shape */
    }
  }
}

/**
 * Detect OpenClaw cron runs for open-studio tasks and delegate execution to Chat Lab.
 *
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {import("electron").WebContents | null | undefined} wc
 * @param {ReturnType<import("./automation-tasks-store.cjs").createAutomationTasksStore>} store
 * @param {(wc: import("electron").WebContents, payload: Record<string, unknown>) => void} emitAutomationStatus
 * @param {(meta: Record<string, unknown>, nowMs: number) => Record<string, unknown>} buildAutomationChatPayload
 */
async function syncOpenStudioCronFires(cfg, wc, store, emitAutomationStatus, buildAutomationChatPayload) {
  if (!store || !wc || wc.isDestroyed()) return;

  const cronJobs = await listCronJobs(cfg).catch(() => []);
  syncGatewayCronJobsToAutomationStore(cfg, store, cronJobs);
  const cronById = new Map(
    cronJobs
      .filter((job) => job && typeof job === "object" && typeof job.id === "string")
      .map((job) => [job.id, job]),
  );

  const nowMs = Date.now();
  for (const row of store.list()) {
    let meta = row;
    const channel = resolveAutomationTaskChannel(typeof meta.channel === "string" ? meta.channel : "open-studio");
    if (channel !== "open-studio") continue;
    if (meta.enabled === false) continue;

    const cronJobIdRaw = typeof meta.cronJobId === "string" ? meta.cronJobId.trim() : "";
    if (!cronJobIdRaw) continue;

    if (isStudioOnlyAutomationTaskId(cronJobIdRaw)) {
      try {
        const migrated = await migrateStudioOnlyAutomationTask(cfg, store, meta);
        if (!migrated) continue;
        meta = migrated;
      } catch (err) {
        getStudioLog().warn(
          "[automation] studio-only migration failed",
          cronJobIdRaw,
          String(err?.message ?? err),
        );
        continue;
      }
    }

    const cronJobId = typeof meta.cronJobId === "string" ? meta.cronJobId.trim() : "";
    if (!cronJobId) continue;

    const job = cronById.get(cronJobId);
    const schedule =
      meta.schedule && typeof meta.schedule === "object"
        ? /** @type {{ kind?: string; everyMs?: number; anchorMs?: number; expr?: string; at?: string }} */ (
            meta.schedule
          )
        : null;
    const dueSlotMs = resolveAutomationDueSlotMs(meta, schedule, nowMs);
    if (job?.enabled === false) continue;
    if (!job && dueSlotMs == null) continue;

    const state =
      job?.state && typeof job.state === "object"
        ? /** @type {{ runningAtMs?: number; lastRunAtMs?: number }} */ (job.state)
        : {};
    const runningAtMs = typeof state.runningAtMs === "number" ? state.runningAtMs : 0;
    const lastDelegated =
      typeof meta.lastDelegatedRunningAtMs === "number" ? meta.lastDelegatedRunningAtMs : 0;
    const hasNewGatewayRun = runningAtMs > 0 && runningAtMs !== lastDelegated;
    if (!hasNewGatewayRun && dueSlotMs == null) continue;

    const message = String(meta.message ?? meta.prompt ?? "").trim();
    if (!message) {
      store.upsert({ ...meta, cronJobId, lastDelegatedRunningAtMs: runningAtMs });
      continue;
    }

    if (runningAtMs > 0) {
      await cancelCronDetachedTaskBestEffort(cfg, cronJobId, runningAtMs);
    }
    emitAutomationStatus(wc, buildAutomationChatPayload({ ...meta, cronJobId, message }));
    store.upsert({
      ...meta,
      cronJobId,
      message,
      ...(runningAtMs > 0 ? { lastDelegatedRunningAtMs: runningAtMs } : {}),
      lastStudioFiredAtMs: dueSlotMs ?? runningAtMs,
      lastRunStatus: "running",
      lastRunAtMs: nowMs,
    });
  }
}

module.exports = {
  metaToAutomationDraft,
  storedScheduleFromDraft,
  migrateStudioOnlyAutomationTask,
  cancelCronDetachedTaskBestEffort,
  syncOpenStudioCronFires,
};
