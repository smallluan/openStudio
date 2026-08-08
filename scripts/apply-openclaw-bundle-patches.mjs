/**
 * Apply Open Studio postinstall patches to build/openclaw (used during dist:win).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const bundleRoot = process.env.OPENCLAW_BUNDLE_ROOT
  ? path.resolve(process.env.OPENCLAW_BUNDLE_ROOT)
  : path.join(root, "build", "openclaw");

if (!fs.existsSync(path.join(bundleRoot, "package.json"))) {
  console.warn("[apply-openclaw-bundle-patches] skip — bundle not found:", bundleRoot);
  process.exit(0);
}

const env = {
  ...process.env,
  OPENCLAW_PATCH_ROOT: bundleRoot,
};

for (const script of [
  "patch-openclaw-chat-image-inline.mjs",
  "patch-openclaw-studio-lean-chat.mjs",
  "patch-openclaw-session-manager-sqlite.mjs",
  "patch-openclaw-compact-tool-descriptions.mjs",
  "patch-openclaw-sidebar-action.mjs",
  "patch-openclaw-browser-open.mjs",
  "patch-openclaw-sidebar-preview-tools.mjs",
  "patch-openclaw-sidebar-debugger.mjs",
  "patch-openclaw-sidebar-eval.mjs",
  "patch-openclaw-sidebar-tools-scope.mjs",
  "patch-openclaw-tool-search-aliases.mjs",
  "patch-openclaw-browser-observation-prune.mjs",
  "patch-openclaw-sessions-spawn-await.mjs",
]) {
  const scriptPath = path.join(__dirname, script);
  const result = spawnSync(process.execPath, [scriptPath], { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
