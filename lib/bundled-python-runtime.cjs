const fs = require("fs");
const path = require("path");

/**
 * @returns {boolean}
 */
function isPackagedApp() {
  return typeof process.resourcesPath === "string" && !!process.resourcesPath && !process.defaultApp;
}

/**
 * @param {string | undefined} p
 * @returns {string}
 */
function normalizePathEntry(p) {
  return path.normalize(String(p || "").trim().toLowerCase());
}

/**
 * @param {string[]} entries
 * @returns {string}
 */
function dedupePath(entries) {
  const out = [];
  const seen = new Set();
  for (const raw of entries) {
    const val = String(raw || "").trim();
    if (!val) continue;
    const key = normalizePathEntry(val);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(val);
  }
  return out.join(path.delimiter);
}

/**
 * @param {string} resourcesPath
 * @returns {string}
 */
function resolveBundledPythonRoot(resourcesPath) {
  const dir = path.join(resourcesPath, "python-runtime");
  return fs.existsSync(dir) ? dir : "";
}

/**
 * @param {string} runtimeRoot
 * @returns {string}
 */
function resolveBundledPythonExe(runtimeRoot) {
  const candidates = [
    path.join(runtimeRoot, "python.exe"),
    path.join(runtimeRoot, "bin", "python3.exe"),
    path.join(runtimeRoot, "bin", "python.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

/**
 * @param {import('electron').App} app
 * @param {string} pythonExe
 * @returns {string}
 */
function ensureWindowsPythonShimDir(app, pythonExe) {
  const shimDir = path.join(app.getPath("userData"), "runtime", "python-shims");
  fs.mkdirSync(shimDir, { recursive: true });

  // Some skills call python3 directly; map it to the bundled python.exe.
  const shimBody = `@echo off\r\n"${pythonExe}" %*\r\n`;
  fs.writeFileSync(path.join(shimDir, "python3.cmd"), shimBody, "utf8");
  fs.writeFileSync(path.join(shimDir, "python3.bat"), shimBody, "utf8");
  return shimDir;
}

/**
 * @param {{ app: import('electron').App; log?: { info?: Function; warn?: Function } }} opts
 * @returns {{
 *   ok: boolean;
 *   enabled: boolean;
 *   reason?: string;
 *   runtimeRoot?: string;
 *   pythonExe?: string;
 *   shimDir?: string;
 *   pathEntries?: string[];
 * }}
 */
function enableBundledPythonRuntime(opts) {
  const log = opts.log ?? console;
  if (process.platform !== "win32") {
    return { ok: true, enabled: false, reason: "platform_not_win32" };
  }
  if (!isPackagedApp()) {
    return { ok: true, enabled: false, reason: "not_packaged_app" };
  }

  const runtimeRoot = resolveBundledPythonRoot(process.resourcesPath);
  if (!runtimeRoot) {
    return { ok: true, enabled: false, reason: "python_runtime_not_found" };
  }

  const pythonExe = resolveBundledPythonExe(runtimeRoot);
  if (!pythonExe) {
    return { ok: false, enabled: false, reason: "python_exe_not_found", runtimeRoot };
  }

  const shimDir = ensureWindowsPythonShimDir(opts.app, pythonExe);
  const scriptsDir = path.join(runtimeRoot, "Scripts");
  const pathEntries = [shimDir, runtimeRoot];
  if (fs.existsSync(scriptsDir)) pathEntries.push(scriptsDir);

  const existingPath = String(process.env.PATH || "");
  process.env.PATH = dedupePath([...pathEntries, ...existingPath.split(path.delimiter)]);
  process.env.OPEN_STUDIO_BUNDLED_PYTHON = pythonExe;
  process.env.OPEN_STUDIO_BUNDLED_PYTHON_ROOT = runtimeRoot;

  log.info?.("[python_runtime] bundled python enabled", {
    runtimeRoot,
    pythonExe,
    shimDir,
  });

  return { ok: true, enabled: true, runtimeRoot, pythonExe, shimDir, pathEntries };
}

module.exports = {
  enableBundledPythonRuntime,
};
