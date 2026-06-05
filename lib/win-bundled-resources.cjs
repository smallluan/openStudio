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

module.exports = {
  isAsarArchivePath,
  resolveWindowsOpenClawRoot,
  resolveWindowsOpenClawProcessCwd,
  resolveWindowsBundledExtensionsRoot,
  hasHybridOpenClawAsarLayout,
};
