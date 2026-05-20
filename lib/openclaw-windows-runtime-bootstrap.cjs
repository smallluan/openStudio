const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const LOCK_STALE_MS = 5 * 60 * 1000;
const LOCK_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const LOCK_WAIT_SLICE_MS = 250;
const KEEP_RUNTIME_VERSIONS = 2;
const READY_MARKER = ".openclaw-runtime-ready.json";
const REQUIRED_RUNTIME_FILES = ["openclaw.mjs", "package.json", path.join("dist", "extensions")];

/** @returns {import('electron').App} */
function getElectronApp() {
  // Lazy require so non-electron contexts can still import this module safely.
  // eslint-disable-next-line global-require
  const { app } = require("electron");
  return app;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {void}
 */
function rmRf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  } catch {
    /* noop */
  }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} asarPath
 * @returns {{ version: string; size: number; mtimeMs: number; key: string }}
 */
function readBundleIdentity(asarPath) {
  const stat = fs.statSync(asarPath);
  let version = "unknown";
  try {
    const pkgRaw = asar.extractFile(asarPath, "package.json");
    const pkg = JSON.parse(String(pkgRaw));
    if (pkg && typeof pkg.version === "string" && pkg.version.trim()) version = pkg.version.trim();
  } catch {
    /* fallback to unknown */
  }
  const key = `${version}-${stat.size}-${Math.trunc(stat.mtimeMs)}`;
  return { version, size: stat.size, mtimeMs: stat.mtimeMs, key };
}

/**
 * @returns {string | null}
 */
function resolveBundledAsarPath() {
  if (process.platform !== "win32") return null;
  if (!process.resourcesPath) return null;
  const bundled = path.join(process.resourcesPath, "openclaw.asar");
  return safeExists(bundled) ? bundled : null;
}

/**
 * @returns {string}
 */
function resolveRuntimeCacheRoot() {
  const app = getElectronApp();
  return path.join(app.getPath("userData"), "runtime", "openclaw", "bundles");
}

/**
 * @param {string} runtimeRoot
 * @param {{ key: string; version: string; size: number; mtimeMs: number }} identity
 * @returns {boolean}
 */
function isReadyRuntime(runtimeRoot, identity) {
  for (const rel of REQUIRED_RUNTIME_FILES) {
    if (!safeExists(path.join(runtimeRoot, rel))) return false;
  }
  const markerPath = path.join(runtimeRoot, READY_MARKER);
  if (!safeExists(markerPath)) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return String(marker?.bundleKey ?? "") === identity.key;
  } catch {
    return false;
  }
}

/**
 * @param {string} lockPath
 * @returns {boolean}
 */
function isStaleLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const createdAtMs = Number(parsed?.createdAtMs ?? 0);
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return true;
    return Date.now() - createdAtMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/**
 * @param {string} lockPath
 * @param {{ pid: number; createdAtMs: number }} payload
 */
function createLock(lockPath, payload) {
  const fd = fs.openSync(lockPath, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(payload), "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} cacheRoot
 * @param {{ key: string; version: string }} identity
 * @returns {string}
 */
function resolveRuntimeRoot(cacheRoot, identity) {
  const safeVersion = identity.version.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(cacheRoot, `${safeVersion}-${identity.key}`);
}

/**
 * @param {string} cacheRoot
 * @param {string} keepRoot
 */
function pruneOldRuntimeRoots(cacheRoot, keepRoot) {
  if (!safeExists(cacheRoot)) return;
  const keepSet = new Set([path.normalize(keepRoot)]);
  /** @type {Array<{ full: string; mtimeMs: number }>} */
  const candidates = [];
  for (const ent of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const full = path.join(cacheRoot, ent.name);
    const marker = path.join(full, READY_MARKER);
    if (!safeExists(marker)) continue;
    const norm = path.normalize(full);
    if (keepSet.has(norm)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(marker).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    candidates.push({ full, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (let i = KEEP_RUNTIME_VERSIONS - 1; i < candidates.length; i++) {
    rmRf(candidates[i].full);
  }
}

/**
 * @param {{ log?: { info?: Function; warn?: Function; error?: Function; verbose?: Function } }} [opts]
 * @returns {Promise<{ ok: boolean; skipped?: string; extracted?: boolean; cached?: boolean; runtimeRoot?: string; asarPath?: string; identity?: { version: string; size: number; mtimeMs: number; key: string }; message?: string }>}
 */
async function ensureWindowsOpenClawRuntime(opts = {}) {
  const log = opts.log ?? console;
  const asarPath = resolveBundledAsarPath();
  if (!asarPath) return { ok: false, skipped: "openclaw_asar_missing" };

  log.info?.("[openclaw_runtime] bundle_detected", { asarPath });

  const identity = readBundleIdentity(asarPath);
  const cacheRoot = resolveRuntimeCacheRoot();
  const runtimeRoot = resolveRuntimeRoot(cacheRoot, identity);
  const lockPath = path.join(cacheRoot, ".extract.lock");

  fs.mkdirSync(cacheRoot, { recursive: true });

  if (isReadyRuntime(runtimeRoot, identity)) {
    log.info?.("[openclaw_runtime] extract_skipped_cached", { runtimeRoot, bundleKey: identity.key });
    pruneOldRuntimeRoots(cacheRoot, runtimeRoot);
    return { ok: true, cached: true, runtimeRoot, asarPath, identity };
  }

  const waitStart = Date.now();
  while (true) {
    try {
      createLock(lockPath, { pid: process.pid, createdAtMs: Date.now() });
      break;
    } catch {
      if (!safeExists(lockPath)) continue;
      if (isStaleLock(lockPath)) {
        rmRf(lockPath);
        continue;
      }
      if (Date.now() - waitStart > LOCK_WAIT_TIMEOUT_MS) {
        return { ok: false, message: "timed_out_waiting_openclaw_extract_lock", asarPath, identity };
      }
      await sleep(LOCK_WAIT_SLICE_MS);
    }
  }

  try {
    if (isReadyRuntime(runtimeRoot, identity)) {
      log.info?.("[openclaw_runtime] extract_skipped_cached", { runtimeRoot, bundleKey: identity.key });
      pruneOldRuntimeRoots(cacheRoot, runtimeRoot);
      return { ok: true, cached: true, runtimeRoot, asarPath, identity };
    }

    const tmpRoot = `${runtimeRoot}.tmp-${process.pid}-${Date.now()}`;
    rmRf(tmpRoot);
    fs.mkdirSync(tmpRoot, { recursive: true });

    log.info?.("[openclaw_runtime] extract_started", { asarPath, tmpRoot, runtimeRoot });
    asar.extractAll(asarPath, tmpRoot);

    for (const rel of REQUIRED_RUNTIME_FILES) {
      if (!safeExists(path.join(tmpRoot, rel))) {
        rmRf(tmpRoot);
        return {
          ok: false,
          message: `openclaw_runtime_missing_required_file:${rel}`,
          asarPath,
          identity,
        };
      }
    }

    fs.writeFileSync(
      path.join(tmpRoot, READY_MARKER),
      `${JSON.stringify(
        {
          bundleKey: identity.key,
          bundleVersion: identity.version,
          bundleSize: identity.size,
          bundleMtimeMs: identity.mtimeMs,
          extractedAt: new Date().toISOString(),
          extractorPid: process.pid,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    rmRf(runtimeRoot);
    fs.renameSync(tmpRoot, runtimeRoot);
    pruneOldRuntimeRoots(cacheRoot, runtimeRoot);

    log.info?.("[openclaw_runtime] extract_done", { runtimeRoot, bundleKey: identity.key });
    return { ok: true, extracted: true, runtimeRoot, asarPath, identity };
  } catch (err) {
    log.error?.("[openclaw_runtime] extract_failed", String(err?.message ?? err));
    return { ok: false, message: String(err?.message ?? err), asarPath, identity };
  } finally {
    rmRf(lockPath);
  }
}

/**
 * Read an already-extracted runtime root synchronously (no extraction).
 * @returns {string | null}
 */
function resolveExistingWindowsOpenClawRuntimeRootSync() {
  const asarPath = resolveBundledAsarPath();
  if (!asarPath) return null;
  let identity;
  try {
    identity = readBundleIdentity(asarPath);
  } catch {
    return null;
  }
  const runtimeRoot = resolveRuntimeRoot(resolveRuntimeCacheRoot(), identity);
  return isReadyRuntime(runtimeRoot, identity) ? runtimeRoot : null;
}

module.exports = {
  ensureWindowsOpenClawRuntime,
  resolveExistingWindowsOpenClawRuntimeRootSync,
};
