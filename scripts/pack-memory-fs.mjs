/**
 * Create node_modules.zip (STORE mode) + node_modules.unpacked for memory-fs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStoreZipFromDirectory } from "./store-zip-writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OPENCLAW_DIR = path.join(ROOT, "build", "openclaw");
const NODE_MODULES = path.join(OPENCLAW_DIR, "node_modules");
const OUTPUT_ZIP = path.join(OPENCLAW_DIR, "node_modules.zip");
const UNPACKED_DIR = path.join(OPENCLAW_DIR, "node_modules.unpacked");

console.log("[pack-memory-fs] packing node_modules for memory-fs...");

if (!fs.existsSync(NODE_MODULES)) {
  console.error("[pack-memory-fs] build/openclaw/node_modules not found — run bundle-openclaw first");
  process.exit(1);
}

const nativeModules = [];

function collectNativeModules(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectNativeModules(fullPath);
    } else if (entry.name.endsWith(".node")) {
      const isWin32X64 =
        fullPath.includes("win32-x64") ||
        fullPath.includes("win32_x64") ||
        fullPath.includes("windows-x64") ||
        (fullPath.includes("win32") && fullPath.includes("x64")) ||
        (fullPath.includes("msvc") && fullPath.includes("x64"));
      const isArm64 = fullPath.includes("arm64");
      if (isWin32X64 && !isArm64) nativeModules.push(fullPath);
    }
  }
}

collectNativeModules(NODE_MODULES);
console.log(`[pack-memory-fs] found ${nativeModules.length} Windows x64 native modules`);

fs.rmSync(UNPACKED_DIR, { recursive: true, force: true });
fs.mkdirSync(UNPACKED_DIR, { recursive: true });
for (const nativePath of nativeModules) {
  const relPath = path.relative(NODE_MODULES, nativePath);
  const destPath = path.join(UNPACKED_DIR, relPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(nativePath, destPath);
}

if (fs.existsSync(OUTPUT_ZIP)) fs.rmSync(OUTPUT_ZIP);

/** @type {Set<string>} */
const nativeRelPaths = new Set(nativeModules.map((p) => path.relative(NODE_MODULES, p).split(path.sep).join("/")));

let packed = false;

if (process.platform === "win32") {
  try {
    execFileSync("7z", ["--help"], { stdio: "ignore" });
    console.log("[pack-memory-fs] using 7z (STORE mode)...");
    execFileSync(
      "7z",
      ["a", "-tzip", "-mx=0", OUTPUT_ZIP, path.join(NODE_MODULES, "*")],
      { stdio: "inherit" },
    );
    packed = fs.existsSync(OUTPUT_ZIP);
  } catch {
    /* fall through to built-in writer */
  }
}

if (!packed) {
  console.log("[pack-memory-fs] using built-in STORE zip writer...");
  const started = Date.now();
  const result = await createStoreZipFromDirectory(NODE_MODULES, OUTPUT_ZIP, {
    shouldInclude: (rel) => !rel.endsWith(".node") && !nativeRelPaths.has(rel),
  });
  const ms = Date.now() - started;
  console.log(`[pack-memory-fs] packed ${result.files} files in ${Math.round(ms / 1000)}s`);
  packed = true;
}

if (!fs.existsSync(OUTPUT_ZIP)) {
  console.error("[pack-memory-fs] failed to create node_modules.zip");
  process.exit(1);
}

console.log(`[pack-memory-fs] created ${OUTPUT_ZIP} (${Math.round(fs.statSync(OUTPUT_ZIP).size / 1024 / 1024)} MB)`);
