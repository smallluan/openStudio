/**
 * Patch OpenClaw dist chunks so Gateway works when the runtime is packed as
 * `openclaw.asar` on Electron (virtual paths break realpathSync boundary checks).
 *
 * @param {string} bundleRootDir - OpenClaw package root (`build/openclaw` or `resources/openclaw`)
 * @returns {{ changed: boolean, requiredOk: boolean, patchedFiles: string[], reason?: string }}
 */
const fs = require("fs");
const path = require("path");

const REQUIRED_PREFIXES = ["pinned-open-"];
const OPTIONAL_PREFIXES = ["boundary-path-", "root-path-", "path-"];

function normWin(p) {
  if (process.platform !== "win32") return p;
  if (p.startsWith("\\\\?\\")) return p;
  return "\\\\?\\" + p.replace(/\//g, "\\");
}

function isElectronAsarVirtualFilePathHelperBlock() {
  return [
    "function isElectronAsarVirtualFilePath(filePath) {",
    "\tif (typeof filePath !== \"string\") return false;",
    "\treturn /\\.asar(\\/|\\\\)/.test(filePath) || /\\.asar$/i.test(filePath);",
    "}",
  ].join("\n");
}

function listDistChunkFiles(bundleRootDir, prefix) {
  const distDir = path.join(bundleRootDir, "dist");
  if (!fs.existsSync(normWin(distDir))) return [];
  return fs
    .readdirSync(normWin(distDir))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .map((name) => path.join("dist", name));
}

function patchSafeOpenSyncSource(source) {
  if (source.includes("isElectronAsarVirtualFilePath(params.filePath) ? params.filePath : realPath")) {
    return { source, changed: false };
  }

  const alreadyHasHelper = source.includes("isElectronAsarVirtualFilePath");

  const preambleNeedle = [
    "function isExpectedPathError(error) {",
    '\tconst code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";',
    '\treturn code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";',
    "}",
    "function sameFileIdentity(left, right) {",
    "\treturn sameFileIdentity$1(left, right);",
    "}",
  ].join("\n");

  const preambleReplacement = [
    "function isExpectedPathError(error) {",
    '\tconst code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";',
    '\treturn code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";',
    "}",
    isElectronAsarVirtualFilePathHelperBlock(),
    "function sameFileIdentity(left, right) {",
    "\treturn sameFileIdentity$1(left, right);",
    "}",
  ].join("\n");

  const preOpenNeedle = [
    "\t\tconst realPath = params.resolvedPath ?? ioFs.realpathSync(params.filePath);",
    "\t\tconst preOpenStat = ioFs.lstatSync(realPath);",
    "\t\tif (!isAllowedType(preOpenStat, allowedType)) return {",
    "\t\t\tok: false,",
    '\t\t\treason: "validation"',
    "\t\t};",
    "\t\tif (params.rejectHardlinks && preOpenStat.isFile() && preOpenStat.nlink > 1) return {",
    "\t\t\tok: false,",
    '\t\t\treason: "validation"',
    "\t\t};",
  ].join("\n");

  const preOpenReplacement = [
    "\t\tconst realPath = params.resolvedPath ?? ioFs.realpathSync(params.filePath);",
    "\t\tconst relaxHardlinksForAsar = isElectronAsarVirtualFilePath(realPath) || isElectronAsarVirtualFilePath(params.filePath);",
    "\t\tconst preOpenStat = ioFs.lstatSync(realPath);",
    "\t\tif (!isAllowedType(preOpenStat, allowedType)) return {",
    "\t\t\tok: false,",
    '\t\t\treason: "validation"',
    "\t\t};",
    "\t\tif (params.rejectHardlinks && !relaxHardlinksForAsar && preOpenStat.isFile() && preOpenStat.nlink > 1) return {",
    "\t\t\tok: false,",
    '\t\t\treason: "validation"',
    "\t\t};",
  ].join("\n");

  const postOpenNeedle =
    "\t\tif (params.rejectHardlinks && openedStat.isFile() && openedStat.nlink > 1) return {";
  const postOpenReplacement =
    "\t\tif (params.rejectHardlinks && !relaxHardlinksForAsar && openedStat.isFile() && openedStat.nlink > 1) return {";

  const sameFileNeedle = "\t\tif (!sameFileIdentity(preOpenStat, openedStat)) return {";
  const sameFileReplacement =
    "\t\tif (!relaxHardlinksForAsar && !sameFileIdentity(preOpenStat, openedStat)) return {";

  const openedPathNeedle = [
    "\t\tconst opened = {",
    "\t\t\tok: true,",
    "\t\t\tpath: realPath,",
    "\t\t\tfd,",
    "\t\t\tstat: openedStat",
    "\t\t};",
  ].join("\n");

  const openedPathReplacement = [
    "\t\tconst opened = {",
    "\t\t\tok: true,",
    "\t\t\tpath: isElectronAsarVirtualFilePath(params.filePath) ? params.filePath : realPath,",
    "\t\t\tfd,",
    "\t\t\tstat: openedStat",
    "\t\t};",
  ].join("\n");

  if (!alreadyHasHelper) {
    if (!source.includes(preambleNeedle)) {
      return { source, changed: false, reason: "safe-open-preamble-missing" };
    }
    if (!source.includes(preOpenNeedle)) {
      return { source, changed: false, reason: "safe-open-pre-open-missing" };
    }
  }

  let next = source;
  if (!alreadyHasHelper) {
    next = next.replace(preambleNeedle, preambleReplacement);
    next = next.replace(preOpenNeedle, preOpenReplacement);
    if (next.includes(postOpenNeedle)) {
      next = next.replace(postOpenNeedle, postOpenReplacement);
    }
    if (next.includes(sameFileNeedle)) {
      next = next.replace(sameFileNeedle, sameFileReplacement);
    }
  }

  if (next.includes(openedPathNeedle)) {
    next = next.replace(openedPathNeedle, openedPathReplacement);
  }

  return { source: next, changed: next !== source };
}

function patchBoundaryPathSource(source) {
  if (source.includes("isElectronAsarVirtualFilePath")) {
    return { source, changed: false };
  }

  const regionNeedle = "//#region src/infra/boundary-path.ts";
  if (!source.includes(regionNeedle)) {
    return { source, changed: false, reason: "boundary-region-missing" };
  }

  const ancestorSyncNeedle = "function resolvePathViaExistingAncestorSync(targetPath) {";
  const ancestorSyncReplacement = [
    isElectronAsarVirtualFilePathHelperBlock(),
    "function resolvePathViaExistingAncestorSync(targetPath) {",
    "\tif (isElectronAsarVirtualFilePath(targetPath) || /\\.asar$/i.test(path.resolve(targetPath))) {",
    "\t\treturn path.resolve(targetPath);",
    "\t}",
  ].join("\n");

  const ancestorAsyncNeedle = "async function resolvePathViaExistingAncestor(targetPath) {";
  const ancestorAsyncReplacement = [
    "async function resolvePathViaExistingAncestor(targetPath) {",
    "\tif (isElectronAsarVirtualFilePath(targetPath) || /\\.asar$/i.test(path.resolve(targetPath))) {",
    "\t\treturn path.resolve(targetPath);",
    "\t}",
  ].join("\n");

  const isPathInsideNeedle = "function isPathInside(root, target) {";
  const isPathInsideReplacement = [
    "function isPathInside(root, target) {",
    "\tif (isElectronAsarVirtualFilePath(root) || isElectronAsarVirtualFilePath(target) || /\\.asar$/i.test(String(root))) {",
    '\t\tconst rootResolved = path.resolve(root).replace(/\\\\/g, "/");',
    '\t\tconst targetResolved = path.resolve(target).replace(/\\\\/g, "/");',
    '\t\tconst rootBase = rootResolved.match(/^(.+\\.asar)/i)?.[1];',
    '\t\tconst targetBase = targetResolved.match(/^(.+\\.asar)/i)?.[1];',
    "\t\tif (rootBase && targetBase && rootBase.toLowerCase() === targetBase.toLowerCase()) {",
    '\t\t\tconst rootLogical = rootResolved.includes(".asar/") ? rootResolved : `${rootBase}/`;',
    '\t\t\tconst rel = path.relative(rootLogical, targetResolved).replace(/\\\\/g, "/");',
    '\t\t\treturn rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);',
    "\t\t}",
    "\t}",
  ].join("\n");

  if (!source.includes(ancestorSyncNeedle)) {
    return { source, changed: false, reason: "boundary-ancestor-sync-missing" };
  }

  let next = source.replace(regionNeedle, `${regionNeedle}\n${isElectronAsarVirtualFilePathHelperBlock()}`);
  next = next.replace(
    ancestorSyncNeedle,
    ancestorSyncReplacement.replace(`${isElectronAsarVirtualFilePathHelperBlock()}\n`, ""),
  );
  if (next.includes(ancestorAsyncNeedle)) {
    next = next.replace(ancestorAsyncNeedle, ancestorAsyncReplacement);
  }
  if (next.includes(isPathInsideNeedle)) {
    next = next.replace(isPathInsideNeedle, isPathInsideReplacement);
  }
  return { source: next, changed: next !== source };
}

function patchPublicSurfaceLoaderSource(source) {
  if (source.includes("relaxValidationForAsar")) {
    return { source, changed: false };
  }

  const regionNeedle = "//#region src/plugins/public-surface-loader.ts";
  if (!source.includes(regionNeedle)) {
    return { source, changed: false, reason: "public-surface-loader-region-missing" };
  }

  const regionReplacement = `${regionNeedle}\n${isElectronAsarVirtualFilePathHelperBlock()}\nconst relaxValidationForAsar = true;`;

  const validationNeedle =
    "\tif (!sameFileIdentity(validatedStat, fs.statSync(validatedPath))) throw new Error(`Bundled plugin public surface changed after validation: ${params.dirName}/${params.artifactBasename}`);";

  const validationReplacement =
    "\tif (!isElectronAsarVirtualFilePath(validatedPath) && !sameFileIdentity(validatedStat, fs.statSync(validatedPath))) throw new Error(`Bundled plugin public surface changed after validation: ${params.dirName}/${params.artifactBasename}`);";

  if (!source.includes(validationNeedle)) {
    return { source, changed: false, reason: "public-surface-loader-validation-missing" };
  }

  let next = source.replace(regionNeedle, regionReplacement);
  next = next.replace(validationNeedle, validationReplacement);
  return { source: next, changed: next !== source };
}

function patchRootPathSource(source) {
  if (source.includes("isElectronAsarVirtualFilePath(targetPath)")) {
    return { source, changed: false };
  }

  const regionNeedle = "//#region node_modules/@openclaw/fs-safe/dist/root-path.js";
  if (!source.includes(regionNeedle)) {
    return { source, changed: false, reason: "root-path-region-missing" };
  }

  const ancestorSyncNeedle = "function resolvePathViaExistingAncestorSync(targetPath) {";
  const ancestorSyncReplacement = [
    isElectronAsarVirtualFilePathHelperBlock(),
    "function resolvePathViaExistingAncestorSync(targetPath) {",
    "\tif (isElectronAsarVirtualFilePath(targetPath) || /\\.asar$/i.test(path.resolve(targetPath))) {",
    "\t\treturn path.resolve(targetPath);",
    "\t}",
  ].join("\n");

  if (!source.includes(ancestorSyncNeedle)) {
    return { source, changed: false, reason: "root-path-ancestor-sync-missing" };
  }

  let next = source.replace(regionNeedle, `${regionNeedle}\n${isElectronAsarVirtualFilePathHelperBlock()}`);
  next = next.replace(
    ancestorSyncNeedle,
    ancestorSyncReplacement.replace(`${isElectronAsarVirtualFilePathHelperBlock()}\n`, ""),
  );
  return { source: next, changed: next !== source };
}

function patchPathIsInsideSource(source) {
  if (source.includes("isElectronAsarVirtualFilePath(root)")) {
    return { source, changed: false };
  }

  const regionNeedle = "//#region node_modules/@openclaw/fs-safe/dist/path.js";
  if (!source.includes(regionNeedle)) {
    return { source, changed: false, reason: "path-region-missing" };
  }

  const isPathInsideNeedle = "function isPathInside(root, target) {";
  const isPathInsideReplacement = [
    "function isPathInside(root, target) {",
    "\tif (isElectronAsarVirtualFilePath(root) || isElectronAsarVirtualFilePath(target) || /\\.asar$/i.test(String(root))) {",
    '\t\tconst rootResolved = path.resolve(root).replace(/\\\\/g, "/");',
    '\t\tconst targetResolved = path.resolve(target).replace(/\\\\/g, "/");',
    '\t\tconst rootBase = rootResolved.match(/^(.+\\.asar)/i)?.[1];',
    '\t\tconst targetBase = targetResolved.match(/^(.+\\.asar)/i)?.[1];',
    "\t\tif (rootBase && targetBase && rootBase.toLowerCase() === targetBase.toLowerCase()) {",
    '\t\t\tconst rootLogical = rootResolved.includes(".asar/") ? rootResolved : `${rootBase}/`;',
    '\t\t\tconst rel = path.relative(rootLogical, targetResolved).replace(/\\\\/g, "/");',
    '\t\t\treturn rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);',
    "\t\t}",
    "\t}",
  ].join("\n");

  if (!source.includes(isPathInsideNeedle)) {
    return { source, changed: false, reason: "path-isPathInside-missing" };
  }

  let next = source.replace(regionNeedle, `${regionNeedle}\n${isElectronAsarVirtualFilePathHelperBlock()}`);
  next = next.replace(isPathInsideNeedle, isPathInsideReplacement);
  return { source: next, changed: next !== source };
}

function patchChunkSource(source, prefix) {
  if (prefix.startsWith("pinned-open-") || prefix.startsWith("safe-open-sync-")) {
    return patchSafeOpenSyncSource(source);
  }
  if (prefix.startsWith("boundary-path-")) {
    return patchBoundaryPathSource(source);
  }
  if (prefix.startsWith("root-path-")) {
    return patchRootPathSource(source);
  }
  if (prefix.startsWith("path-")) {
    return patchPathIsInsideSource(source);
  }
  return { source, changed: false };
}

function patchOpenclawAsarDist(bundleRootDir) {
  const root = path.resolve(bundleRootDir);
  const distDir = path.join(root, "dist");
  if (!fs.existsSync(normWin(distDir))) {
    return { changed: false, requiredOk: false, patchedFiles: [], reason: "no-dist" };
  }

  const patchedFiles = [];
  let changed = false;
  const foundPrefixes = new Set();

  for (const prefix of [...REQUIRED_PREFIXES, ...OPTIONAL_PREFIXES]) {
    for (const rel of listDistChunkFiles(root, prefix)) {
      foundPrefixes.add(prefix);
      const abs = path.join(root, rel);
      let source = fs.readFileSync(normWin(abs), "utf8");
      const result = patchChunkSource(source, prefix);

      if (result.reason && !result.changed) {
        console.warn(`[openclaw-asar-patch] skip ${rel}: ${result.reason}`);
        patchedFiles.push(rel);
        continue;
      }
      if (result.changed) {
        fs.writeFileSync(normWin(abs), result.source, "utf8");
        patchedFiles.push(rel);
        changed = true;
      } else {
        patchedFiles.push(rel);
      }
    }
  }

  for (const rel of listDistChunkFiles(root, "public-surface-loader-")) {
    const abs = path.join(root, rel);
    const source = fs.readFileSync(normWin(abs), "utf8");
    const result = patchPublicSurfaceLoaderSource(source);
    if (result.changed) {
      fs.writeFileSync(normWin(abs), result.source, "utf8");
      patchedFiles.push(rel);
      changed = true;
    } else if (!result.reason) {
      patchedFiles.push(rel);
    }
  }

  const requiredOk =
    REQUIRED_PREFIXES.every((prefix) => foundPrefixes.has(prefix)) || foundPrefixes.size === 0;
  if (!requiredOk) {
    console.warn(
      `[openclaw-asar-patch] missing required chunks: ${REQUIRED_PREFIXES.filter((p) => !foundPrefixes.has(p)).join(", ")}`,
    );
  }
  return {
    changed,
    requiredOk,
    patchedFiles,
    reason: requiredOk ? undefined : "required-chunks-missing",
  };
}

module.exports = {
  patchOpenclawAsarDist,
  patchSafeOpenSyncSource,
  patchBoundaryPathSource,
  patchRootPathSource,
  patchPathIsInsideSource,
};
