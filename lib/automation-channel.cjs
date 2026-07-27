/**
 * @param {string | undefined} channel
 */
function resolveAutomationTaskChannel(channel) {
  const raw = String(channel ?? "").trim();
  if (!raw) return "open-studio";
  if (raw === "internal" || raw === "studio" || raw === "openstudio") return "open-studio";
  if (raw === "weixin") return "wechat";
  return raw;
}

/**
 * @param {Record<string, unknown> | null | undefined} job
 */
function inferAutomationChannelFromCronDelivery(job) {
  const delivery =
    job?.delivery && typeof job.delivery === "object"
      ? /** @type {{ mode?: string; channel?: string }} */ (job.delivery)
      : {};
  const mode = String(delivery.mode ?? "").trim().toLowerCase();
  const channel = String(delivery.channel ?? "").trim().toLowerCase();
  if (channel === "wechat" || channel === "weixin") return "wechat";
  if (mode === "announce" && (channel === "wechat" || channel === "weixin")) return "wechat";
  // Studio only supports open-studio + wechat; any other gateway delivery is repaired to none.
  return "open-studio";
}

/**
 * @param {string | undefined} text
 */
function isGatewayChannelDeliveryError(text) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes("channel is required") ||
    s.includes("no available channels") ||
    s.includes("qq bot") ||
    s.includes("qqbot") ||
    s.includes("missing its plugin") ||
    s.includes("official external channel")
  );
}

/**
 * @param {Record<string, unknown>} fields
 */
function stripOpenStudioChannelDeliveryErrors(fields) {
  const err = String(fields.lastError ?? "").trim();
  const summary = String(fields.lastDiagnosticSummary ?? "").trim();
  if (!isGatewayChannelDeliveryError(err) && !isGatewayChannelDeliveryError(summary)) {
    return fields;
  }
  return {
    ...fields,
    lastError: "",
    lastDiagnosticSummary: "",
    consecutiveErrors: 0,
    ...(fields.lastRunStatus === "error" ? { lastRunStatus: "ok" } : {}),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} job
 */
function cronJobDeliveryMode(job) {
  const delivery =
    job?.delivery && typeof job.delivery === "object"
      ? /** @type {{ mode?: string }} */ (job.delivery)
      : {};
  return String(delivery.mode ?? "").trim().toLowerCase();
}

/**
 * Open Studio tasks must not announce to external channels.
 * @param {string} channel
 * @param {Record<string, unknown> | null | undefined} job
 */
function cronJobNeedsOpenStudioDeliveryRepair(channel, job) {
  if (resolveAutomationTaskChannel(channel) !== "open-studio") return false;
  return cronJobDeliveryMode(job) !== "none";
}

/**
 * @param {string} channel
 * @param {Record<string, unknown> | null | undefined} job
 * @param {Record<string, unknown>} meta
 */
function openStudioTaskNeedsChannelErrorReset(channel, job, meta) {
  if (resolveAutomationTaskChannel(channel) !== "open-studio") return false;
  if (cronJobNeedsOpenStudioDeliveryRepair(channel, job)) return true;
  if (cronJobDeliveryMode(job) !== "none") return false;
  const state =
    job?.state && typeof job.state === "object"
      ? /** @type {{ lastError?: string; lastDiagnosticSummary?: string }} */ (job.state)
      : {};
  const err = pickFirstNonEmptyText([
    meta.lastError,
    state.lastError,
    meta.lastDiagnosticSummary,
    state.lastDiagnosticSummary,
  ]);
  return isGatewayChannelDeliveryError(err);
}

/**
 * @param {unknown[]} values
 */
function pickFirstNonEmptyText(values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * @returns {Record<string, unknown>}
 */
function buildOpenStudioCronErrorResetPatch() {
  return {
    state: {
      consecutiveErrors: 0,
      consecutiveSkipped: 0,
      lastRunStatus: "ok",
      lastError: "",
    },
  };
}

/**
 * @returns {Record<string, unknown>}
 */
function buildOpenStudioStoreErrorResetFields() {
  return {
    lastError: "",
    lastDiagnosticSummary: "",
    consecutiveErrors: 0,
    lastRunStatus: "ok",
  };
}

/**
 * @param {string} cronJobId
 */
function isStudioOnlyAutomationTaskId(cronJobId) {
  return String(cronJobId ?? "").trim().startsWith("studio:");
}

module.exports = {
  resolveAutomationTaskChannel,
  inferAutomationChannelFromCronDelivery,
  isGatewayChannelDeliveryError,
  stripOpenStudioChannelDeliveryErrors,
  cronJobNeedsOpenStudioDeliveryRepair,
  openStudioTaskNeedsChannelErrorReset,
  cronJobDeliveryMode,
  buildOpenStudioCronErrorResetPatch,
  buildOpenStudioStoreErrorResetFields,
  isStudioOnlyAutomationTaskId,
};
