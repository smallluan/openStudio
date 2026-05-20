/**
 * Resolve OpenClaw bundled skill dirs and probe local runtime requirements (OS / PATH bins).
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { resolveOpenClawPackageRootSync, preferAsarUnpackedPath, getProjectRoot } = require("./openclaw-bundle-paths.cjs");

const execFileAsync = promisify(execFile);

/** @type {{ platform: string; availableBins: string[]; probedBins: string[] } | null} */
let skillEnvCache = null;
/** @type {Promise<{ platform: string; availableBins: string[]; probedBins: string[] }> | null} */
let skillEnvInFlight = null;

/** @returns {string} */
function getBundledSkillsRootSync() {
  const root = resolveOpenClawPackageRootSync();
  if (!root) return "";
  const skillsDir = preferAsarUnpackedPath(path.join(root, "skills"));
  return fs.existsSync(skillsDir) ? skillsDir : "";
}

/**
 * @param {string} skillId
 * @returns {string}
 */
function resolveBundledSkillDirectorySync(skillId) {
  const id = String(skillId ?? "").trim();
  if (!id) return "";
  const root = getBundledSkillsRootSync();
  if (!root) return "";
  const dir = path.join(root, id);
  return fs.existsSync(dir) ? dir : "";
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeUserPath(raw) {
  let p = String(raw ?? "").trim();
  if (
    (p.startsWith('"') && p.endsWith('"')) ||
    (p.startsWith("'") && p.endsWith("'")) ||
    (p.startsWith("「") && p.endsWith("」"))
  ) {
    p = p.slice(1, -1).trim();
  }
  return p;
}

/**
 * @param {string} rawPath
 * @returns {string}
 */
function resolveUserSkillDirectorySync(rawPath) {
  const raw = normalizeUserPath(rawPath);
  if (!raw) return "";
  try {
    const expanded = raw.startsWith("~")
      ? path.join(require("os").homedir(), raw.slice(1).replace(/^[/\\]/, ""))
      : raw;
    const resolved = path.resolve(expanded);
    if (!fs.existsSync(resolved)) return "";
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return "";
  }
}

/**
 * @param {string} bin
 * @returns {Promise<boolean>}
 */
async function commandExistsAsync(bin) {
  const name = String(bin ?? "").trim();
  if (!name) return false;
  try {
    if (process.platform === "win32") {
      await execFileAsync("where", [name], { timeout: 2500, windowsHide: true });
    } else {
      await execFileAsync("which", [name], { timeout: 2500 });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} bins
 * @returns {Promise<string[]>}
 */
async function probeAvailableBinsAsync(bins) {
  const uniq = [...new Set((bins || []).map((b) => String(b).trim()).filter(Boolean))];
  const checks = await Promise.all(
    uniq.map(async (b) => ({ bin: b, ok: await commandExistsAsync(b) })),
  );
  return checks.filter((c) => c.ok).map((c) => c.bin);
}

/** @returns {Array<{ os?: string[]; requiresBins?: string[] }>} */
function readBundledManifestSkillsSync() {
  const candidates = [
    path.join(getProjectRoot(), "src", "skills", "openclawBundledSkillManifest.json"),
    path.join(__dirname, "..", "src", "skills", "openclawBundledSkillManifest.json"),
  ];
  for (const fp of candidates) {
    try {
      if (!fs.existsSync(fp)) continue;
      const data = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (Array.isArray(data?.skills)) return data.skills;
    } catch {
      /* try next */
    }
  }
  return [];
}

/**
 * @param {Array<{ os?: string[]; requiresBins?: string[] }>} [skills]
 * @returns {Promise<{ platform: string; availableBins: string[]; probedBins: string[] }>}
 */
async function probeSkillEnvironmentAsync(skills) {
  const list = Array.isArray(skills) && skills.length > 0 ? skills : readBundledManifestSkillsSync();
  const platform = process.platform;

  /** @type {Set<string>} */
  const needed = new Set();
  for (const s of list) {
    const osList = Array.isArray(s?.os) ? s.os : [];
    if (osList.length > 0 && !osList.includes(platform)) continue;
    for (const b of s?.requiresBins || []) needed.add(String(b).trim());
  }

  const probedBins = [...needed];
  const availableBins = await probeAvailableBinsAsync(probedBins);
  return { platform, availableBins, probedBins };
}

/**
 * Cached skill environment (async probe; deduped in-flight).
 * @param {{ force?: boolean }} [opts]
 */
async function getSkillEnvironmentCached(opts) {
  if (!opts?.force && skillEnvCache) return skillEnvCache;
  if (!opts?.force && skillEnvInFlight) return skillEnvInFlight;

  skillEnvInFlight = probeSkillEnvironmentAsync()
    .then((result) => {
      skillEnvCache = result;
      skillEnvInFlight = null;
      return result;
    })
    .catch((err) => {
      skillEnvInFlight = null;
      throw err;
    });

  return skillEnvInFlight;
}

/**
 * @param {{ os?: string[]; requiresBins?: string[]; requiresEnv?: string[] }} skill
 * @param {{ platform: string; availableBins: Set<string> | string[] }} env
 * @returns {boolean}
 */
function isBundledSkillUsableSync(skill, env) {
  const platform = env?.platform || process.platform;
  const osList = Array.isArray(skill?.os) ? skill.os : [];
  if (osList.length > 0 && !osList.includes(platform)) return false;

  const bins = Array.isArray(skill?.requiresBins) ? skill.requiresBins : [];
  if (bins.length > 0) {
    const available = env?.availableBins instanceof Set ? env.availableBins : new Set(env?.availableBins || []);
    for (const b of bins) {
      if (!available.has(b)) return false;
    }
  }

  const envKeys = Array.isArray(skill?.requiresEnv) ? skill.requiresEnv : [];
  for (const key of envKeys) {
    const k = String(key ?? "").trim();
    if (k && !String(process.env[k] ?? "").trim()) return false;
  }

  return true;
}

module.exports = {
  getBundledSkillsRootSync,
  resolveBundledSkillDirectorySync,
  resolveUserSkillDirectorySync,
  normalizeUserPath,
  getSkillEnvironmentCached,
  isBundledSkillUsableSync,
};
