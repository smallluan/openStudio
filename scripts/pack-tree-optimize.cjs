"use strict";

const {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("fs");
const { join } = require("path");
const { normWin } = require("./win-fs-retry.cjs");

const ARCH_MAP = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const DEFAULT_SKIP_DIR_NAMES = new Set([
  ".git",
  "build",
  "release",
  "scripts",
  "src",
  "tmp-pack",
  "vendor",
]);

const PRUNE_TOP_LEVEL_PACKAGES = new Set([
  "typescript",
  "playwright-core",
  "@playwright/test",
]);

function resolveArch(archEnum) {
  return ARCH_MAP[archEnum] || "x64";
}

function cleanupUnnecessaryFiles(dir, skipDirNames = null) {
  let removedCount = 0;
  const skipDirs = skipDirNames || null;
  const REMOVE_DIRS = new Set(["test", "tests", "__tests__", ".github", "examples", "example"]);
  const REMOVE_FILE_EXTS = [".d.ts", ".d.ts.map", ".d.mts", ".d.cts", ".js.map", ".mjs.map", ".ts.map"];
  const REMOVE_FILE_NAMES = new Set([
    ".DS_Store",
    "README.md",
    "CHANGELOG.md",
    "LICENSE.md",
    "tsconfig.json",
    ".npmignore",
  ]);

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs && skipDirs.has(entry.name) && currentDir === dir) continue;
        if (REMOVE_DIRS.has(entry.name)) {
          try {
            rmSync(fullPath, { recursive: true, force: true });
            removedCount++;
          } catch {
            /* ignore */
          }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some((ext) => name.endsWith(ext))) {
          try {
            rmSync(fullPath, { force: true });
            removedCount++;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

function parseNativeArtifactInfo(fileName) {
  const match = fileName.match(
    /(?:^|[.-])(darwin|mac|linux(?:musl)?|win32|windows|android)[.-](x64|arm64|arm|ia32|universal|x64-msvc|arm64-msvc)(?=[.-]|$)/,
  );
  if (!match) return null;
  const platformAliases = { mac: "darwin", windows: "win32" };
  return {
    platform: platformAliases[match[1]] || match[1],
    arch: match[2].split("-")[0],
  };
}

function nativeArtifactMatchesTarget(pkgPlatform, pkgArch, platform, arch) {
  return pkgPlatform === platform && (pkgArch === arch || pkgArch === "universal");
}

function cleanupPlatformSpecificArtifactsRecursive(rootDir, platform, arch) {
  let removed = 0;
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir || !existsSync(currentDir)) continue;

    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const dirNativeInfo = parseNativeArtifactInfo(entry.name);
        if (dirNativeInfo && !nativeArtifactMatchesTarget(dirNativeInfo.platform, dirNativeInfo.arch, platform, arch)) {
          try {
            rmSync(fullPath, { recursive: true, force: true });
            removed++;
          } catch {
            /* ignore */
          }
          continue;
        }
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".node")) continue;
      const nativeInfo = parseNativeArtifactInfo(entry.name);
      if (!nativeInfo) continue;
      if (!nativeArtifactMatchesTarget(nativeInfo.platform, nativeInfo.arch, platform, arch)) {
        try {
          rmSync(fullPath, { force: true });
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
  }

  return removed;
}

function patchAllLruCacheInstancesUnderRoot(rootDir) {
  let lruCount = 0;
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(normWin(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      let isDirectory = entry.isDirectory();
      if (!isDirectory) {
        try {
          isDirectory = statSync(normWin(fullPath)).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (!isDirectory) continue;
      if (entry.name === "lru-cache") {
        const pkgPath = join(fullPath, "package.json");
        if (!existsSync(normWin(pkgPath))) {
          stack.push(fullPath);
          continue;
        }
        try {
          const pkg = JSON.parse(readFileSync(normWin(pkgPath), "utf8"));
          if (pkg.type === "module") continue;
          const mainFile = pkg.main || "index.js";
          const entryFile = join(fullPath, mainFile);
          if (!existsSync(normWin(entryFile))) continue;
          const original = readFileSync(normWin(entryFile), "utf8");
          if (!original.includes("exports.LRUCache")) {
            const patched = [
              original,
              "",
              "// Open Studio patch: add LRUCache named export for Node.js 22+ ESM interop",
              "if (typeof module.exports === 'function' && !module.exports.LRUCache) {",
              "  module.exports.LRUCache = module.exports;",
              "}",
              "",
            ].join("\n");
            writeFileSync(normWin(entryFile), patched, "utf8");
            lruCount++;
          }
        } catch {
          /* ignore */
        }
      } else {
        stack.push(fullPath);
      }
    }
  }
  return lruCount;
}

function prunePackagingArtifacts(rootDir) {
  let removed = 0;
  try {
    for (const name of readdirSync(normWin(rootDir), { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      if (!/^tmp-eb-/i.test(name.name)) continue;
      try {
        rmSync(join(rootDir, name.name), { recursive: true, force: true });
        removed++;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const nodeModules = join(rootDir, "node_modules");
  if (existsSync(normWin(nodeModules))) {
    for (const pkgName of PRUNE_TOP_LEVEL_PACKAGES) {
      const pkgDir = join(nodeModules, pkgName);
      if (!existsSync(normWin(pkgDir))) continue;
      try {
        rmSync(pkgDir, { recursive: true, force: true });
        removed++;
      } catch {
        /* ignore */
      }
    }
  }

  return removed;
}

function optimizeTreeForPack(rootDir, platform, arch, { skipDirNames = DEFAULT_SKIP_DIR_NAMES } = {}) {
  let changeCount = prunePackagingArtifacts(rootDir);
  changeCount += patchAllLruCacheInstancesUnderRoot(rootDir);
  changeCount += cleanupUnnecessaryFiles(rootDir, skipDirNames);

  const nodeModules = join(rootDir, "node_modules");
  if (existsSync(normWin(nodeModules))) {
    changeCount += cleanupPlatformSpecificArtifactsRecursive(nodeModules, platform, arch);
  }

  return changeCount;
}

module.exports = {
  ARCH_MAP,
  DEFAULT_SKIP_DIR_NAMES,
  resolveArch,
  cleanupUnnecessaryFiles,
  cleanupPlatformSpecificArtifactsRecursive,
  patchAllLruCacheInstancesUnderRoot,
  optimizeTreeForPack,
};
