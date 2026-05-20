"use strict";

const fs = require("fs");
const path = require("path");

/**
 * electron-builder can prune nested deps of hoisted packages (e.g. minimatch →
 * brace-expansion → concat-map). Hoist critical tiny modules so packaged app.asar
 * resolves them at `node_modules/<name>`.
 */
const REQUIRED_TOP_LEVEL = ["concat-map", "balanced-match"];

/** @param {import("electron-builder").BeforePackContext} context */
module.exports = async function beforePack(context) {
  const root = context.packager.projectDir;
  const missing = REQUIRED_TOP_LEVEL.filter(
    (name) => !fs.existsSync(path.join(root, "node_modules", name)),
  );
  if (missing.length) {
    throw new Error(
      `[beforePack] Missing modules: ${missing.join(", ")} — run npm install before dist:win`,
    );
  }
};
