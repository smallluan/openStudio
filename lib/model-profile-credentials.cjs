const fs = require("fs");
const path = require("path");

/** @param {unknown} cfg */
function extractActiveProfile(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const list = Array.isArray(cfg.modelProfiles) ? cfg.modelProfiles : [];
  const enabledRaw = Array.isArray(cfg.enabledModelProfileIds) ? cfg.enabledModelProfileIds : [];
  const profileMap = new Map(list.map((p) => [p?.id, p]));
  const enabled = enabledRaw
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id, i, arr) => id && arr.indexOf(id) === i && profileMap.has(id));
  if (enabled.length === 0) return null;
  const activeId =
    typeof cfg.activeModelProfileId === "string" ? cfg.activeModelProfileId.trim() : "";
  const matched = activeId && enabled.includes(activeId) ? profileMap.get(activeId) : null;
  return matched ?? profileMap.get(enabled[0]) ?? null;
}

/**
 * @param {unknown} cfg
 * @param {string} profileId
 */
function findProfileRow(cfg, profileId) {
  const id = String(profileId ?? "").trim();
  if (!id || !cfg || typeof cfg !== "object") return null;
  const list = Array.isArray(cfg.modelProfiles) ? cfg.modelProfiles : [];
  return list.find((p) => p && typeof p === "object" && String(p.id ?? "").trim() === id) ?? null;
}

/**
 * @param {string} agentAgentDir
 * @param {string} profileKey
 */
function readExistingAuthProfileKey(agentAgentDir, profileKey) {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(agentAgentDir, "auth-profiles.json"), "utf8"));
    const row = auth?.profiles?.[profileKey];
    if (row && typeof row === "object" && typeof row.key === "string" && row.key.trim()) {
      return row.key.trim();
    }
  } catch {
    /* missing */
  }
  return "";
}

/**
 * OpenClaw onboard may persist provider keys under agents/<id>/agent/models.json.
 * @param {string} stateDir
 * @param {string} agentId
 * @param {string} openClawProvider
 */
function readLegacyAgentModelApiKey(stateDir, agentId, openClawProvider) {
  try {
    const modelsPath = path.join(stateDir, "agents", agentId, "agent", "models.json");
    const data = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    const block = data?.providers?.[openClawProvider];
    if (block && typeof block === "object" && typeof block.apiKey === "string" && block.apiKey.trim()) {
      return block.apiKey.trim();
    }
  } catch {
    /* missing */
  }
  return "";
}

/**
 * Best-effort guard so a MiniMax-style global key is not reused for DeepSeek/Moonshot/etc.
 * @param {string} apiKey
 * @param {string} openClawProvider
 */
function credentialLikelyMatchesProvider(apiKey, openClawProvider) {
  const key = String(apiKey ?? "").trim();
  const provider = String(openClawProvider ?? "").trim().toLowerCase();
  if (!key || !provider) return false;
  const looksMiniMax = key.startsWith("sk-api-") || key.startsWith("sk-cp-");
  if (provider === "minimax") return looksMiniMax || key.length > 0;
  if (looksMiniMax) return false;
  return true;
}

/**
 * Resolve the API key for a model profile. Per-profile keys win; we avoid clobbering
 * a provider-specific onboard key with Studio's legacy global credential.
 *
 * @param {unknown} cfg
 * @param {{ id?: string }} profile
 * @param {{ profileKey: string; openClawProvider: string }} mapped
 * @param {string} stateDir
 * @param {string} agentId
 */
function resolveApiKeyForProfile(cfg, profile, mapped, stateDir, agentId) {
  const row = findProfileRow(cfg, String(profile?.id ?? "").trim());
  if (row && typeof row.apiKey === "string" && row.apiKey.trim()) {
    return row.apiKey.trim();
  }

  const agentAgentDir = path.join(stateDir, "agents", agentId, "agent");
  const legacyModelKey = readLegacyAgentModelApiKey(stateDir, agentId, mapped.openClawProvider);
  if (legacyModelKey && credentialLikelyMatchesProvider(legacyModelKey, mapped.openClawProvider)) {
    return legacyModelKey;
  }

  const existingAuthKey = readExistingAuthProfileKey(agentAgentDir, mapped.profileKey);
  if (existingAuthKey && credentialLikelyMatchesProvider(existingAuthKey, mapped.openClawProvider)) {
    return existingAuthKey;
  }

  const global = cfg?.credentials?.providerApiKey;
  const globalKey = typeof global === "string" ? global.trim() : "";
  if (globalKey && credentialLikelyMatchesProvider(globalKey, mapped.openClawProvider)) {
    return globalKey;
  }
  return "";
}

/** @param {unknown} cfg */
function resolveApiKeyForActiveProfile(cfg, stateDir, agentId, mapped) {
  const profile = extractActiveProfile(cfg);
  if (!profile) return "";
  return resolveApiKeyForProfile(cfg, profile, mapped, stateDir, agentId);
}

module.exports = {
  extractActiveProfile,
  findProfileRow,
  resolveApiKeyForProfile,
  resolveApiKeyForActiveProfile,
  readLegacyAgentModelApiKey,
  credentialLikelyMatchesProvider,
};
