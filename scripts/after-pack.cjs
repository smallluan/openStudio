/**

 * electron-builder afterPack hook for Open Studio.

 * Copies openclaw node_modules (skipped by .gitignore), memory-fs zip,

 * packs hybrid openclaw.asar on Windows, and trims native artifacts.

 */

const { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require("fs");

const { join } = require("path");



const asar = require("@electron/asar");

const { applyWindowsPackLayout } = require("./win-pack-layout.cjs");
const { embedWinExeIcon } = require("./embed-win-exe-icon.cjs");

const { normWin, rmWithRetry, replaceFileWithRetry, sleepSync } = require("./win-fs-retry.cjs");

const {

  resolveArch,

  cleanupUnnecessaryFiles,

  cleanupPlatformSpecificArtifactsRecursive,

  patchAllLruCacheInstancesUnderRoot,

  optimizeTreeForPack,

} = require("./pack-tree-optimize.cjs");



async function optimizeAppAsar(resourcesDir, platform, arch) {

  // On Windows, electron-builder often keeps app.asar open during afterPack.

  // The same optimizations run in beforePack on the source tree instead.

  if (platform === "win32") return;



  const appAsarPath = join(resourcesDir, "app.asar");

  if (!existsSync(normWin(appAsarPath))) return;



  const tmpRoot = join(resourcesDir, ".openstudio-tmp-app-asar");

  const readCopyPath = join(resourcesDir, ".openstudio-app-asar-read.tmp");

  const repackPath = join(resourcesDir, "app.asar.repack.tmp");

  try {

    if (existsSync(normWin(tmpRoot))) rmWithRetry(tmpRoot, { recursive: true });

    if (existsSync(normWin(readCopyPath))) rmWithRetry(readCopyPath);

    if (existsSync(normWin(repackPath))) rmWithRetry(repackPath);

    mkdirSync(normWin(tmpRoot), { recursive: true });



    copyFileSync(normWin(appAsarPath), normWin(readCopyPath));

    asar.extractAll(readCopyPath, tmpRoot);

    rmWithRetry(readCopyPath);



    const changeCount = optimizeTreeForPack(tmpRoot, platform, arch, { skipDirNames: null });

    if (changeCount === 0) return;



    await asar.createPackageWithOptions(tmpRoot, repackPath, {});

    replaceFileWithRetry(appAsarPath, repackPath);

    console.log(`[after-pack] repacked app.asar (${changeCount} change(s))`);

  } finally {

    for (const tempPath of [repackPath, readCopyPath, tmpRoot]) {

      if (!existsSync(normWin(tempPath))) continue;

      try {

        rmWithRetry(tempPath, { recursive: tempPath === tmpRoot });

      } catch {

        /* ignore */

      }

    }

  }

}



module.exports = async function afterPack(context) {

  const appOutDir = context.appOutDir;

  const platform = context.electronPlatformName;

  const arch = resolveArch(context.arch);



  console.log(`[after-pack] target: ${platform}/${arch}`);



  let resourcesDir;

  if (platform === "darwin") {

    const appName = context.packager.appInfo.productFilename;

    resourcesDir = join(appOutDir, `${appName}.app`, "Contents", "Resources");

  } else {

    resourcesDir = join(appOutDir, "resources");

  }



  const src = join(__dirname, "..", "build", "openclaw", "node_modules");

  const openclawRoot = join(resourcesDir, "openclaw");

  const dest = join(openclawRoot, "node_modules");



  if (!existsSync(src)) {

    console.warn("[after-pack] build/openclaw/node_modules not found — run bundle-openclaw first");

    return;

  }



  const depCount = readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== ".bin").length;

  console.log(`[after-pack] copying ${depCount} openclaw dependencies...`);

  cpSync(src, dest, { recursive: true });

  console.log("[after-pack] openclaw node_modules copied");



  if (platform === "win32") {

    const memoryFsZip = join(__dirname, "..", "build", "openclaw", "node_modules.zip");

    if (existsSync(memoryFsZip)) {

      const destZip = join(resourcesDir, "node_modules.zip");

      copyFileSync(memoryFsZip, destZip);

      console.log(`[after-pack] node_modules.zip copied (${Math.round(statSync(destZip).size / 1024 / 1024)} MB)`);



      const memoryFsUnpacked = join(__dirname, "..", "build", "openclaw", "node_modules.unpacked");

      if (existsSync(memoryFsUnpacked)) {

        const destUnpacked = join(resourcesDir, "node_modules.unpacked");

        cpSync(memoryFsUnpacked, destUnpacked, { recursive: true });

        const unpackedNativeRemoved = cleanupPlatformSpecificArtifactsRecursive(destUnpacked, platform, arch);

        if (unpackedNativeRemoved > 0) {

          console.log(`[after-pack] node_modules.unpacked: removed ${unpackedNativeRemoved} non-target native artifact(s)`);

        }

      }

    } else {

      console.warn("[after-pack] node_modules.zip not found — run pack:memory-fs before packaging");

    }

  }



  patchAllLruCacheInstancesUnderRoot(dest);



  const removedRoot = cleanupUnnecessaryFiles(openclawRoot);

  if (removedRoot > 0) console.log(`[after-pack] removed ${removedRoot} unnecessary files from openclaw`);



  const nativeRemoved = cleanupPlatformSpecificArtifactsRecursive(openclawRoot, platform, arch);

  if (nativeRemoved > 0) console.log(`[after-pack] removed ${nativeRemoved} non-target native artifacts`);



  if (process.env.OPEN_STUDIO_SKIP_RESOURCE_ASAR !== "1") {

    if (platform === "win32") {

      const layout = await applyWindowsPackLayout(resourcesDir);

      if (layout.openclaw === "packed-hybrid-asar") {

        console.log("[after-pack] packed openclaw -> openclaw.asar (Windows hybrid)");

      } else if (layout.openclaw === "kept-loose") {

        console.log("[after-pack] kept openclaw as loose directory");

      }

    }

  }



  await optimizeAppAsar(resourcesDir, platform, arch);

  if (platform === "win32") {
    const exeName = `${context.packager.appInfo.productFilename}.exe`;
    const exePath = join(appOutDir, exeName);
    const icoPath = join(__dirname, "..", "build", "app-icon.ico");
    embedWinExeIcon(exePath, icoPath);
  }

  for (const unpackedDir of ["app.asar.unpacked", "openclaw.asar.unpacked"]) {

    const full = join(resourcesDir, unpackedDir);

    if (!existsSync(normWin(full))) continue;

    const removed = cleanupPlatformSpecificArtifactsRecursive(full, platform, arch);

    if (removed > 0) console.log(`[after-pack] ${unpackedDir}: removed ${removed} non-target native artifact(s)`);

  }

};


