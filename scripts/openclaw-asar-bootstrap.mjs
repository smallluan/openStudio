/**
 * Bootstrap OpenClaw CLI from an asar archive (dev vendor pack or packaged app.asar).
 * Unpacked openclaw.mjs cannot `import("./dist/entry.js")` — dist stays inside the asar.
 * Rewrites argv[1] to the real entry path so `dist/entry.js` passes `isMainModule` (wrapper pair).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { preferAsarUnpackedPath, resolveOpenClawPackageRootSync } = require("../lib/openclaw-bundle-paths.cjs");

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;

function ensureNodeVersion() {
  const [majorRaw = "0", minorRaw = "0"] = process.versions.node.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  if (major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)) return;
  process.stderr.write(
    `openclaw: Node.js v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+ is required (current: v${process.versions.node}).\n`,
  );
  process.exit(1);
}

/** @returns {string | null} */
function resolveEntryFilePath() {
  const nodeModulesEntry = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    "openclaw",
    "dist",
    "entry.js",
  );
  if (existsSync(nodeModulesEntry)) return nodeModulesEntry;

  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    const packaged = preferAsarUnpackedPath(
      path.join(process.resourcesPath, "app.asar", "node_modules", "openclaw", "dist", "entry.js"),
    );
    if (existsSync(packaged)) return packaged;
  }

  const root = resolveOpenClawPackageRootSync();
  if (!root) return null;

  const loose = path.join(root, "dist", "entry.js");
  if (existsSync(loose)) return loose;

  const asarSibling = path.join(root.replace(/\.asar\.unpacked$/i, ".asar"), "dist", "entry.js");
  if (existsSync(asarSibling)) return asarSibling;

  return null;
}

ensureNodeVersion();

const entryPath = resolveEntryFilePath();
if (!entryPath) {
  console.error(
    "[openclaw-asar-bootstrap] could not resolve dist/entry.js (run npm install)",
  );
  process.exit(1);
}

if (!existsSync(entryPath)) {
  console.error(
    "[openclaw-asar-bootstrap] dist/entry.js not visible (use Electron with ELECTRON_RUN_AS_NODE=1 for asar paths):",
    entryPath,
  );
  process.exit(1);
}

const forwardArgs = process.argv.slice(2);
process.argv = [process.argv[0], entryPath, ...forwardArgs];

await import(pathToFileURL(entryPath).href);
