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
 * @param {string} cronJobId
 */
function isStudioOnlyAutomationTaskId(cronJobId) {
  return String(cronJobId ?? "").trim().startsWith("studio:");
}

module.exports = {
  resolveAutomationTaskChannel,
  isStudioOnlyAutomationTaskId,
};
