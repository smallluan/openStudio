/**
 * Dev gateway launcher: run OpenClaw via Electron (asar-aware) instead of plain `openclaw` on disk.
 */

import { spawn } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { resolveOpenClawSpawnOptions } = require("../lib/openclaw-bundle-paths.cjs");
const { ensureDevGatewayAuthToken } = require("../lib/sync-openclaw-agent-from-studio.cjs");
const { ensureOpenClawWeixinPlugin } = require("../lib/ensure-openclaw-weixin-plugin.cjs");

const tokenPrep = ensureDevGatewayAuthToken();
if (tokenPrep.ok && tokenPrep.created) {
  console.log("[run-openclaw-gateway] persisted dev gateway auth token in ~/.openclaw-dev/openclaw.json");
}

const weixinPrep = ensureOpenClawWeixinPlugin({ projectRoot: path.join(__dirname, "..") });
if (weixinPrep.installed) {
  console.log("[run-openclaw-gateway] installed WeChat plugin — gateway will load it on this start");
}

const forwardArgs = process.argv.slice(2);
if (forwardArgs.length === 0) {
  // Dev gateway uses port 19002 to avoid conflict with packaged exe's gateway on 19001.
  forwardArgs.push("--dev", "gateway", "run", "--bind", "loopback", "--port", "19002", "--force");
}

const target = resolveOpenClawSpawnOptions();
if (!target) {
  console.error(
    "[run-openclaw-gateway] could not resolve openclaw CLI (run npm install; for asar run postinstall / pack-openclaw-asar)",
  );
  process.exit(1);
}

console.log("[run-openclaw-gateway]", {
  bundle: target.bundle,
  cli: path.relative(path.join(__dirname, ".."), target.cliPath),
});

const child = spawn(target.electronExe, [target.cliPath, ...forwardArgs], {
  cwd: target.cwd,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_PATH: target.nodePath,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    /** Skip ~20–30s pdf-tool factory on each chat.send prep (see patch-openclaw-studio-lean-chat.mjs). */
    OPEN_STUDIO_LEAN_CHAT_TOOLS: process.env.OPEN_STUDIO_LEAN_CHAT_TOOLS ?? "1",
    /** Native sidebar_action tool → Electron loopback bridge (lib/sidebar-action-tool-bridge.cjs). */
    OPEN_STUDIO_SIDEBAR_TOOL_URL:
      process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL ?? "http://127.0.0.1:19111",
    OPEN_STUDIO_SIDEBAR_TOOL_TOKEN:
      process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN ?? "open-studio-local-sidebar-action",
    /** sessions_spawn blocks until subagent finishes (see patch-openclaw-sessions-spawn-await.mjs). */
    OPEN_STUDIO_SUBAGENT_AWAIT: process.env.OPEN_STUDIO_SUBAGENT_AWAIT ?? "1",
  },
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (err) => {
  console.error("[run-openclaw-gateway] spawn failed:", err?.message ?? err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(typeof code === "number" ? code : 1);
});
