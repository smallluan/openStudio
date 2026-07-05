"use strict";

/**
 * Avoid EBUSY on Windows: electron-builder insists on wiping `directories.output`/win-unpacked.
 * Cursor / Defender / orphaned handles often keep app.asar open even without a visible UI.
 *
 * Strategy: emit each build under `release/_dist_<ms>/` (fresh tree), then copy the NSIS
 * installer to `release/` so users still grab a stable path (`Open Studio-Setup-<ver>.exe`).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function runNodeScript(relScript) {
  const scriptPath = path.join(root, relScript);
  const result = spawnSync(process.execPath, [scriptPath], { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    process.exit(typeof result.status === "number" && result.status !== 0 ? result.status : 1);
  }
}

/** @returns {string} */
function readJsonTextSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** @returns {string} */
function sha256OfStrings(parts) {
  const crypto = require("crypto");
  const h = crypto.createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest("hex");
}

function openclawBundleInputsHash() {
  const markers = [];
  markers.push(readJsonTextSafe(path.join(root, "package-lock.json")));
  markers.push(readJsonTextSafe(path.join(root, "pnpm-lock.yaml")));
  markers.push(readJsonTextSafe(path.join(root, "node_modules", "openclaw", "package.json")));
  markers.push(readJsonTextSafe(path.join(root, "scripts", "bundle-openclaw.mjs")));
  markers.push(readJsonTextSafe(path.join(root, "scripts", "openclaw-asar-patch.cjs")));
  markers.push(readJsonTextSafe(path.join(root, "scripts", "apply-openclaw-bundle-patches.mjs")));
  markers.push(readJsonTextSafe(path.join(root, "scripts", "patch-openclaw-chat-image-inline.mjs")));
  markers.push(readJsonTextSafe(path.join(root, "scripts", "patch-openclaw-studio-lean-chat.mjs")));
  markers.push(readJsonTextSafe(path.join(root, "node_modules", "chalk", "package.json")));
  return sha256OfStrings(markers);
}

function memoryFsInputsHash(bundleHash) {
  const markers = [];
  markers.push(bundleHash);
  markers.push(readJsonTextSafe(path.join(root, "scripts", "pack-memory-fs.mjs")));
  markers.push(readJsonTextSafe(path.join(root, "scripts", "store-zip-writer.mjs")));
  return sha256OfStrings(markers);
}

function ensureOpenClawBundleUpToDate() {
  const metaPath = path.join(root, "build", "openclaw", ".openstudio-bundle-meta.json");
  const expectedHash = openclawBundleInputsHash();
  const hasBundle =
    fs.existsSync(path.join(root, "build", "openclaw", "package.json")) &&
    fs.existsSync(path.join(root, "build", "openclaw", "dist"));
  const currentMeta = readJsonTextSafe(metaPath);
  const cacheHit = hasBundle && currentMeta.includes(expectedHash);
  if (cacheHit) {
    console.log("[dist:win] openclaw bundle cache hit (skip bundle + patch)");
    return expectedHash;
  }
  console.log("[dist:win] bundling openclaw...");
  runNodeScript("scripts/bundle-openclaw.mjs");
  console.log("[dist:win] applying openclaw bundle patches...");
  runNodeScript("scripts/apply-openclaw-bundle-patches.mjs");
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ hash: expectedHash, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
  return expectedHash;
}

function ensureMemoryFsPacked(bundleHash) {
  const metaPath = path.join(root, "build", "openclaw", ".openstudio-memoryfs-meta.json");
  const zipPath = path.join(root, "build", "openclaw", "node_modules.zip");
  const unpackedPath = path.join(root, "build", "openclaw", "node_modules.unpacked");
  const expectedHash = memoryFsInputsHash(bundleHash);
  const hasArtifacts = fs.existsSync(zipPath) && fs.existsSync(unpackedPath);
  const currentMeta = readJsonTextSafe(metaPath);
  const cacheHit = hasArtifacts && currentMeta.includes(expectedHash);
  if (cacheHit) {
    console.log("[dist:win] memory-fs cache hit (skip pack)");
    return;
  }
  console.log("[dist:win] packing memory-fs zip...");
  runNodeScript("scripts/pack-memory-fs.mjs");
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ hash: expectedHash, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

function ensurePythonRuntimeReady() {
  if (process.platform !== "win32") return;
  const pyExe = path.join(root, "build", "python-runtime", "python.exe");
  if (fs.existsSync(pyExe)) {
    console.log("[dist:win] python runtime cache hit (skip prepare)");
    return;
  }
  console.log("[dist:win] preparing bundled python runtime...");
  runNodeScript("scripts/prepare-python-runtime-win.cjs");
}

function ensureElectronDistCache() {
  const cachedElectronDist = path.join(root, "build", "electron-dist", "win32-x64");
  const electronExe = path.join(cachedElectronDist, "electron.exe");
  if (fs.existsSync(electronExe)) return cachedElectronDist;
  console.log("[dist:win] preparing cached electron dist...");
  runNodeScript("scripts/prepare-electron-dist.mjs");
  return fs.existsSync(electronExe) ? cachedElectronDist : "";
}

const bundleHash = ensureOpenClawBundleUpToDate();
ensureMemoryFsPacked(bundleHash);
ensurePythonRuntimeReady();
const productName = pkg.build?.productName || "Electron";
const version = String(pkg.version ?? "0.0.0");
const artifactTemplate =
  pkg.build?.win?.artifactName && typeof pkg.build.win.artifactName === "string"
    ? pkg.build.win.artifactName
    : "${productName}-Setup-${version}.${ext}";

/** @returns {string} */
function expandArtifact(template) {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => {
    if (key === "productName") return productName;
    if (key === "version") return version;
    if (key === "ext") return "exe";
    return "";
  });
}

/** @param {string} releaseDir */
function pruneOldDistStaging(releaseDir, keep = 2) {
  if (!fs.existsSync(releaseDir)) return;
  const entries = [];
  try {
    for (const name of fs.readdirSync(releaseDir)) {
      const full = path.join(releaseDir, name);
      if (!name.startsWith("_dist_") || !fs.statSync(full).isDirectory()) continue;
      const suffix = name.slice("_dist_".length);
      const stamp = Number(suffix);
      entries.push({ full, stamp: Number.isFinite(stamp) ? stamp : 0 });
    }
  } catch {
    return;
  }
  entries.sort((a, b) => b.stamp - a.stamp);
  for (let i = keep; i < entries.length; i++) {
    try {
      fs.rmSync(entries[i].full, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    } catch {
      /* may still be EBUSY; ignore */
    }
  }
}

if (process.platform === "win32") {
  spawnSync("taskkill", ["/IM", `${productName}.exe`, "/T", "/F"], { stdio: "ignore", shell: false });
  sleep(350);
}

const stamp = Date.now();
const stagingRel = path.join("release", `_dist_${stamp}`);
const stagingAbs = path.join(root, stagingRel);
fs.mkdirSync(stagingAbs, { recursive: true });

const ebCli = path.join(root, "node_modules", "electron-builder", "cli.js");
/** @type {string[]} */
const ebArgs = [ebCli, "--win", "nsis", "--publish", "never", "--config.directories.output", stagingRel];
const cachedElectronDist = ensureElectronDistCache();
if (cachedElectronDist && fs.existsSync(cachedElectronDist)) {
  ebArgs.push("--config.electronDist", cachedElectronDist);
  console.log("[dist:win] using cached electron dist:", path.relative(root, cachedElectronDist));
}
const eb = spawnSync(process.execPath, ebArgs, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    // Avoid auto-discovered certs + winCodeSign extraction (symlink privilege errors on Windows).
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
});

if (eb.status !== 0) {
  process.exit(typeof eb.status === "number" && eb.status !== 0 ? eb.status : 1);
}

const expectedSetupName = expandArtifact(artifactTemplate);
let setupRel = fs.existsSync(path.join(stagingAbs, expectedSetupName)) ? expectedSetupName : "";

if (!setupRel) {
  setupRel =
    fs
      .readdirSync(stagingAbs)
      .find(
        (name) =>
          /\.exe$/i.test(name) &&
          /Setup/i.test(name) &&
          name !== "elevate.exe" &&
          fs.statSync(path.join(stagingAbs, name)).isFile(),
      ) ?? "";
}

if (!setupRel) {
  console.error(
    `[dist:win] No NSIS Setup .exe found in "${stagingAbs}". Inspect that folder manually.`,
  );
  process.exit(1);
}

const stableReleaseRoot = path.join(root, "release");
fs.mkdirSync(stableReleaseRoot, { recursive: true });
fs.copyFileSync(path.join(stagingAbs, setupRel), path.join(stableReleaseRoot, setupRel));

pruneOldDistStaging(stableReleaseRoot, 3);

console.log(
  `\n[dist:win] NSIS installer: ${path.relative(root, path.join(stableReleaseRoot, setupRel))}`,
);
console.log(
  `[dist:win] Staging (${path.relative(root, stagingAbs)} — safe to delete if you do not need the unpacked exe):`,
  path.join(stagingRel, "win-unpacked"),
);
