"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveArch, optimizeTreeForPack } = require("./pack-tree-optimize.cjs");

/**
 * electron-builder can prune nested deps of hoisted packages (e.g. minimatch →
 * brace-expansion → concat-map). Hoist critical tiny modules so packaged app.asar
 * resolves them at `node_modules/<name>`.
 */
const REQUIRED_TOP_LEVEL = ["brace-expansion", "balanced-match", "concat-map"];

/** @param {import("electron-builder").BeforePackContext} context */
module.exports = async function beforePack(context) {
  const root = context.packager.projectDir;
  const appIconIco = path.join(root, "build", "app-icon.ico");
  if (!fs.existsSync(appIconIco)) {
    console.log("[before-pack] app icon missing, running sync-app-icon...");
    const sync = spawnSync(process.execPath, [path.join(root, "scripts", "sync-app-icon.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
    if (sync.status !== 0) {
      throw new Error("[beforePack] sync-app-icon failed — cannot package without build/app-icon.ico");
    }
  }

  const missing = REQUIRED_TOP_LEVEL.filter(
    (name) => !fs.existsSync(path.join(root, "node_modules", name)),
  );
  if (missing.length) {
    throw new Error(
      `[beforePack] Missing modules: ${missing.join(", ")} — run npm install before dist:win`,
    );
  }

  const platform = context.electronPlatformName;
  const arch = resolveArch(context.arch);
  const changeCount = optimizeTreeForPack(root, platform, arch);
  if (changeCount > 0) {
    console.log(`[before-pack] optimized app sources for ${platform}/${arch} (${changeCount} change(s))`);
  }
};
