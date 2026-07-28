/**
 * bundle-openclaw.mjs
 *
 * Bundles openclaw + transitive runtime dependencies into build/openclaw/
 * for electron-builder extraResources and hybrid openclaw.asar packing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { patchOpenclawAsarDist } = require("./openclaw-asar-patch.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "build", "openclaw");
const OUTPUT_NM = path.join(OUTPUT, "node_modules");
const OPENCLAW_SRC = path.join(ROOT, "node_modules", "openclaw");
const ROOT_NM = path.join(ROOT, "node_modules");
const PNPM_STORE = path.join(ROOT_NM, ".pnpm");

const SKIP_PACKAGES = new Set(["typescript", "@playwright/test", "@discordjs/opus"]);
const SKIP_SCOPES = ["@cloudflare/", "@types/"];
const FORCE_INCLUDE_PACKAGES = ["kysely", "chalk"];
const SKIP_OPENCLAW_ROOT_DIRS = new Set(["docs", "src"]);

function normWin(p) {
  if (process.platform !== "win32") return p;
  if (p.startsWith("\\\\?\\")) return p;
  return `\\\\?\\${p.replace(/\//g, "\\")}`;
}

function listSearchRoots() {
  // Prefer OpenClaw's own dependency tree first; falling back to app root can pull
  // incompatible majors (e.g. chalk@4 instead of chalk@5) and break runtime ESM imports.
  return [path.join(OPENCLAW_SRC, "node_modules"), ROOT_NM];
}

function readPackageVersionSafe(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    return String(pkg.version || "").trim();
  } catch {
    return "";
  }
}

function parseMajor(version) {
  const m = /^(\d+)/.exec(String(version || "").trim());
  return m ? Number(m[1]) : 0;
}

function collectPnpmStoreCandidates(pkgName) {
  if (!fs.existsSync(PNPM_STORE)) return [];
  const parts = pkgName.split("/");
  /** @type {string[]} */
  const out = [];
  let ents = [];
  try {
    ents = fs.readdirSync(PNPM_STORE, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(PNPM_STORE, ent.name, "node_modules", ...parts);
    if (fs.existsSync(path.join(candidate, "package.json"))) out.push(candidate);
  }
  return out;
}

function resolvePackageDir(pkgName) {
  /** @type {string[]} */
  const candidates = [];
  for (const base of listSearchRoots()) {
    const candidate = path.join(base, ...pkgName.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) candidates.push(candidate);
  }
  candidates.push(...collectPnpmStoreCandidates(pkgName));
  if (candidates.length === 0) return null;

  const uniq = [...new Set(candidates.map((p) => fs.realpathSync.native?.(p) || fs.realpathSync(p)))];
  uniq.sort((a, b) => {
    const va = readPackageVersionSafe(a);
    const vb = readPackageVersionSafe(b);
    return parseMajor(vb) - parseMajor(va);
  });
  return uniq[0] || null;
}

function readDepNames(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const names = new Set();
    for (const section of ["dependencies", "optionalDependencies"]) {
      for (const name of Object.keys(pkg[section] ?? {})) names.add(name);
    }
    return [...names];
  } catch {
    return [];
  }
}

function shouldSkipPackage(name) {
  return SKIP_PACKAGES.has(name) || SKIP_SCOPES.some((s) => name.startsWith(s));
}

function collectTransitiveDeps() {
  const collected = new Map();
  const queue = ["openclaw", ...FORCE_INCLUDE_PACKAGES];

  while (queue.length > 0) {
    const name = queue.shift();
    if (shouldSkipPackage(name)) continue;

    const pkgDir = resolvePackageDir(name);
    if (!pkgDir) continue;

    let realPath;
    try {
      realPath = fs.realpathSync(pkgDir);
    } catch {
      continue;
    }

    if (collected.has(realPath)) continue;
    collected.set(realPath, name);

    for (const dep of readDepNames(pkgDir)) {
      if (!collected.has(dep)) queue.push(dep);
    }
  }

  return collected;
}

function resolveRealDir(dir) {
  try {
    return fs.realpathSync.native?.(dir) || fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function copyOpenClawRoot() {
  if (fs.existsSync(normWin(OUTPUT))) {
    fs.rmSync(normWin(OUTPUT), { recursive: true, force: true });
  }

  const src = resolveRealDir(OPENCLAW_SRC);
  // Do not mkdir OUTPUT first — on Windows, cpSync from a pnpm junction into an
  // empty pre-created folder throws "Cannot overwrite directory with non-directory".
  fs.cpSync(normWin(src), normWin(OUTPUT), {
    recursive: true,
    dereference: true,
    filter: (srcPath) => {
      const rel = path.relative(src, srcPath);
      if (rel === "node_modules" || rel.startsWith(`node_modules${path.sep}`)) return false;
      const first = rel.split(path.sep)[0];
      if (SKIP_OPENCLAW_ROOT_DIRS.has(first)) return false;
      if (srcPath.endsWith(".ts") && !srcPath.endsWith(".d.ts")) {
        const compiledSibling = srcPath.slice(0, -3) + ".js";
        if (fs.existsSync(compiledSibling)) return false;
      }
      return true;
    },
  });
}

function copyFlattenedDeps(collected) {
  fs.mkdirSync(normWin(OUTPUT_NM), { recursive: true });
  let copied = 0;

  for (const [realPath, pkgName] of collected) {
    if (pkgName === "openclaw") continue;
    const dest = path.join(OUTPUT_NM, pkgName);
    const destParent = path.dirname(dest);
    fs.mkdirSync(normWin(destParent), { recursive: true });
    if (fs.existsSync(normWin(dest))) {
      fs.rmSync(normWin(dest), { recursive: true, force: true });
    }
    const src = resolveRealDir(realPath);
    fs.cpSync(normWin(src), normWin(dest), { recursive: true, dereference: true });
    copied++;
  }

  return copied;
}

async function main() {
  console.log("[bundle-openclaw] bundling openclaw for electron-builder...");

  if (!fs.existsSync(OPENCLAW_SRC)) {
    console.error("[bundle-openclaw] node_modules/openclaw not found — run npm install first");
    process.exit(1);
  }

  const collected = collectTransitiveDeps();
  console.log(`[bundle-openclaw] discovered ${collected.size} packages (direct + transitive)`);

  copyOpenClawRoot();
  const copied = copyFlattenedDeps(collected);
  console.log(`[bundle-openclaw] copied ${copied} dependency packages to build/openclaw/node_modules`);

  const chalkPkgPath = path.join(OUTPUT_NM, "chalk", "package.json");
  if (!fs.existsSync(chalkPkgPath)) {
    console.error("[bundle-openclaw] missing chalk in bundled openclaw runtime");
    process.exit(1);
  }
  try {
    const chalkVer = String(JSON.parse(fs.readFileSync(chalkPkgPath, "utf8"))?.version ?? "");
    if (parseMajor(chalkVer) < 5) {
      console.error(`[bundle-openclaw] incompatible chalk version in bundle: ${chalkVer} (need >=5)`);
      process.exit(1);
    }
    console.log(`[bundle-openclaw] chalk runtime pinned: ${chalkVer}`);
  } catch (err) {
    console.error("[bundle-openclaw] failed to read bundled chalk version:", err?.message ?? err);
    process.exit(1);
  }

  const patchResult = patchOpenclawAsarDist(OUTPUT);
  if (patchResult.changed) {
    console.log(`[bundle-openclaw] patched ASAR dist chunks: ${patchResult.patchedFiles.join(", ")}`);
  } else if (patchResult.patchedFiles.length > 0) {
    console.log(`[bundle-openclaw] ASAR dist chunks unchanged (${patchResult.patchedFiles.join(", ")})`);
  } else {
    console.warn(
      `[bundle-openclaw] no ASAR dist chunks patched (${patchResult.reason ?? "openclaw version may use different dist layout"})`,
    );
  }
  if (!patchResult.requiredOk) {
    console.error("[bundle-openclaw] required ASAR dist patches missing — gateway will fail in packaged builds");
    process.exit(1);
  }

  const entryExists = fs.existsSync(path.join(OUTPUT, "openclaw.mjs"));
  let distMainRel = "dist/index.js";
  try {
    const ocPkg = JSON.parse(fs.readFileSync(path.join(OUTPUT, "package.json"), "utf8"));
    if (typeof ocPkg.main === "string" && ocPkg.main) {
      distMainRel = ocPkg.main.replace(/^\.\//, "");
    }
  } catch {
    /* fallback */
  }
  const distExists = fs.existsSync(path.join(OUTPUT, distMainRel));

  console.log(`[bundle-openclaw] bundle complete: ${OUTPUT}`);
  console.log(`[bundle-openclaw] openclaw.mjs: ${entryExists ? "ok" : "missing"}`);
  console.log(`[bundle-openclaw] ${distMainRel}: ${distExists ? "ok" : "missing"}`);

  if (!entryExists || !distExists) {
    console.error("[bundle-openclaw] bundle verification failed");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[bundle-openclaw] failed:", err?.message ?? err);
  process.exit(1);
});
