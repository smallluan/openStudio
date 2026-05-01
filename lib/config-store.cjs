const fs = require("fs");
const path = require("path");

const CONFIG_VERSION = 1;
const FILE_NAME = "studio-user-config.json";

/** @typedef {{ providerApiKey?: string }} StoredCredentials */
/** @typedef {{ gatewayBaseUrl?: string }} StoredOpenClaw */
/** @typedef {{
 *   version: number;
 *   credentials: StoredCredentials;
 *   openclaw: StoredOpenClaw;
 * }} UserConfig */

/** @returns {UserConfig} */
function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    credentials: {},
    openclaw: {
      gatewayBaseUrl: "http://127.0.0.1:18789",
    },
  };
}

/** @param {string} userDataDir */
function createConfigStore(userDataDir) {
  const filePath = () => path.join(userDataDir, FILE_NAME);

  /** @returns {UserConfig} */
  function readRaw() {
    const fp = filePath();
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return defaultConfig();
      return {
        ...defaultConfig(),
        ...parsed,
        credentials: { ...defaultConfig().credentials, ...parsed.credentials },
        openclaw: { ...defaultConfig().openclaw, ...parsed.openclaw },
      };
    } catch {
      return defaultConfig();
    }
  }

  /** @param {UserConfig} next */
  function writeRaw(next) {
    const fp = filePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(next, null, 2), "utf8");
  }

  /** 渲染进程可用：不含明文密钥 */
  function getSanitized() {
    const c = readRaw();
    const key = c.credentials?.providerApiKey;
    return {
      version: c.version,
      openclaw: { ...c.openclaw },
      credentials: {
        hasProviderApiKey: Boolean(key && String(key).length > 0),
      },
    };
  }

  /**
   * @param {Partial<{
   *   openclaw: Partial<StoredOpenClaw>;
   *   credentials: Partial<StoredCredentials>;
   * }>} patch
   */
  function applyPatch(patch) {
    const cur = readRaw();
    const next = {
      ...cur,
      version: CONFIG_VERSION,
      openclaw: { ...cur.openclaw, ...(patch.openclaw ?? {}) },
      credentials: { ...cur.credentials, ...(patch.credentials ?? {}) },
    };
    if (
      patch.credentials &&
      Object.prototype.hasOwnProperty.call(patch.credentials, "providerApiKey")
    ) {
      const v = patch.credentials.providerApiKey;
      if (v === "" || v === null) delete next.credentials.providerApiKey;
      else next.credentials.providerApiKey = String(v);
    }
    writeRaw(next);
    return getSanitized();
  }

  return { filePath, readRaw, getSanitized, applyPatch };
}

module.exports = { createConfigStore, CONFIG_VERSION, FILE_NAME, defaultConfig };
