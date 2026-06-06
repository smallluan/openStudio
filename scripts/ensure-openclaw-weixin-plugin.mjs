/**
 * Dev profile (~/.openclaw-dev) needs @tencent-weixin/openclaw-weixin on disk for QR login.
 * Fresh clones should not require a manual `openclaw plugins install`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { ensureDevGatewayAuthToken } = require("../lib/sync-openclaw-agent-from-studio.cjs");

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

function resolveOpenClawCli() {
  try {
    return require.resolve("openclaw/openclaw.mjs");
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
  }
}

if (process.env.OPEN_STUDIO_SKIP_WEIXIN_PLUGIN === "1") {
  console.log("[ensure-openclaw-weixin-plugin] skipped (OPEN_STUDIO_SKIP_WEIXIN_PLUGIN=1)");
  process.exit(0);
}

ensureDevGatewayAuthToken(DEV_STATE_DIR);
ensureWeixinInPluginsAllow(DEV_STATE_DIR);

if (findWeixinPluginRoot(DEV_STATE_DIR)) {
  console.log("[ensure-openclaw-weixin-plugin] already installed");
  process.exit(0);
}

const cli = resolveOpenClawCli();
if (!cli) {
  console.warn("[ensure-openclaw-weixin-plugin] openclaw not found — run package install first");
  process.exit(0);
}

console.log(`[ensure-openclaw-weixin-plugin] installing ${WEIXIN_NPM_SPEC} into ~/.openclaw-dev …`);
const result = spawnSync(process.execPath, [cli, "--dev", "plugins", "install", WEIXIN_NPM_SPEC], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  console.warn(
    "[ensure-openclaw-weixin-plugin] install failed — WeChat QR login needs:",
    `openclaw --dev plugins install ${WEIXIN_NPM_SPEC}`,
  );
  process.exit(0);
}

if (findWeixinPluginRoot(DEV_STATE_DIR)) {
  console.log("[ensure-openclaw-weixin-plugin] ok");
} else {
  console.warn("[ensure-openclaw-weixin-plugin] install finished but plugin files were not found");
}
