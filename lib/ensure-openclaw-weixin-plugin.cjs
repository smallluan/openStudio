/**
 * Ensure @tencent-weixin/openclaw-weixin is installed under ~/.openclaw-dev for dev QR login.
 * Safe to call on every `npm run dev` / gateway start (no-op when already present).
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensureDevGatewayAuthToken } = require("./sync-openclaw-agent-from-studio.cjs");
const { resolveOpenClawPackageRootSync } = require("./openclaw-bundle-paths.cjs");
const {
  findWeixinPluginRoot,
  findWeixinPluginNpmProjectRoot,
} = require("./openclaw-weixin-plugin-paths.cjs");

const WEIXIN_NPM_SPEC = "@tencent-weixin/openclaw-weixin";
const DEV_STATE_DIR = path.join(os.homedir(), ".openclaw-dev");

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
 * @param {string} projectRoot
 */
function canResolveOpenClawPeerDep(projectRoot) {
  try {
    require.resolve("openclaw/plugin-sdk/account-id", { paths: [projectRoot] });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} stateDir
 * @param {{ projectRoot?: string; quiet?: boolean }} [opts]
 */
function ensureWeixinPluginOpenClawPeerDep(stateDir, opts = {}) {
  const studioRoot = opts.projectRoot ?? path.join(__dirname, "..");
  const log = opts.quiet ? () => {} : console.log.bind(console);
  const warn = opts.quiet ? () => {} : console.warn.bind(console);

  const pluginRoot = findWeixinPluginRoot(stateDir);
  if (!pluginRoot) return { ok: false, reason: "plugin_missing" };

  const npmProjectRoot = findWeixinPluginNpmProjectRoot(pluginRoot);
  if (!npmProjectRoot) return { ok: false, reason: "npm_project_missing" };

  if (canResolveOpenClawPeerDep(npmProjectRoot)) {
    return { ok: true, skipped: "present", npmProjectRoot };
  }

  const openclawRoot = resolveOpenClawPackageRootSync();
  if (!openclawRoot) {
    const message = "openclaw package missing — run pnpm install / npm install first";
    warn(`[ensure-openclaw-weixin-plugin] ${message}`);
    return { ok: false, message, npmProjectRoot };
  }

  const linkPath = path.join(npmProjectRoot, "node_modules", "openclaw");
  fs.mkdirSync(path.join(npmProjectRoot, "node_modules"), { recursive: true });

  if (fs.existsSync(linkPath)) {
    try {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  try {
    fs.symlinkSync(openclawRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
    if (canResolveOpenClawPeerDep(npmProjectRoot)) {
      log("[ensure-openclaw-weixin-plugin] linked openclaw peer dependency for weixin plugin");
      return { ok: true, method: "symlink", npmProjectRoot };
    }
  } catch (err) {
    warn(`[ensure-openclaw-weixin-plugin] symlink openclaw failed: ${String(err?.message ?? err)}`);
  }

  let version = "";
  try {
    const pkgPath = path.join(openclawRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    version = String(pkg?.version ?? "").trim();
  } catch {
    /* ignore */
  }
  if (!version) {
    return { ok: false, message: "openclaw_version_unresolved", npmProjectRoot };
  }

  log(`[ensure-openclaw-weixin-plugin] installing openclaw@${version} peer dependency for weixin plugin …`);
  const result = spawnSync(
    "npm",
    ["install", `openclaw@${version}`, "--no-save", "--ignore-scripts"],
    {
      cwd: npmProjectRoot,
      stdio: opts.quiet ? "pipe" : "inherit",
      env: process.env,
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0 || !canResolveOpenClawPeerDep(npmProjectRoot)) {
    const message = `openclaw peer install failed — run: cd "${npmProjectRoot}" && npm install openclaw@${version}`;
    warn(`[ensure-openclaw-weixin-plugin] ${message}`);
    return { ok: false, message, npmProjectRoot };
  }

  log("[ensure-openclaw-weixin-plugin] openclaw peer dependency ok");
  return { ok: true, method: "npm", npmProjectRoot };
}

/**
 * @param {{ projectRoot?: string; quiet?: boolean; stateDir?: string }} [opts]
 * @returns {{ ok: boolean; installed?: boolean; skipped?: string; pluginRoot?: string | null; message?: string }}
 */
function ensureOpenClawWeixinPlugin(opts = {}) {
  const projectRoot = opts.projectRoot ?? path.join(__dirname, "..");
  const log = opts.quiet ? () => {} : console.log.bind(console);
  const warn = opts.quiet ? () => {} : console.warn.bind(console);

  if (process.env.OPEN_STUDIO_SKIP_WEIXIN_PLUGIN === "1") {
    return { ok: true, skipped: "env" };
  }

  const stateDir = opts.stateDir ?? DEV_STATE_DIR;

  ensureDevGatewayAuthToken(stateDir);
  ensureWeixinInPluginsAllow(stateDir);

  const existing = findWeixinPluginRoot(stateDir);
  if (existing) {
    log("[ensure-openclaw-weixin-plugin] already installed");
    const peer = ensureWeixinPluginOpenClawPeerDep(stateDir, { projectRoot, quiet: opts.quiet });
    if (!peer.ok) {
      return { ok: false, message: peer.message ?? "openclaw_peer_dep_failed", pluginRoot: existing };
    }
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

  const pluginRoot = findWeixinPluginRoot(stateDir);
  if (result.status !== 0 || !pluginRoot) {
    const message = `install failed — run: openclaw --dev plugins install ${WEIXIN_NPM_SPEC}`;
    warn(`[ensure-openclaw-weixin-plugin] ${message}`);
    return { ok: false, message, pluginRoot };
  }

  const peer = ensureWeixinPluginOpenClawPeerDep(stateDir, { projectRoot, quiet: opts.quiet });
  if (!peer.ok) {
    return { ok: false, message: peer.message ?? "openclaw_peer_dep_failed", pluginRoot };
  }

  log("[ensure-openclaw-weixin-plugin] ok");
  return { ok: true, installed: true, pluginRoot };
}

module.exports = {
  ensureOpenClawWeixinPlugin,
  ensureWeixinPluginOpenClawPeerDep,
  findWeixinPluginRoot,
  resolveOpenClawCli,
  DEV_STATE_DIR,
  WEIXIN_NPM_SPEC,
};
