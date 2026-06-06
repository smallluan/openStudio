/**
 * Ensure @tencent-weixin/openclaw-weixin is installed under ~/.openclaw-dev for dev QR login.
 * Safe to call on every `npm run dev` / gateway start (no-op when already present).
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensureDevGatewayAuthToken } = require("./sync-openclaw-agent-from-studio.cjs");

const WEIXIN_NPM_SPEC = "@tencent-weixin/openclaw-weixin";
const DEV_STATE_DIR = path.join(os.homedir(), ".openclaw-dev");

/** @param {string} stateDir */
function findWeixinPluginRoot(stateDir) {
  const npmProjects = path.join(stateDir, "npm", "projects");
  if (!fs.existsSync(npmProjects)) return null;
  for (const entry of fs.readdirSync(npmProjects)) {
    const pluginRoot = path.join(npmProjects, entry, "node_modules", "@tencent-weixin", "openclaw-weixin");
    const loginQr = path.join(pluginRoot, "dist", "src", "auth", "login-qr.js");
    if (fs.existsSync(loginQr)) return pluginRoot;
  }
  return null;
}

/**
 * @param {string} [projectRoot]
 * @returns {string | null}
 */
function resolveOpenClawCli(projectRoot = path.join(__dirname, "..")) {
  const direct = path.join(projectRoot, "node_modules", "openclaw", "openclaw.mjs");
  if (fs.existsSync(direct)) return direct;
  try {
    return require.resolve("openclaw/openclaw.mjs", { paths: [projectRoot] });
  } catch {
    return null;
  }
}

/** @param {string} stateDir */
function ensureWeixinInPluginsAllow(stateDir) {
  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (parsed && typeof parsed === "object") cfg = parsed;
  } catch {
    /* first run */
  }
  const plugins = /** @type {Record<string, unknown>} */ (cfg.plugins ?? (cfg.plugins = {}));
  const allow = Array.isArray(plugins.allow) ? [...plugins.allow] : [];
  if (!allow.includes("openclaw-weixin")) {
    allow.push("openclaw-weixin");
    plugins.allow = allow;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    return true;
  }
  return false;
}

/**
 * @param {{ projectRoot?: string; quiet?: boolean }} [opts]
 * @returns {{ ok: boolean; installed?: boolean; skipped?: string; pluginRoot?: string | null; message?: string }}
 */
function ensureOpenClawWeixinPlugin(opts = {}) {
  const projectRoot = opts.projectRoot ?? path.join(__dirname, "..");
  const log = opts.quiet ? () => {} : console.log.bind(console);
  const warn = opts.quiet ? () => {} : console.warn.bind(console);

  if (process.env.OPEN_STUDIO_SKIP_WEIXIN_PLUGIN === "1") {
    return { ok: true, skipped: "env" };
  }

  ensureDevGatewayAuthToken(DEV_STATE_DIR);
  ensureWeixinInPluginsAllow(DEV_STATE_DIR);

  const existing = findWeixinPluginRoot(DEV_STATE_DIR);
  if (existing) {
    log("[ensure-openclaw-weixin-plugin] already installed");
    return { ok: true, installed: false, pluginRoot: existing };
  }

  const cli = resolveOpenClawCli(projectRoot);
  if (!cli) {
    const message = "openclaw package missing — run pnpm install / npm install first";
    warn(`[ensure-openclaw-weixin-plugin] ${message}`);
    return { ok: false, message };
  }

  log(`[ensure-openclaw-weixin-plugin] installing ${WEIXIN_NPM_SPEC} into ~/.openclaw-dev …`);
  const result = spawnSync(process.execPath, [cli, "--dev", "plugins", "install", WEIXIN_NPM_SPEC], {
    cwd: projectRoot,
    stdio: opts.quiet ? "pipe" : "inherit",
    env: process.env,
  });

  const pluginRoot = findWeixinPluginRoot(DEV_STATE_DIR);
  if (result.status !== 0 || !pluginRoot) {
    const message = `install failed — run: openclaw --dev plugins install ${WEIXIN_NPM_SPEC}`;
    warn(`[ensure-openclaw-weixin-plugin] ${message}`);
    return { ok: false, message, pluginRoot };
  }

  log("[ensure-openclaw-weixin-plugin] ok");
  return { ok: true, installed: true, pluginRoot };
}

module.exports = {
  ensureOpenClawWeixinPlugin,
  findWeixinPluginRoot,
  resolveOpenClawCli,
  DEV_STATE_DIR,
  WEIXIN_NPM_SPEC,
};
