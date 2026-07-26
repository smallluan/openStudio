/** Studio id for the primary lobster agent (see src/studio/agents.js). */
const MAIN_AGENT_STUDIO_ID = "agent-main";

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 */
function resolveDefaultModelProfileId(cfg) {
  const active =
    typeof cfg?.activeModelProfileId === "string" ? cfg.activeModelProfileId.trim() : "";
  if (active) return active;
  const profiles = Array.isArray(cfg?.modelProfiles) ? cfg.modelProfiles : [];
  const enabled = profiles.find((p) => p && p.enabled !== false && typeof p.id === "string");
  if (enabled?.id) return String(enabled.id).trim();
  const first = profiles.find((p) => p && typeof p.id === "string");
  return first?.id ? String(first.id).trim() : "";
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {Record<string, unknown> | null | undefined} payload
 */
function resolveModelProfileIdFromCronPayload(cfg, payload) {
  if (!payload || typeof payload !== "object") return "";
  const modelRef = typeof payload.model === "string" ? payload.model.trim() : "";
  if (!modelRef) return "";

  const { resolveCronModelFromProfile } = require("./automation-cron-bridge.cjs");
  const profiles = Array.isArray(cfg?.modelProfiles) ? cfg.modelProfiles : [];
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== "string") continue;
    const mapped = resolveCronModelFromProfile(cfg, profile.id);
    if (mapped && mapped === modelRef) return profile.id.trim();
  }
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== "string") continue;
    const modelId = String(profile.modelId ?? "").trim();
    if (!modelId) continue;
    if (modelId === modelRef || modelRef.endsWith(`/${modelId}`)) return profile.id.trim();
  }
  return "";
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {Record<string, unknown> | null | undefined} [cronJob]
 */
function resolveAutomationStudioMetaDefaults(cfg, meta, cronJob) {
  const existing = meta && typeof meta === "object" ? meta : {};
  const payload =
    cronJob?.payload && typeof cronJob.payload === "object"
      ? /** @type {Record<string, unknown>} */ (cronJob.payload)
      : null;

  const agentId =
    typeof existing.agentId === "string" && existing.agentId.trim()
      ? existing.agentId.trim()
      : MAIN_AGENT_STUDIO_ID;

  const modelProfileId =
    typeof existing.modelProfileId === "string" && existing.modelProfileId.trim()
      ? existing.modelProfileId.trim()
      : resolveModelProfileIdFromCronPayload(cfg, payload) || resolveDefaultModelProfileId(cfg);

  return { agentId, modelProfileId };
}

module.exports = {
  MAIN_AGENT_STUDIO_ID,
  resolveDefaultModelProfileId,
  resolveModelProfileIdFromCronPayload,
  resolveAutomationStudioMetaDefaults,
};
