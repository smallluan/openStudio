/**
 * Resolve OpenClaw CLI paths for dev (vendor/openclaw.asar) and packaged Electron (app.asar).
 * Keeps ~10k OpenClaw dist files inside asar; only the CLI entry stays on disk (Windows + ELECTRON_RUN_AS_NODE).
 */

const fs = require("fs");
const path = require("path");
const {
  resolveWindowsOpenClawRoot,
  resolveWindowsOpenClawProcessCwd,
  isAsarArchivePath,
  hasHybridOpenClawAsarLayout,
} = require("./win-bundled-resources.cjs");

/** @returns {string} */
function getProjectRoot() {
  return path.join(__dirname, "..");
}

/** @returns {string} */
function getVendorOpenClawAsarPath() {
  return path.join(getProjectRoot(), "vendor", "openclaw.asar");
}

/**
 * @param {string} packageRoot
 * @returns {string}
 */
function resolveOpenClawPackageJsonPath(packageRoot) {
  const direct = path.join(packageRoot, "package.json");
  if (fs.existsSync(direct)) return direct;

  if (packageRoot.endsWith(".asar.unpacked")) {
    const asarPkg = path.join(packageRoot.replace(/\.asar\.unpacked$/i, ".asar"), "package.json");
    if (fs.existsSync(asarPkg)) return asarPkg;
  }

  const ocDir = path.join(packageRoot, "node_modules", "openclaw");
  const asarPkg = preferAsarUnpackedPath(path.join(ocDir, "package.json"));
  if (fs.existsSync(asarPkg)) return asarPkg;

  const inAsar = path.join(ocDir, "package.json");
  if (fs.existsSync(inAsar)) return inAsar;

  return direct;
}

/** @returns {boolean} */
function isVendorOpenClawAsarReady() {
  const asarPath = getVendorOpenClawAsarPath();
  const unpackedCli = path.join(`${asarPath}.unpacked`, "openclaw.mjs");
  return fs.existsSync(asarPath) && fs.existsSync(unpackedCli);
}

/**
 * `ELECTRON_RUN_AS_NODE` subprocess cannot reliably execute scripts inside `app.asar` on Windows.
 * @param {string} p
 * @returns {string}
 */
function preferAsarUnpackedPath(p) {
  if (typeof p !== "string" || !p.includes("app.asar")) return p;
  const norm = p.replace(/\//g, path.sep);
  const needle = `${path.sep}app.asar${path.sep}`;
  const i = norm.indexOf(needle);
  if (i === -1) return p;
  const candidate = `${norm.slice(0, i)}${path.sep}app.asar.unpacked${path.sep}${norm.slice(i + needle.length)}`;
  return fs.existsSync(candidate) ? candidate : p;
}

/**
 * @param {string[]} segments
 * @returns {string}
 */
function dedupeNodePathSegments(segments) {
  const dedup = [];
  const seen = new Set();
  for (const p of segments) {
    const n = path.normalize(p);
    if (!seen.has(n)) {
      seen.add(n);
      dedup.push(n);
    }
  }
  return dedup.join(path.delimiter);
}

/**
 * NODE_PATH for a bundled OpenClaw child: hoisted app deps in asar + unpacked mirror when packaged.
 * @returns {string}
 */
/**
 * @returns {string | null}
 */
function resolvePackagedOpenClawRoot() {
  if (typeof process.resourcesPath !== "string" || !process.resourcesPath.length) return null;
  if (process.platform === "win32") {
    const root = resolveWindowsOpenClawRoot(process.resourcesPath);
    if (fs.existsSync(root)) return root;
  }
  const loose = path.join(process.resourcesPath, "openclaw");
  if (fs.existsSync(loose)) return loose;
  const asar = path.join(process.resourcesPath, "openclaw.asar");
  if (fs.existsSync(asar)) return asar;
  return null;
}

function buildOpenClawCliNodePath(openClawRoot = null) {
  /** @type {string[]} */
  const segments = [];
  const existing = String(process.env.NODE_PATH ?? "").split(path.delimiter);
  for (const s of existing) if (s.trim()) segments.push(s.trim());

  const packagedRoot = openClawRoot || resolvePackagedOpenClawRoot();
  if (packagedRoot) {
    if (isAsarArchivePath(packagedRoot)) {
      segments.push(path.join(packagedRoot, "node_modules"));
    } else {
      segments.push(path.join(packagedRoot, "node_modules"));
    }
  }

  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    segments.push(path.join(process.resourcesPath, "app.asar", "node_modules"));
    segments.push(path.join(process.resourcesPath, "app.asar.unpacked", "node_modules"));
  }

  segments.push(path.join(getProjectRoot(), "node_modules"));

  return dedupeNodePathSegments(segments);
}

/**
 * @returns {string[]}
 */
function enumerateOpenClawSearchRoots() {
  /** @type {string[]} */
  const dirs = [getProjectRoot()];

  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    const packagedRoot = resolvePackagedOpenClawRoot();
    if (packagedRoot) dirs.push(packagedRoot);
    dirs.push(path.join(process.resourcesPath, "app.asar.unpacked"));
    dirs.push(path.join(process.resourcesPath, "app.asar"));
  }

  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const d of dirs) {
    const n = path.normalize(d);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** @returns {string | null} OpenClaw package directory (filesystem path). */
function resolveOpenClawPackageRootSync() {
  const packagedRoot = resolvePackagedOpenClawRoot();
  if (packagedRoot) return packagedRoot;

  const nodeModulesOc = path.join(getProjectRoot(), "node_modules", "openclaw", "package.json");
  if (fs.existsSync(nodeModulesOc)) {
    return path.dirname(nodeModulesOc);
  }

  for (const root of enumerateOpenClawSearchRoots()) {
    const ocDir = path.join(root, "node_modules", "openclaw");
    const pkgPath = resolveOpenClawPackageJsonPath(ocDir);
    if (fs.existsSync(pkgPath)) return path.dirname(pkgPath);
  }
  return null;
}

/**
 * CLI path that loads OpenClaw from inside an asar (dist/entry.js). Plain unpacked openclaw.mjs
 * cannot import ./dist on Windows because vendor/*.asar is not merged like app.asar.
 * @returns {string | null}
 */
function resolveOpenClawAsarBootstrapPath() {
  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    const packaged = path.join(process.resourcesPath, "gateway", "openclaw-asar-bootstrap.mjs");
    if (fs.existsSync(packaged)) return packaged;
  }
  const devScripts = path.join(getProjectRoot(), "scripts", "openclaw-asar-bootstrap.mjs");
  if (fs.existsSync(devScripts)) return devScripts;
  const devLib = path.join(getProjectRoot(), "lib", "gateway", "openclaw-asar-bootstrap.mjs");
  if (fs.existsSync(devLib)) return devLib;
  return null;
}

/**
 * Spawn target for OpenClaw gateway / CLI (Electron as Node).
 * Dev uses `node_modules/openclaw` on disk — OpenClaw's boundary file loader rejects paths inside a
 * standalone `vendor/openclaw.asar` (validation fails even under Electron).
 * @returns {{ cliPath: string; cwd: string; nodePath: string; electronExe: string; bundle: string } | null}
 */
function resolveOpenClawSpawnOptions() {
  let electronExe;
  try {
    electronExe = require("electron");
  } catch {
    return null;
  }
  if (typeof electronExe !== "string" || !fs.existsSync(electronExe)) return null;

  const nodePath = buildOpenClawCliNodePath();
  const bootstrap = resolveOpenClawAsarBootstrapPath();
  const nodeModulesEntry = path.join(getProjectRoot(), "node_modules", "openclaw", "dist", "entry.js");

  if (bootstrap && fs.existsSync(nodeModulesEntry)) {
    return {
      cliPath: bootstrap,
      cwd: getProjectRoot(),
      nodePath,
      electronExe,
      bundle: "node_modules",
    };
  }

  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0 && bootstrap) {
    const packagedEntry = preferAsarUnpackedPath(
      path.join(process.resourcesPath, "app.asar", "node_modules", "openclaw", "dist", "entry.js"),
    );
    if (fs.existsSync(packagedEntry)) {
      return {
        cliPath: bootstrap,
        cwd: getProjectRoot(),
        nodePath,
        electronExe,
        bundle: "app-asar",
      };
    }
  }

  const root = resolveOpenClawPackageRootSync();
  if (!root) return null;

  const cliRaw = path.join(root, "openclaw.mjs");
  const cliPath = preferAsarUnpackedPath(cliRaw);
  if (!fs.existsSync(cliPath)) return null;

  return {
    cliPath,
    cwd: path.dirname(cliPath),
    nodePath,
    electronExe,
    bundle: "node_modules-fallback",
  };
}

module.exports = {
  getProjectRoot,
  getVendorOpenClawAsarPath,
  isVendorOpenClawAsarReady,
  preferAsarUnpackedPath,
  resolveOpenClawPackageJsonPath,
  resolvePackagedOpenClawRoot,
  resolveWindowsOpenClawProcessCwd,
  isAsarArchivePath,
  hasHybridOpenClawAsarLayout,
  buildOpenClawCliNodePath,
  enumerateOpenClawSearchRoots,
  resolveOpenClawPackageRootSync,
  resolveOpenClawAsarBootstrapPath,
  resolveOpenClawSpawnOptions,
};
