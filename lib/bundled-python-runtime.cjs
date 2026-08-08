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
 * @returns {{ shimDir: string; packageDir: string }}
 */
function ensureWindowsPythonShimDir(app, pythonExe) {
  const runtimeDir = path.join(app.getPath("userData"), "runtime");
  const shimDir = path.join(runtimeDir, "python-shims");
  const packageDir = path.join(runtimeDir, "python-packages");
  fs.mkdirSync(shimDir, { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });

  // Some skills call python3 directly; map it to the bundled python.exe.
  const pythonShimBody = `@echo off\r\n"${pythonExe}" %*\r\n`;
  fs.writeFileSync(path.join(shimDir, "python3.cmd"), pythonShimBody, "utf8");
  fs.writeFileSync(path.join(shimDir, "python3.bat"), pythonShimBody, "utf8");

  // The embeddable Python distribution does not create pip.exe. Keep pip usable
  // from skills and shell tools without relying on a system Python installation.
  const pipShimBody = `@echo off\r\n"${pythonExe}" -m pip %*\r\n`;
  fs.writeFileSync(path.join(shimDir, "pip.cmd"), pipShimBody, "utf8");
  fs.writeFileSync(path.join(shimDir, "pip.bat"), pipShimBody, "utf8");
  fs.writeFileSync(path.join(shimDir, "pip3.cmd"), pipShimBody, "utf8");
  fs.writeFileSync(path.join(shimDir, "pip3.bat"), pipShimBody, "utf8");
  return { shimDir, packageDir };
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
 *   packageDir?: string;
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

  const { shimDir, packageDir } = ensureWindowsPythonShimDir(opts.app, pythonExe);
  const scriptsDir = path.join(runtimeRoot, "Scripts");
  const pathEntries = [shimDir, runtimeRoot];
  if (fs.existsSync(scriptsDir)) pathEntries.push(scriptsDir);

  const existingPath = String(process.env.PATH || "");
  process.env.PATH = dedupePath([...pathEntries, ...existingPath.split(path.delimiter)]);
  process.env.OPEN_STUDIO_BUNDLED_PYTHON = pythonExe;
  process.env.OPEN_STUDIO_BUNDLED_PYTHON_ROOT = runtimeRoot;
  process.env.OPEN_STUDIO_PYTHON_PACKAGES = packageDir;
  // Keep pip installs writable: the packaged resources directory is read-only.
  process.env.PIP_TARGET = packageDir;

  log.info?.("[python_runtime] bundled python enabled", {
    runtimeRoot,
    pythonExe,
    shimDir,
    packageDir,
  });

  return { ok: true, enabled: true, runtimeRoot, pythonExe, shimDir, packageDir, pathEntries };
}

module.exports = {
  enableBundledPythonRuntime,
};
