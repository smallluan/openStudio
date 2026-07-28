/**
 * Build cron job ids that must be kept in the local automation store.
 * Paused tasks may be omitted from gateway cron.list responses.
 *
 * @param {Iterable<string>} cronJobIds
 * @param {Record<string, unknown>[]} metaRows
 * @param {(cronJobId: string) => boolean} isStudioOnlyAutomationTaskId
 */
function buildAutomationTaskPruneKeepIds(cronJobIds, metaRows, isStudioOnlyAutomationTaskId) {
  const keepIds = new Set(
    [...cronJobIds].map((id) => String(id ?? "").trim()).filter(Boolean),
  );
  for (const meta of metaRows) {
    const cronJobId = typeof meta.cronJobId === "string" ? meta.cronJobId.trim() : "";
    if (!cronJobId) continue;
    if (meta.enabled === false) keepIds.add(cronJobId);
    if (isStudioOnlyAutomationTaskId(cronJobId)) keepIds.add(cronJobId);
  }
  return keepIds;
}

module.exports = {
  buildAutomationTaskPruneKeepIds,
};
