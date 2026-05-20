/**
 * Client-side helpers for filtering OpenClaw bundled skills by local OS / PATH / env.
 * @typedef {{ platform: string; availableBins: string[] }} SkillEnvironment
 */

/** @returns {string} */
export function getClientPlatform() {
  if (typeof window !== "undefined" && window.electronShell?.platform) {
    return window.electronShell.platform;
  }
  if (typeof navigator !== "undefined" && navigator.platform) {
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return "win32";
    if (p.includes("mac")) return "darwin";
    if (p.includes("linux")) return "linux";
  }
  return "unknown";
}

/**
 * @param {{ os?: string[]; requiresBins?: string[]; requiresEnv?: string[] }} skill
 * @param {(SkillEnvironment & { loading?: boolean }) | null | undefined} env
 * @returns {boolean}
 */
export function isBundledSkillUsable(skill, env) {
  const platform = env?.platform || getClientPlatform();
  const osList = Array.isArray(skill?.os) ? skill.os : [];
  if (osList.length > 0 && !osList.includes(platform)) return false;

  const bins = Array.isArray(skill?.requiresBins) ? skill.requiresBins : [];
  if (bins.length > 0) {
    if (env?.loading) return true;
    if (!env?.availableBins) return false;
    const available = new Set(env.availableBins);
    for (const b of bins) {
      if (!available.has(b)) return false;
    }
  }

  return true;
}

/**
 * @param {Array<{ os?: string[]; requiresBins?: string[] }>} skills
 * @param {SkillEnvironment | null | undefined} env
 */
export function filterUsableBundledSkills(skills, env) {
  return skills.filter((s) => isBundledSkillUsable(s, env));
}
