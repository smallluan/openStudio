const { resolveGateway } = require("./openclaw-gateway-ws.cjs");
const { acquireGatewaySession } = require("./openclaw-gateway-session.cjs");
const { getStudioLog } = require("./studio-logger.cjs");

const RPC_TIMEOUT_MS = 45_000;

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 */
async function withCronClient(cfg, run) {
  const resolved = resolveGateway(cfg);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RPC_TIMEOUT_MS);
  try {
    const client = await acquireGatewaySession(resolved, ac.signal);
    return await run(client);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {Record<string, unknown>} [params]
 */
async function listCronJobs(cfg, params = {}) {
  return withCronClient(cfg, async (client) => {
    const page = await client.request("cron.list", {
      limit: 200,
      sortBy: "updatedAtMs",
      sortDir: "desc",
      ...params,
    });
    const jobs = page && typeof page === "object" && Array.isArray(page.jobs) ? page.jobs : [];
    return jobs;
  });
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {Record<string, unknown>} jobCreate
 */
async function addCronJob(cfg, jobCreate) {
  return withCronClient(cfg, async (client) => {
    const job = await client.request("cron.add", jobCreate);
    return job;
  });
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {string} jobId
 */
async function removeCronJob(cfg, jobId) {
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("missing_job_id");
  return withCronClient(cfg, async (client) => {
    return await client.request("cron.remove", { id });
  });
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
async function updateCronJob(cfg, jobId, patch) {
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("missing_job_id");
  return withCronClient(cfg, async (client) => {
    return await client.request("cron.update", { id, patch });
  });
}

/**
 * Force-run a cron job now (does not alter the schedule).
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {string} jobId
 */
async function runCronJobNow(cfg, jobId) {
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("missing_job_id");
  return withCronClient(cfg, async (client) => {
    return await client.request("cron.run", { id, mode: "force" });
  });
}

/**
 * @param {unknown} err
 */
function formatGatewayCronError(err) {
  const msg = String(err?.message ?? err ?? "gateway_error");
  getStudioLog().warn("[automation] cron gateway error:", msg);
  return msg;
}

module.exports = {
  listCronJobs,
  addCronJob,
  removeCronJob,
  updateCronJob,
  runCronJobNow,
  formatGatewayCronError,
};
