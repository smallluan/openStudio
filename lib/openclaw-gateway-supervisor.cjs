/**
 * Spawn a bundled OpenClaw gateway on loopback when Studio points at localhost and probe fails.
 * Packaged app → :19001 + isolated %APPDATA%/open-studio/openclaw-state.
 * Dev (`pnpm dev`) → :19002 + OpenClaw `--dev` (~/.openclaw-dev).
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { pathToFileURL } = require("url");
const { gatewayDiagFromUserCfg, getStudioLog } = require("./studio-logger.cjs");
const {
  gatewayPortUsesDevCli,
  resolvePackagedOpenClawStateDir,
  getStudioUserDataDir,
  PACKAGED_GATEWAY_PORT,
} = require("./openclaw-runtime-profile.cjs");
const { ensureDevGatewayAuthToken } = require("./sync-openclaw-agent-from-studio.cjs");
const {
  preferAsarUnpackedPath,
  resolveOpenClawPackageJsonPath,
  buildOpenClawCliNodePath,
  enumerateOpenClawSearchRoots,
  resolveOpenClawPackageRootSync,
  resolveOpenClawAsarBootstrapPath,
  resolvePackagedOpenClawRoot,
  resolveWindowsOpenClawProcessCwd,
  isAsarArchivePath,
  hasHybridOpenClawAsarLayout,
} = require("./openclaw-bundle-paths.cjs");
const {
  ensureWindowsOpenClawRuntime,
} = require("./openclaw-windows-runtime-bootstrap.cjs");
const { resolveWindowsBundledExtensionsRoot } = require("./win-bundled-resources.cjs");

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let ownedGatewayChild = /** @type {any} */ (null);
/** True when Studio started gateway with {@link teardownOwnedGateway} responsibility. */
let ownsGatewayLifecycle = false;
/** When Studio spawned the gateway; used for warmup guard before first chat.send. */
let gatewaySpawnedAtMs = /** @type {number | null} */ (null);

const GATEWAY_WARMUP_MIN_MS = 3000;

/** @returns {boolean} */
function isPackagedApp() {
  return typeof process.resourcesPath === "string" && !!process.resourcesPath && !process.defaultApp;
}

/** @returns {boolean} */
function shouldUseMemoryFs() {
  if (process.platform !== "win32" || !isPackagedApp()) return false;
  const zip = path.join(process.resourcesPath, "node_modules.zip");
  const memoryFsOnly = fs.existsSync(path.join(process.resourcesPath, "openclaw-memory-fs.json"));
  if (memoryFsOnly && !fs.existsSync(zip)) {
    throw new Error("packaged_openclaw_memory_fs_zip_missing");
  }
  if (memoryFsOnly) return true;
  if (process.env.OPEN_STUDIO_DISABLE_MEMORY_FS === "1") return false;
  return fs.existsSync(zip);
}

/**
 * @param {string} openClawRoot
 * @returns {Record<string, string>}
 */
function buildMemoryFsEnv(openClawRoot) {
  const resourcesPath = process.resourcesPath;
  return {
    MEMORY_FS_ZIP: path.join(resourcesPath, "node_modules.zip"),
    MEMORY_FS_MOUNT: path.join(openClawRoot, "node_modules"),
    MEMORY_FS_UNPACKED: path.join(resourcesPath, "node_modules.unpacked"),
  };
}

/** @returns {string[]} */
function buildMemoryFsImportArgs() {
  const registerPath = path.join(process.resourcesPath, "gateway", "memory-fs", "register.mjs");
  // Node's ESM loader on Windows expects file:// for absolute paths passed via --import.
  return ["--import", pathToFileURL(registerPath).href];
}

/**
 * Parse local gateway spawn target from studio user config (HTTP loopback only).
 * @param {unknown} cfg
 * @returns {{ port: number; useDevCli: boolean; normalizedBase: string } | null}
 */
function parseBundledGatewayTarget(cfg) {
  const diag = gatewayDiagFromUserCfg(cfg);
  const raw = diag.gatewayBaseUrl;
  if (!raw) return null;

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }

  /** Packaged gateways are expected to expose HTTP WS; avoid guessing TLS or port 443. */
  if (u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  if (!isLoopbackHost(host)) return null;

  if (!u.port) return null;

  const portNum = Number.parseInt(u.port, 10);
  if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) return null;

  const useDevCli = gatewayPortUsesDevCli(portNum);
  return {
    port: portNum,
    useDevCli,
    normalizedBase: `${u.protocol}//${u.hostname}:${u.port}`,
  };
}

/** @param {string} hostname */
function isLoopbackHost(hostname) {
  const h = hostname.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/** @returns {Promise<{ ok?: boolean; skipped?: string; spawned?: boolean; message?: string }>} */
async function ensureLocalGatewayRunning(getCfgFn, deps) {
  const log = deps.log ?? getStudioLog();
  /** @type {typeof import("./openclaw-gateway-stream.cjs").probeOpenClawGateway} */
  const probe = deps.probeOpenClawGateway;

  const cfg0 = getCfgFn();
  const tgt = parseBundledGatewayTarget(cfg0);
  if (!tgt) {
    log.verbose?.("[gateway_supervisor] skip: not_HTTP_loopback_with_explicit_port", gatewayDiagFromUserCfg(cfg0));
    return { skipped: "not_local_managed_http_gateway" };
  }

  log.info("[gateway_supervisor] bundled target", {
    port: tgt.port,
    useDevCli: tgt.useDevCli,
    normalizedBase: tgt.normalizedBase,
    diag: gatewayDiagFromUserCfg(cfg0),
  });

  try {
    await probe(cfg0);
    log.info("[gateway_supervisor] probe ok; reuse existing gateway", { port: tgt.port });
    return { ok: true, spawned: false };
  } catch (e) {
    log.warn("[gateway_supervisor] initial probe failed; will try spawn", {
      port: tgt.port,
      message: /** @type {any} */ (e)?.message ?? String(e ?? ""),
    });
  }

  /** @type {string | null} */
  let runtimeRootOverride = null;
  /** @type {string | null} */
  let processCwdOverride = null;
  const isPackagedWin = process.platform === "win32" && isPackagedApp();
  if (isPackagedWin) {
    const preferHybrid =
      process.env.OPEN_STUDIO_WINDOWS_OPENCLAW_ASAR !== "0" &&
      hasHybridOpenClawAsarLayout(process.resourcesPath);

    if (preferHybrid) {
      runtimeRootOverride = resolvePackagedOpenClawRoot();
      if (runtimeRootOverride) {
        processCwdOverride = resolveWindowsOpenClawProcessCwd(process.resourcesPath, runtimeRootOverride);
        log.info("[gateway_supervisor] using hybrid openclaw.asar layout", {
          runtimeRoot: runtimeRootOverride,
          cwd: processCwdOverride,
        });
      }
    }

    if (!runtimeRootOverride) {
      const boot = await ensureWindowsOpenClawRuntime({ log });
      if (!boot.ok || !boot.runtimeRoot) {
        const msg = boot.message || boot.skipped || "openclaw_runtime_bootstrap_failed";
        log.error("[gateway_supervisor] windows openclaw runtime bootstrap failed", {
          message: msg,
          asarPath: boot.asarPath ?? "",
        });
        return { ok: false, message: msg };
      }
      runtimeRootOverride = boot.runtimeRoot;
      log.info("[gateway_supervisor] using extracted windows openclaw runtime (fallback)", {
        runtimeRoot: runtimeRootOverride,
        bundleVersion: boot.identity?.version ?? "",
        extracted: !!boot.extracted,
        cached: !!boot.cached,
      });
    }
  }

  const cliResolved = resolveOpenClawCliPath(runtimeRootOverride);
  if (!cliResolved) {
    log.error("[gateway_supervisor] could not resolve openclaw/openclaw.mjs in app bundle");
    return { ok: false, message: "openclaw_cli_not_found_in_bundle" };
  }

  teardownOwnedGateway("respawn_prepare");

  /** @type {string[]} */
  const args = [];
  if (tgt.useDevCli) args.push("--dev");
  args.push("gateway", "run", "--bind", "loopback", "--port", String(tgt.port), "--force");

  const useMemoryFs = shouldUseMemoryFs();
  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    NODE_PATH: buildNodePathForRuntime(runtimeRootOverride),
    OPEN_STUDIO_LEAN_CHAT_TOOLS: process.env.OPEN_STUDIO_LEAN_CHAT_TOOLS ?? "1",
    OPEN_STUDIO_SIDEBAR_TOOL_URL:
      process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL ??
      (process.env.NODE_ENV === "development"
        ? "http://127.0.0.1:19112"
        : "http://127.0.0.1:19111"),
    OPEN_STUDIO_SIDEBAR_TOOL_TOKEN:
      process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN ??
      (process.env.NODE_ENV === "development"
        ? "open-studio-local-sidebar-action-dev"
        : "open-studio-local-sidebar-action"),
    /** Parallel spawn + sessions_yield barrier (see patch-openclaw-sessions-spawn-await.mjs). */
    OPEN_STUDIO_SUBAGENT_AWAIT: process.env.OPEN_STUDIO_SUBAGENT_AWAIT ?? "1",
  };

  if (useMemoryFs && runtimeRootOverride) {
    Object.assign(childEnv, buildMemoryFsEnv(runtimeRootOverride));
  }

  if (tgt.port === PACKAGED_GATEWAY_PORT) {
    const packagedStateDir = resolvePackagedOpenClawStateDir(getStudioUserDataDir());
    fs.mkdirSync(packagedStateDir, { recursive: true });
    ensureDevGatewayAuthToken(packagedStateDir);
    childEnv.OPENCLAW_STATE_DIR = packagedStateDir;
  }

  if (isPackagedWin && runtimeRootOverride && typeof process.resourcesPath === "string") {
    const bundledExtensionsDir = resolveWindowsBundledExtensionsRoot(process.resourcesPath, runtimeRootOverride);
    if (bundledExtensionsDir && fs.existsSync(bundledExtensionsDir)) {
      childEnv.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledExtensionsDir;
    }
  }

  /** @type {string} */
  const cliPath = cliResolved;

  const cwdDir =
    processCwdOverride ??
    (cliPath.endsWith("openclaw-asar-bootstrap.mjs")
      ? typeof process.resourcesPath === "string" && process.resourcesPath.length > 0
        ? process.resourcesPath
        : path.join(__dirname, "..")
      : path.dirname(cliPath));

  /** @type {string[]} */
  const spawnArgs = [];
  if (useMemoryFs) spawnArgs.push(...buildMemoryFsImportArgs());
  spawnArgs.push(cliPath, ...args);

  log.info("[gateway_supervisor] spawning openclaw", {
    execPath: process.execPath,
    cliPath,
    cwd: cwdDir,
    args,
    useDevCli: tgt.useDevCli,
    memoryFs: useMemoryFs,
    NODE_PATH: childEnv.NODE_PATH,
  });

  const child = spawn(process.execPath, spawnArgs, {
    cwd: cwdDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  ownedGatewayChild = child;
  ownsGatewayLifecycle = true;

  attachChildLogStream(child.stdout, "[gateway:out]");
  attachChildLogStream(child.stderr, "[gateway:err]");

  child.on("error", (err) => {
    log.error("[gateway_supervisor] child error", /** @type {any} */ (err)?.message ?? err);
  });

  child.on("exit", (code, sig) => {
    if (ownedGatewayChild === child) {
      ownedGatewayChild = null;
      ownsGatewayLifecycle = false;
    }
    log.warn("[gateway_supervisor] gateway process exited", { code, signal: sig });
  });

  const ready = /** @type {const} */ ({
    retries: tgt.useDevCli ? 120 : 90,
    gapMs: 1000,
  });

  /** @returns {unknown} */
  const readCfgFresh = () => getCfgFn();

  for (let i = 0; i < ready.retries; i++) {
    await sleep(i === 0 ? 400 : ready.gapMs);
    /** Process ended before readiness. */
    if (child.exitCode !== null || child.signalCode !== null) {
      log.error("[gateway_supervisor] gateway process died before probe succeeded", {
        exitCode: child.exitCode,
        signal: child.signalCode,
      });
      break;
    }

    try {
      await probe(readCfgFresh());
      gatewaySpawnedAtMs = Date.now();
      log.info("[gateway_supervisor] probe ok after spawn", { attempt: i + 1 });
      return { ok: true, spawned: true };
    } catch (e) {
      log.verbose?.("[gateway_supervisor] post-spawn probe pending", {
        attempt: i + 1,
        message: /** @type {any} */ (e)?.message ?? String(e ?? ""),
      });
    }
  }

  const msg =
    "[gateway_supervisor] gateway never became reachable after supervised spawn " +
    `(after ~${Math.round((ready.retries * ready.gapMs) / 1000)}s)`;
  log.error(msg);
  return { ok: false, message: msg };
}

/**
 * @param {ReturnType<import('child_process').ChildProcess['stdout']>} stream
 * @param {string} prefix
 */
function attachChildLogStream(stream, prefix) {
  const log = getStudioLog();
  /** Gateway stderr is actionable in production installs; stdout stays verbose-only. */
  const emitLine =
    prefix === "[gateway:err]" ? /** @type {(msg: string) => void} */ (m) => log.warn(prefix, m) : (m) => log.verbose(prefix, m);
  try {
    if (!stream) return;
    const rl = readline.createInterface({
      /** @type {any} */
      input: stream,
    });
    rl.on("line", (line) => {
      const s = String(line ?? "").trim();
      if (!s) return;
      emitLine(s.slice(0, 8000));
    });
  } catch {
    stream?.on?.("data", (buf) => {
      const chunk = Buffer.isBuffer(buf) ? buf.toString("utf8").slice(0, 4000) : String(buf).slice(0, 4000);
      emitLine(chunk);
    });
  }
}

/**
 * Extend bundled NODE_PATH with a runtime extraction root if available.
 * @param {string | null} runtimeRootOverride
 * @returns {string}
 */
function buildNodePathForRuntime(runtimeRootOverride) {
  const base = String(buildOpenClawCliNodePath(runtimeRootOverride) ?? "");
  if (!runtimeRootOverride) return base;
  const runtimeNodeModules = path.join(runtimeRootOverride, "node_modules");
  const pieces = [base, runtimeNodeModules].filter((s) => typeof s === "string" && s.trim());
  const dedup = [];
  const seen = new Set();
  for (const p of pieces.join(path.delimiter).split(path.delimiter)) {
    const n = path.normalize(String(p).trim());
    if (!n || seen.has(n)) continue;
    seen.add(n);
    dedup.push(n);
  }
  return dedup.join(path.delimiter);
}

/** @returns {string | null} OpenClaw package directory (filesystem path). */
function resolveBundledOpenClawPackageRootSync(preferredRoot = null) {
  const log = getStudioLog();
  if (preferredRoot && typeof preferredRoot === "string") {
    const preferredPkg = path.join(preferredRoot, "package.json");
    if (fs.existsSync(preferredPkg)) return preferredRoot;
  }
  const root = resolveOpenClawPackageRootSync();
  if (root) return root;
  for (const searchRoot of enumerateOpenClawSearchRoots()) {
    const pkgPath = preferAsarUnpackedPath(path.join(searchRoot, "node_modules", "openclaw", "package.json"));
    if (fs.existsSync(pkgPath)) return path.dirname(pkgPath);
    log.verbose?.("[gateway_supervisor] openclaw package.json missing", { searchRoot, pkgPath });
  }
  return null;
}

/**
 * Read bundled OpenClaw `package.json` for diagnostics (IPC dev panel).
 * @returns {{ version: string; root: string; cliEntry: string } | null}
 */
function resolveBundledOpenClawPackageMetaSync() {
  const root = resolveBundledOpenClawPackageRootSync();
  if (!root) return null;
  try {
    const pkgPath = resolveOpenClawPackageJsonPath(root);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const binEntry =
      pkg.bin && typeof pkg.bin.openclaw === "string"
        ? pkg.bin.openclaw.replace(/^\.\//, "")
        : "openclaw.mjs";
    const cliEntry = path.join(root, binEntry);
    return { version: String(pkg.version ?? ""), root, cliEntry };
  } catch {
    return null;
  }
}

/** @returns {string | null} */
function resolveOpenClawCliPath(preferredRoot = null) {
  const log = getStudioLog();
  const bootstrap = resolveOpenClawAsarBootstrapPath();
  if (bootstrap && preferredRoot && isAsarArchivePath(preferredRoot)) {
    log.info("[gateway_supervisor] using asar bootstrap CLI for hybrid openclaw.asar", {
      bootstrap,
      preferredRoot,
    });
    return bootstrap;
  }
  if (bootstrap && typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    const hybridRoot = resolvePackagedOpenClawRoot();
    if (hybridRoot && isAsarArchivePath(hybridRoot)) {
      log.info("[gateway_supervisor] using asar bootstrap CLI for packaged openclaw.asar", { bootstrap });
      return bootstrap;
    }
    const packagedEntry = preferAsarUnpackedPath(
      path.join(process.resourcesPath, "app.asar", "node_modules", "openclaw", "dist", "entry.js"),
    );
    if (fs.existsSync(packagedEntry)) {
      log.info("[gateway_supervisor] using asar bootstrap CLI", { bootstrap, packagedEntry });
      return bootstrap;
    }
  }

  const root = resolveBundledOpenClawPackageRootSync(preferredRoot);
  if (!root) {
    log.error("[gateway_supervisor] openclaw package dir not found under node_modules");
    return null;
  }
  const cliRaw = path.join(root, "openclaw.mjs");
  const resolved = preferAsarUnpackedPath(cliRaw);
  if (!fs.existsSync(resolved)) {
    log.error("[gateway_supervisor] openclaw.mjs missing", { root, resolved });
    return null;
  }
  if (resolved !== cliRaw) log.info("[gateway_supervisor] using asar-unpacked openclaw CLI", { resolved });
  return resolved;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} reason */
function teardownOwnedGateway(reason) {
  const log = getStudioLog();
  if (!ownedGatewayChild || !ownsGatewayLifecycle) return;
  /** @type {any} */
  const proc = ownedGatewayChild;
  const pid = proc.pid;

  try {
    if (process.platform === "win32" && typeof pid === "number") {
      try {
        spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", `taskkill /PID ${pid} /T /F`],
          { stdio: "ignore", windowsHide: true },
        );
      } catch {
        proc.kill?.();
      }
      log.verbose?.("[gateway_supervisor] requested Windows taskkill chain", { reason, pid });
    } else {
      proc.kill("SIGTERM");
      log.verbose?.("[gateway_supervisor] requested SIGTERM", { reason, pid });
    }
  } catch {
    try {
      proc.kill?.();
    } catch {
      /* ignore */
    }
  }

  ownedGatewayChild = null;
  ownsGatewayLifecycle = false;
}

/**
 * @param {import('electron').App} app
 */
function attachGatewayQuitHandlers(app) {
  app.on("before-quit", () => {
    teardownOwnedGateway("before-quit");
  });
  app.on("will-quit", () => {
    teardownOwnedGateway("will-quit");
  });
}

/**
 * Wait until supervised gateway has been connected long enough for first chat.send.
 * @param {() => unknown} getCfgFn
 * @param {{ probeOpenClawGateway?: typeof import("./openclaw-gateway-stream.cjs").probeOpenClawGateway }} [deps]
 */
async function waitForGatewayWarmupIfNeeded(getCfgFn, deps = {}) {
  const log = getStudioLog();
  if (!gatewaySpawnedAtMs) return { skipped: "not_supervised_spawn" };

  const elapsed = Date.now() - gatewaySpawnedAtMs;
  const probe = deps.probeOpenClawGateway ?? require("./openclaw-gateway-stream.cjs").probeOpenClawGateway;

  try {
    await probe(getCfgFn());
    log.info("[chat.send.perf] gateway warmup guard ok", {
      connectedForMs: elapsed,
      waitMs: 0,
      early: true,
    });
    return { ok: true, waitMs: 0, early: true };
  } catch (firstProbeErr) {
    const waitMs = Math.max(0, GATEWAY_WARMUP_MIN_MS - elapsed);
    if (waitMs > 0) {
      log.info("[gateway_supervisor] gateway warmup guard waiting", { waitMs, connectedForMs: elapsed });
      await sleep(waitMs);
    }
    try {
      await probe(getCfgFn());
      log.info("[chat.send.perf] gateway warmup guard ok", {
        connectedForMs: Date.now() - gatewaySpawnedAtMs,
        waitMs,
      });
      return { ok: true, waitMs };
    } catch (e) {
      log.warn("[gateway_supervisor] warmup probe failed", {
        firstProbe: /** @type {any} */ (firstProbeErr)?.message ?? String(firstProbeErr ?? ""),
        message: /** @type {any} */ (e)?.message ?? String(e ?? ""),
      });
      return { ok: false, waitMs };
    }
  }
}

/** Coalesce parallel `provisionAgent` restarts into one sweep (or two if more arrive mid-flight). */
/** @type {Promise<unknown> | null} */
let restartOwnedGatewayInflight = null;
let restartOwnedGatewayPending = false;

/**
 * Restart the supervised local gateway so `openclaw.json` agent registry changes take effect.
 * @param {() => unknown} getCfgFn
 * @param {{ probeOpenClawGateway: (cfg: unknown) => Promise<unknown> }} deps
 */
async function restartOwnedGateway(getCfgFn, deps) {
  if (restartOwnedGatewayInflight) {
    restartOwnedGatewayPending = true;
    return restartOwnedGatewayInflight;
  }

  const log = getStudioLog();
  const execute = async () => {
    let rounds = 0;
    /** @type {unknown} */
    let result;
    do {
      restartOwnedGatewayPending = false;
      rounds += 1;
      invalidateGatewaySessionFromSupervisor();
      teardownOwnedGateway("agents_registry_changed");
      gatewaySpawnedAtMs = 0;
      result = await ensureLocalGatewayRunning(getCfgFn, deps);
      log.info("[gateway_supervisor] restarted after agent registry change", {
        ok: Boolean(/** @type {any} */ (result)?.ok),
        spawned: Boolean(/** @type {any} */ (result)?.spawned),
        round: rounds,
      });
    } while (restartOwnedGatewayPending);
    return result;
  };

  restartOwnedGatewayInflight = execute().finally(() => {
    restartOwnedGatewayInflight = null;
  });
  return restartOwnedGatewayInflight;
}

/** Clears WS pool in session module without importing the full session graph here. */
function invalidateGatewaySessionFromSupervisor() {
  try {
    const { invalidateGatewaySession, clearGatewaySessionPrepCache } = require("./openclaw-gateway-session.cjs");
    invalidateGatewaySession();
    clearGatewaySessionPrepCache?.();
  } catch {
    /* ignore */
  }
}

module.exports = {
  parseBundledGatewayTarget,
  ensureLocalGatewayRunning,
  waitForGatewayWarmupIfNeeded,
  attachGatewayQuitHandlers,
  restartOwnedGateway,
  teardownOwnedGateway,
  teardownOwnedGatewayForTests: teardownOwnedGateway,
  resolveBundledOpenClawPackageMetaSync,
};
