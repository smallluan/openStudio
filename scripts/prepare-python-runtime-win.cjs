"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "build", "python-runtime");
const defaultVendorDir = path.join(root, "vendor", "python-runtime-win");

/**
 * @param {string} p
 */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function existsDir(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function existsFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @returns {string}
 */
function resolveSourceDir() {
  return defaultVendorDir;
}

/**
 * @param {string} sourceDir
 */
function validateSourceRuntime(sourceDir) {
  const py = path.join(sourceDir, "python.exe");
  if (!existsFile(py)) {
    throw new Error(
      `[prepare-python-runtime-win] python.exe not found in "${sourceDir}". ` +
        "Set OPEN_STUDIO_PYTHON_RUNTIME_DIR to a valid embeddable Python runtime directory.",
    );
  }
  const pip = path.join(sourceDir, "Lib", "site-packages", "pip", "__init__.py");
  if (!existsFile(pip)) {
    throw new Error(
      `[prepare-python-runtime-win] pip is missing in "${sourceDir}". ` +
        "The bundled runtime must include Lib/site-packages/pip.",
    );
  }
}

function main() {
  if (process.platform !== "win32") {
    console.log("[prepare-python-runtime-win] skipped (platform is not win32)");
    return;
  }

  if (process.env.OPEN_STUDIO_SKIP_BUNDLED_PYTHON === "1") {
    console.log("[prepare-python-runtime-win] skipped by OPEN_STUDIO_SKIP_BUNDLED_PYTHON=1");
    return;
  }

  const fromEnv = String(process.env.OPEN_STUDIO_PYTHON_RUNTIME_DIR || "").trim();
  const sourceDir = fromEnv ? path.resolve(fromEnv) : resolveSourceDir();
  if (fromEnv) {
    console.warn(
      `[prepare-python-runtime-win] using OPEN_STUDIO_PYTHON_RUNTIME_DIR override: "${sourceDir}"`,
    );
  } else {
    console.log(`[prepare-python-runtime-win] using pinned repo runtime: "${sourceDir}"`);
  }

  if (!existsDir(sourceDir)) {
    throw new Error(
      `[prepare-python-runtime-win] source runtime dir not found: "${sourceDir}". ` +
        "Place runtime under vendor/python-runtime-win, or explicitly set OPEN_STUDIO_PYTHON_RUNTIME_DIR for testing.",
    );
  }
  validateSourceRuntime(sourceDir);

  ensureDir(path.join(root, "build"));
  if (existsDir(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, outDir, { recursive: true });

  const py = path.join(outDir, "python.exe");
  if (!existsFile(py)) {
    throw new Error("[prepare-python-runtime-win] copy completed but build/python-runtime/python.exe is missing");
  }

  console.log(`[prepare-python-runtime-win] ready: ${path.relative(root, outDir)}`);
}

main();
