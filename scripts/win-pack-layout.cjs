/**
 * Windows-only resource layout: pack openclaw into hybrid openclaw.asar.
 */
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");
const { normWin, rmWithRetry, replaceFileWithRetry, sleepSync } = require("./win-fs-retry.cjs");

const OPENCLAW_ASAR_UNPACK_FILES = "**/*.{node,dll}";
const OPENCLAW_ASAR_UNPACK_DIR = "dist/extensions";

function isWindowsOpenClawAsarEnabled() {
  const raw = process.env.OPEN_STUDIO_WINDOWS_OPENCLAW_ASAR ?? process.env.YONCLAW_WINDOWS_OPENCLAW_ASAR;
  if (raw === "0" || raw === "false") return false;
  return true;
}

async function applyWindowsPackLayout(resourcesDir) {
  if (process.platform !== "win32") return {};
  if (!isWindowsOpenClawAsarEnabled()) {
    return { openclaw: keepOpenClawLoose(resourcesDir) };
  }
  const openclaw = await packOpenClawHybridAsar(resourcesDir);
  verifyWindowsBundledExtensionsIntegrity(resourcesDir);
  return { openclaw };
}

function verifyWindowsBundledExtensionsIntegrity(resourcesDir) {
  const bundledExtensionsRoot = path.join(resourcesDir, "openclaw.asar.unpacked", "dist", "extensions");
  if (!fs.existsSync(normWin(bundledExtensionsRoot))) {
    console.log("[win-pack-layout] no dist/extensions unpacked — skipping integrity check");
    return;
  }

  const mirrorExtensionsRoot = path.join(resourcesDir, "openclaw-extensions-mirror");
  if (!fs.existsSync(normWin(mirrorExtensionsRoot))) {
    console.warn("[win-pack-layout] openclaw-extensions-mirror missing — startup repair may be limited");
  }
}

async function packOpenClawHybridAsar(resourcesDir) {
  const loose = path.join(resourcesDir, "openclaw");
  const asarDest = path.join(resourcesDir, "openclaw.asar");
  const asarTemp = path.join(resourcesDir, "openclaw.asar.repack.tmp");
  const unpackedDest = path.join(resourcesDir, "openclaw.asar.unpacked");

  if (!fs.existsSync(normWin(loose))) {
    return "skipped-missing-loose-openclaw";
  }

  if (fs.existsSync(normWin(asarTemp))) rmWithRetry(asarTemp);
  if (fs.existsSync(normWin(unpackedDest))) rmWithRetry(unpackedDest, { recursive: true });
  if (fs.existsSync(normWin(asarDest))) {
    const stalePath = `${asarDest}.stale-${Date.now()}`;
    try {
      fs.renameSync(normWin(asarDest), normWin(stalePath));
      rmWithRetry(stalePath);
    } catch {
      /* replaceFileWithRetry handles any remaining target */
    }
  }

  const unpackOptions = { unpack: OPENCLAW_ASAR_UNPACK_FILES };
  const extensionsDir = path.join(loose, "dist", "extensions");
  if (fs.existsSync(normWin(extensionsDir))) {
    unpackOptions.unpackDir = OPENCLAW_ASAR_UNPACK_DIR;
  }

  await asar.createPackageWithOptions(loose, asarTemp, unpackOptions);
  if (process.platform === "win32") sleepSync(100);
  replaceFileWithRetry(asarDest, asarTemp);
  refreshWindowsBundledExtensionsMirror(resourcesDir);
  rmWithRetry(loose, { recursive: true });
  return "packed-hybrid-asar";
}

function refreshWindowsBundledExtensionsMirror(resourcesDir) {
  const unpackedExtensions = path.join(resourcesDir, "openclaw.asar.unpacked", "dist", "extensions");
  const mirrorDir = path.join(resourcesDir, "openclaw-extensions-mirror");
  if (!fs.existsSync(normWin(unpackedExtensions))) return;
  rmWithRetry(mirrorDir, { recursive: true });
  fs.cpSync(normWin(unpackedExtensions), normWin(mirrorDir), { recursive: true, dereference: true });
}

function keepOpenClawLoose(resourcesDir) {
  const asarDest = path.join(resourcesDir, "openclaw.asar");
  const unpackedDest = path.join(resourcesDir, "openclaw.asar.unpacked");
  if (fs.existsSync(normWin(asarDest))) rmWithRetry(asarDest);
  if (fs.existsSync(normWin(unpackedDest))) rmWithRetry(unpackedDest, { recursive: true });
  const mirrorDir = path.join(resourcesDir, "openclaw-extensions-mirror");
  if (fs.existsSync(normWin(mirrorDir))) rmWithRetry(mirrorDir, { recursive: true });
  return "kept-loose";
}

module.exports = {
  OPENCLAW_ASAR_UNPACK_FILES,
  OPENCLAW_ASAR_UNPACK_DIR,
  applyWindowsPackLayout,
  isWindowsOpenClawAsarEnabled,
  packOpenClawHybridAsar,
  verifyWindowsBundledExtensionsIntegrity,
};
