/**
 * Windows-only resource layout: pack openclaw into hybrid openclaw.asar.
 */
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");
const { normWin, rmWithRetry, sleepSync } = require("./win-fs-retry.cjs");

const OPENCLAW_ASAR_UNPACK_FILES = "**/*.{node,dll}";
const OPENCLAW_ASAR_UNPACK_DIR = "dist/extensions";
const MEMORY_FS_MARKER = "openclaw-memory-fs.json";
const MEMORY_FS_ONLY_ENTRIES = [
  "node_modules",
  "node_modules.zip",
  "node_modules.unpacked",
  ".openstudio-memoryfs-meta.json",
];

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
  verifyMemoryFsResources(resourcesDir);
  const openclaw = await packOpenClawHybridAsar(resourcesDir);
  verifyWindowsBundledExtensionsIntegrity(resourcesDir);
  return { openclaw };
}

function verifyMemoryFsResources(resourcesDir) {
  const required = [
    "node_modules.zip",
    path.join("gateway", "memory-fs", "register.mjs"),
  ];
  const missing = required.filter((rel) => !fs.existsSync(normWin(path.join(resourcesDir, rel))));
  if (missing.length > 0) {
    throw new Error(
      `[win-pack-layout] memory-fs-only package is missing required resource(s): ${missing.join(", ")}`,
    );
  }
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

/**
 * @param {string} targetPath
 * @param {{ recursive?: boolean }} [opts]
 */
function removeIfExists(targetPath, opts = {}) {
  if (!fs.existsSync(normWin(targetPath))) return;
  rmWithRetry(targetPath, { recursive: Boolean(opts.recursive) });
}

async function packOpenClawHybridAsar(resourcesDir) {
  const loose = path.join(resourcesDir, "openclaw");
  const asarDest = path.join(resourcesDir, "openclaw.asar");
  const unpackedDest = path.join(resourcesDir, "openclaw.asar.unpacked");
  const legacyAsarTemp = path.join(resourcesDir, "openclaw.asar.repack.tmp");
  const legacyUnpackedTemp = `${legacyAsarTemp}.unpacked`;

  if (!fs.existsSync(normWin(loose))) {
    return "skipped-missing-loose-openclaw";
  }

  // Write directly to openclaw.asar so @electron/asar emits openclaw.asar.unpacked
  // (avoid renaming *.repack.tmp.unpacked on Windows — often EPERM under AV/indexers).
  removeIfExists(legacyUnpackedTemp, { recursive: true });
  removeIfExists(legacyAsarTemp);
  removeIfExists(unpackedDest, { recursive: true });
  removeIfExists(asarDest);

  for (const entry of MEMORY_FS_ONLY_ENTRIES) {
    removeIfExists(path.join(loose, entry), {
      recursive: entry === "node_modules" || entry === "node_modules.unpacked",
    });
  }

  const unpackOptions = { unpack: OPENCLAW_ASAR_UNPACK_FILES };
  const extensionsDir = path.join(loose, "dist", "extensions");
  if (fs.existsSync(normWin(extensionsDir))) {
    unpackOptions.unpackDir = OPENCLAW_ASAR_UNPACK_DIR;
  }

  await asar.createPackageWithOptions(loose, asarDest, unpackOptions);
  if (process.platform === "win32") sleepSync(100);

  if (!fs.existsSync(normWin(asarDest))) {
    throw new Error("[win-pack-layout] openclaw.asar was not created");
  }

  if (unpackOptions.unpackDir && !fs.existsSync(normWin(unpackedDest))) {
    throw new Error("[win-pack-layout] openclaw.asar.unpacked missing after pack");
  }

  refreshWindowsBundledExtensionsMirror(resourcesDir);
  fs.writeFileSync(
    normWin(path.join(resourcesDir, MEMORY_FS_MARKER)),
    `${JSON.stringify({ version: 1, dependencyLayout: "memory-fs-only" })}\n`,
    "utf8",
  );
  removeIfExists(loose, { recursive: true });
  return "packed-hybrid-asar";
}

function refreshWindowsBundledExtensionsMirror(resourcesDir) {
  const unpackedExtensions = path.join(resourcesDir, "openclaw.asar.unpacked", "dist", "extensions");
  const mirrorDir = path.join(resourcesDir, "openclaw-extensions-mirror");
  if (!fs.existsSync(normWin(unpackedExtensions))) return;
  removeIfExists(mirrorDir, { recursive: true });
  fs.cpSync(normWin(unpackedExtensions), normWin(mirrorDir), { recursive: true, dereference: true });
}

function keepOpenClawLoose(resourcesDir) {
  const asarDest = path.join(resourcesDir, "openclaw.asar");
  const unpackedDest = path.join(resourcesDir, "openclaw.asar.unpacked");
  removeIfExists(asarDest);
  removeIfExists(unpackedDest, { recursive: true });
  const mirrorDir = path.join(resourcesDir, "openclaw-extensions-mirror");
  removeIfExists(mirrorDir, { recursive: true });
  removeIfExists(path.join(resourcesDir, MEMORY_FS_MARKER));
  return "kept-loose";
}

module.exports = {
  OPENCLAW_ASAR_UNPACK_FILES,
  OPENCLAW_ASAR_UNPACK_DIR,
  MEMORY_FS_MARKER,
  applyWindowsPackLayout,
  isWindowsOpenClawAsarEnabled,
  packOpenClawHybridAsar,
  verifyWindowsBundledExtensionsIntegrity,
};
