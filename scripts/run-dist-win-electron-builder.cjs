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
const eb = spawnSync(process.execPath, [ebCli, "--win", "nsis", "--publish", "never", "--config.directories.output", stagingRel], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
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
