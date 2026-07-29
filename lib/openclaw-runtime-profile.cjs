/**
 * Single source of truth for Studio-managed OpenClaw runtime isolation.
 *
 * Packaged app  → loopback :19001 → %APPDATA%/open-studio/openclaw-state
 * Dev (`pnpm dev`) → loopback :19002 → ~/.openclaw-dev (OpenClaw `--dev`)
 * External CLI   → e.g. :18789 → ~/.openclaw
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const PACKAGED_GATEWAY_PORT = 19001;
const DEV_GATEWAY_PORT = 19002;
const PACKAGED_STATE_DIRNAME = "openclaw-state";
const LEGACY_DEV_STATE_BASENAME = ".openclaw-dev";

/** @returns {string} */
function getStudioUserDataDir() {
  const fromEnv = process.env.OPEN_STUDIO_USER_DATA;
  return typeof fromEnv === "string" ? fromEnv.trim() : "";
}

/** @param {string} [userDataDir] */
function resolvePackagedOpenClawStateDir(userDataDir = getStudioUserDataDir()) {
  const base = String(userDataDir ?? "").trim();
  if (!base) return path.join(os.homedir(), ".openclaw");
  return path.join(base, PACKAGED_STATE_DIRNAME);
}

/** @returns {string} */
function resolveDevOpenClawStateDir() {
  return path.join(os.homedir(), LEGACY_DEV_STATE_BASENAME);
}

/**
 * @param {string} gatewayBaseUrl
 * @returns {{ loopback: boolean; port: number | null }}
 */
function parseLoopbackGatewayPort(gatewayBaseUrl) {
  try {
    const raw = String(gatewayBaseUrl ?? "").trim();
    if (!raw) return { loopback: false, port: null };
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    const host = u.hostname.toLowerCase();
    const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (!loopback || !u.port) return { loopback, port: null };
    const port = Number.parseInt(u.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return { loopback, port: null };
    return { loopback, port };
  } catch {
    return { loopback: false, port: null };
  }
}

/**
 * @param {string} gatewayBaseUrl
 * @param {string} [userDataDir]
 */
function resolveOpenClawStateDir(gatewayBaseUrl, userDataDir = getStudioUserDataDir()) {
  const { loopback, port } = parseLoopbackGatewayPort(gatewayBaseUrl);
  if (loopback && port === DEV_GATEWAY_PORT) return resolveDevOpenClawStateDir();
  if (loopback && port === PACKAGED_GATEWAY_PORT) return resolvePackagedOpenClawStateDir(userDataDir);
  return path.join(os.homedir(), ".openclaw");
}

/** @param {string} baseUrl */
function looksLikeStudioManagedGateway(baseUrl) {
  const { loopback, port } = parseLoopbackGatewayPort(baseUrl);
  return loopback && (port === PACKAGED_GATEWAY_PORT || port === DEV_GATEWAY_PORT);
}

/** @param {number} port */
function gatewayPortUsesDevCli(port) {
  return port === DEV_GATEWAY_PORT;
}

/** @param {string} stateDir */
function isStudioManagedOpenClawStateDir(stateDir) {
  const base = path.basename(String(stateDir ?? "").trim());
  if (base === LEGACY_DEV_STATE_BASENAME) return true;
  if (base === PACKAGED_STATE_DIRNAME) return true;
  const userData = getStudioUserDataDir();
  if (userData && stateDir === resolvePackagedOpenClawStateDir(userData)) return true;
  return false;
}

/** @param {boolean} isDev */
function defaultStudioGatewayBaseUrl(isDev) {
  const port = isDev ? DEV_GATEWAY_PORT : PACKAGED_GATEWAY_PORT;
  return `http://127.0.0.1:${port}`;
}

/**
 * One-time migration: older packaged builds shared ~/.openclaw-dev with `pnpm dev`.
 * @param {string} userDataDir
 * @param {{ info?: Function; warn?: Function }} [log]
 */
function migratePackagedOpenClawStateFromLegacyDev(userDataDir, log) {
  const target = resolvePackagedOpenClawStateDir(userDataDir);
  const marker = path.join(target, ".migrated-from-openclaw-dev");
  if (fs.existsSync(marker)) return { skipped: "already_migrated" };
  if (fs.existsSync(path.join(target, "openclaw.json"))) return { skipped: "target_exists" };

  const legacy = resolveDevOpenClawStateDir();
  if (!fs.existsSync(path.join(legacy, "openclaw.json"))) return { skipped: "no_legacy" };

  try {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(legacy, target, { recursive: true, force: false });
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
    log?.info?.("[openclaw-runtime] migrated packaged state from legacy ~/.openclaw-dev", {
      from: legacy,
      to: target,
    });
    return { ok: true, from: legacy, to: target };
  } catch (err) {
    log?.warn?.("[openclaw-runtime] packaged state migration failed", String(err?.message ?? err));
    return { ok: false, message: String(err?.message ?? err) };
  }
}

/**
 * @param {string} gatewayBaseUrl
 * @param {string} [userDataDir]
 * @returns {string}
 */
function readGatewayAuthTokenFromState(gatewayBaseUrl, userDataDir = getStudioUserDataDir()) {
  try {
    const stateDir = resolveOpenClawStateDir(gatewayBaseUrl, userDataDir);
    const fp = path.join(stateDir, "openclaw.json");
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw);
    const tok = parsed?.gateway?.auth?.token;
    if (typeof tok === "string" && tok.trim()) return tok.trim();
  } catch {
    /* no state yet */
  }
  return "";
}

module.exports = {
  PACKAGED_GATEWAY_PORT,
  DEV_GATEWAY_PORT,
  PACKAGED_STATE_DIRNAME,
  getStudioUserDataDir,
  resolvePackagedOpenClawStateDir,
  resolveDevOpenClawStateDir,
  resolveOpenClawStateDir,
  parseLoopbackGatewayPort,
  looksLikeStudioManagedGateway,
  gatewayPortUsesDevCli,
  isStudioManagedOpenClawStateDir,
  defaultStudioGatewayBaseUrl,
  migratePackagedOpenClawStateFromLegacyDev,
  readGatewayAuthTokenFromState,
};
