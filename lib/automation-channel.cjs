/**
 * @param {string | undefined} channel
 */
function resolveAutomationTaskChannel(channel) {
  const raw = String(channel ?? "").trim();
  return raw || "open-studio";
}

/**
 * @param {string} cronJobId
 */
function isStudioOnlyAutomationTaskId(cronJobId) {
  return String(cronJobId ?? "").trim().startsWith("studio:");
}

module.exports = {
  resolveAutomationTaskChannel,
  isStudioOnlyAutomationTaskId,
};
