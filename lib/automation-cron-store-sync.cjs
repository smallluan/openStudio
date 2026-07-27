const { resolveAutomationTaskChannel, inferAutomationChannelFromCronDelivery } = require("./automation-channel.cjs");
const { resolveAutomationFrequencyFields } = require("./automation-frequency.cjs");
const { resolveAutomationStudioMetaDefaults } = require("./automation-defaults.cjs");
const { listCronJobs } = require("./openclaw-gateway-cron.cjs");
const { getStudioLog } = require("./studio-logger.cjs");

/**
 * @param {Record<string, unknown>} job
 */
function inferAutomationChannelFromCronJob(job) {
  return inferAutomationChannelFromCronDelivery(job);
}

/**
 * @param {Record<string, unknown>} job
 */
function extractCronJobPrompt(job) {
  const payload =
    job.payload && typeof job.payload === "object"
      ? /** @type {{ kind?: string; message?: string; text?: string }} */ (job.payload)
      : {};
  const kind = String(payload.kind ?? "").trim();
  if (kind === "agentTurn") return String(payload.message ?? "").trim();
  if (kind === "systemEvent") return String(payload.text ?? "").trim();
  return "";
}

/**
 * @param {Record<string, unknown>} job
 */
function shouldImportCronJobToAutomationStore(job) {
  if (!job || typeof job.id !== "string" || !job.id.trim()) return false;
  const prompt = extractCronJobPrompt(job);
  return Boolean(prompt);
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {Record<string, unknown>} job
 * @param {Record<string, unknown>} [existing]
 */
function cronJobToAutomationStoreRow(cfg, job, existing) {
  const cronJobId = String(job.id ?? "").trim();
  const prompt = extractCronJobPrompt(job);
  const cronName = typeof job.name === "string" ? job.name.trim() : "";
  const state =
    job.state && typeof job.state === "object"
      ? /** @type {{
          lastRunStatus?: string;
          lastRunAtMs?: number;
          lastError?: string;
          consecutiveErrors?: number;
        }} */ (job.state)
      : {};
  const schedule =
    job.schedule && typeof job.schedule === "object"
      ? /** @type {Record<string, unknown>} */ (job.schedule)
      : undefined;
  const { agentId, modelProfileId } = resolveAutomationStudioMetaDefaults(cfg, existing, job);
  const frequency = resolveAutomationFrequencyFields(
    existing && typeof existing === "object" ? existing : {},
    schedule,
  );

  /** @type {Record<string, unknown>} */
  const row = {
    ...(existing && typeof existing === "object" ? existing : {}),
    cronJobId,
    name: cronName || prompt.slice(0, 48),
    prompt,
    message: prompt,
    channel: inferAutomationChannelFromCronJob(job),
    schedule,
    ...frequency,
    enabled: job.enabled !== false,
    importedFromGateway: true,
    agentId,
    modelProfileId,
    ...(typeof state.lastRunStatus === "string" ? { lastRunStatus: state.lastRunStatus } : {}),
    ...(typeof state.lastRunAtMs === "number" ? { lastRunAtMs: state.lastRunAtMs } : {}),
    ...(typeof state.lastError === "string" ? { lastError: state.lastError } : {}),
    ...(typeof state.consecutiveErrors === "number"
      ? { consecutiveErrors: state.consecutiveErrors }
      : {}),
  };

  if (!existing) {
    const createdAtMs =
      typeof job.createdAtMs === "number"
        ? job.createdAtMs
        : typeof job.updatedAtMs === "number"
          ? job.updatedAtMs
          : Date.now();
    row.createdAtMs = createdAtMs;
  }

  row.channel = resolveAutomationTaskChannel(
    typeof row.channel === "string" ? row.channel : "open-studio",
  );
  return row;
}

/**
 * Import AI / gateway cron jobs that are missing from the local automation store.
 *
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {ReturnType<import("./automation-tasks-store.cjs").createAutomationTasksStore>} store
 * @param {Record<string, unknown>[] | null | undefined} [cronJobs]
 */
function syncGatewayCronJobsToAutomationStore(cfg, store, cronJobs) {
  if (!store) return { imported: 0, refreshed: 0 };

  const jobs = Array.isArray(cronJobs)
    ? cronJobs
    : null;
  const rows = store.list();
  const byId = new Map(
    rows
      .filter((row) => row && typeof row.cronJobId === "string" && row.cronJobId.trim())
      .map((row) => [String(row.cronJobId).trim(), row]),
  );

  let imported = 0;
  let refreshed = 0;

  const apply = (jobList) => {
    for (const job of jobList) {
      if (!job || typeof job !== "object") continue;
      const cronJobId = typeof job.id === "string" ? job.id.trim() : "";
      if (!cronJobId) continue;

      const existing = byId.get(cronJobId);
      if (existing) {
        if (existing.importedFromGateway === true) {
          store.upsert(cronJobToAutomationStoreRow(cfg, job, existing));
          refreshed += 1;
        } else if (
          !(typeof existing.agentId === "string" && existing.agentId.trim()) ||
          !(typeof existing.modelProfileId === "string" && existing.modelProfileId.trim())
        ) {
          const defaults = resolveAutomationStudioMetaDefaults(cfg, existing, job);
          store.upsert({ ...existing, ...defaults });
        }
        continue;
      }

      if (!shouldImportCronJobToAutomationStore(job)) continue;
      const row = cronJobToAutomationStoreRow(cfg, job);
      store.upsert(row);
      byId.set(cronJobId, row);
      imported += 1;
      getStudioLog().info("[automation] imported gateway cron job into store", {
        cronJobId,
        name: row.name,
      });
    }
  };

  if (jobs) {
    apply(jobs);
    return { imported, refreshed };
  }

  return listCronJobs(cfg)
    .then((listed) => {
      apply(listed);
      return { imported, refreshed };
    })
    .catch((err) => {
      getStudioLog().warn(
        "[automation] gateway cron import failed:",
        String(err?.message ?? err),
      );
      return { imported: 0, refreshed: 0 };
    });
}

module.exports = {
  inferAutomationChannelFromCronJob,
  extractCronJobPrompt,
  shouldImportCronJobToAutomationStore,
  cronJobToAutomationStoreRow,
  syncGatewayCronJobsToAutomationStore,
};
