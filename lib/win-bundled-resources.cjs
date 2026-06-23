/**
 * Windows packaged resource path resolution (openclaw.asar hybrid layout).
 */
const path = require("path");
const fs = require("fs");

function isAsarArchivePath(filePath) {
  return path.basename(filePath).toLowerCase().endsWith(".asar");
}

/**
 * Resolve OpenClaw package root for packaged Windows builds.
 * Prefers loose `openclaw/` when present (rollback), else `openclaw.asar`.
 * @param {string} resourcesPath
 * @returns {string}
 */
function resolveWindowsOpenClawRoot(resourcesPath) {
  const unpackedDir = path.join(resourcesPath, "openclaw");
  if (fs.existsSync(unpackedDir)) {
    return unpackedDir;
  }
  return path.join(resourcesPath, "openclaw.asar");
}

/**
 * Working directory for OpenClaw subprocess when root is an asar archive file.
 * @param {string} resourcesPath
 * @param {string} openClawRoot
 * @returns {string}
 */
function resolveWindowsOpenClawProcessCwd(resourcesPath, openClawRoot) {
  if (isAsarArchivePath(openClawRoot)) {
    return resourcesPath;
  }
  return openClawRoot;
}

/**
 * Bundled extensions directory — must be on-disk for OpenClaw manifest validation.
 * @param {string} resourcesPath
 * @param {string} openClawRoot
 * @returns {string}
 */
function resolveWindowsBundledExtensionsRoot(resourcesPath, openClawRoot) {
  if (isAsarArchivePath(openClawRoot)) {
    const unpackedExtensions = path.join(`${openClawRoot}.unpacked`, "dist", "extensions");
    if (fs.existsSync(unpackedExtensions)) {
      return unpackedExtensions;
    }
  }
  return path.join(openClawRoot, "dist", "extensions");
}

/**
 * @param {string} resourcesPath
 * @returns {boolean}
 */
function hasHybridOpenClawAsarLayout(resourcesPath) {
  return fs.existsSync(path.join(resourcesPath, "openclaw.asar"));
}

/**
 * @param {string} resourcesPath
 * @returns {boolean} true when a stale unpacked dir was renamed into place
 */
function repairWindowsOpenClawUnpackedLayout(resourcesPath) {
  if (process.platform !== "win32") return false;
  const expected = path.join(resourcesPath, "openclaw.asar.unpacked");
  if (fs.existsSync(expected)) return false;
  const stale = path.join(resourcesPath, "openclaw.asar.repack.tmp.unpacked");
  if (!fs.existsSync(stale)) return false;
  try {
    fs.renameSync(stale, expected);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore missing unpacked extension files from the pack-time mirror.
 * Fixes gateway startup failures like missing `openai/provider-policy-api.js`.
 * @param {string} resourcesPath
 * @returns {number} count of files restored
 */
function repairWindowsBundledExtensionsFromMirror(resourcesPath) {
  if (process.platform !== "win32") return 0;
  const mirrorRoot = path.join(resourcesPath, "openclaw-extensions-mirror");
  const unpackedRoot = path.join(resourcesPath, "openclaw.asar.unpacked", "dist", "extensions");
  if (!fs.existsSync(mirrorRoot) || !fs.existsSync(unpackedRoot)) return 0;

  /** @type {string[]} */
  const queue = [""];
  let restored = 0;

  while (queue.length) {
    const rel = queue.pop() ?? "";
    const mirrorDir = path.join(mirrorRoot, rel);
    let entries = [];
    try {
      entries = fs.readdirSync(mirrorDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const nextRel = rel ? path.join(rel, ent.name) : ent.name;
      const mirrorPath = path.join(mirrorRoot, nextRel);
      const targetPath = path.join(unpackedRoot, nextRel);
      if (ent.isDirectory()) {
        queue.push(nextRel);
        continue;
      }
      if (!ent.isFile()) continue;
      if (fs.existsSync(targetPath)) continue;
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(mirrorPath, targetPath);
        restored += 1;
      } catch {
        /* ignore single-file repair failures */
      }
    }
  }

  return restored;
}

module.exports = {
  isAsarArchivePath,
  resolveWindowsOpenClawRoot,
  resolveWindowsOpenClawProcessCwd,
  resolveWindowsBundledExtensionsRoot,
  hasHybridOpenClawAsarLayout,
  repairWindowsOpenClawUnpackedLayout,
  repairWindowsBundledExtensionsFromMirror,
};
