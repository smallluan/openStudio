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

const forwardArgs = process.argv.slice(2);
if (forwardArgs.length === 0) {
  forwardArgs.push("--dev", "gateway", "run", "--bind", "loopback", "--port", "19001", "--force");
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
