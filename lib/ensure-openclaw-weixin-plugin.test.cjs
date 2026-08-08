/**
 * Regression tests for WeChat QR login peer/runtime dependency repair.
 *
 * Run: node --test lib/ensure-openclaw-weixin-plugin.test.cjs
 */
"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ensureWeixinPluginOpenClawPeerDep,
  findWeixinPluginRoot,
  DEV_STATE_DIR,
  __test: {
    CRITICAL_OPENCLAW_RUNTIME_DEPS,
    depExistsInNodeModules,
    findMissingCriticalOpenClawRuntimeDeps,
    canResolveOpenClawPeerDep,
    resolveOpenClawPeerPackageRoot,
  },
} = require("./ensure-openclaw-weixin-plugin.cjs");
const { resolveOpenClawPackageRootSync } = require("./openclaw-bundle-paths.cjs");

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/** @returns {string} */
function mkTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * @param {string} dir
 * @param {string} rel
 * @param {string} contents
 */
function writeFile(dir, rel, contents) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
}

/** @param {string} openclawRoot @param {string} depName @param {string} version */
function writeNestedOpenClawDep(openclawRoot, depName, version) {
  writeFile(
    openclawRoot,
    path.join("node_modules", ...depName.split("/"), "package.json"),
    `${JSON.stringify({ name: depName, version })}\n`,
  );
}

/**
 * Minimal plugin npm project: openclaw SDK resolves but critical runtime deps may be absent.
 *
 * @param {{ withNestedJson5?: boolean; withProjectJson5?: boolean }} [opts]
 */
function createPartialWeixinNpmProject(opts = {}) {
  const projectRoot = mkTempDir("open-studio-weixin-npm-");
  const openclawRoot = path.join(projectRoot, "node_modules", "openclaw");
  const bundledOpenClawRoot = resolveOpenClawPackageRootSync();
  assert.ok(bundledOpenClawRoot, "studio openclaw package required for fixture specs");
  const bundledPkg = JSON.parse(fs.readFileSync(path.join(bundledOpenClawRoot, "package.json"), "utf8"));

  writeFile(
    openclawRoot,
    "package.json",
    `${JSON.stringify(
      {
        name: "openclaw",
        version: bundledPkg.version ?? "2026.6.1",
        dependencies: bundledPkg.dependencies ?? {},
        exports: {
          "./plugin-sdk/account-id": "./dist/plugin-sdk/account-id.js",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFile(openclawRoot, "dist/plugin-sdk/account-id.js", "module.exports = {};\n");

  if (opts.withNestedJson5) {
    writeFile(openclawRoot, "node_modules/json5/package.json", `${JSON.stringify({ name: "json5", version: "2.2.3" })}\n`);
  }
  if (opts.withProjectJson5) {
    writeFile(projectRoot, "node_modules/json5/package.json", `${JSON.stringify({ name: "json5", version: "2.2.3" })}\n`);
  }

  writeFile(
    projectRoot,
    "node_modules/@tencent-weixin/openclaw-weixin/package.json",
    `${JSON.stringify({ name: "@tencent-weixin/openclaw-weixin", version: "0.0.0-test" })}\n`,
  );
  writeFile(
    projectRoot,
    "node_modules/@tencent-weixin/openclaw-weixin/dist/src/auth/login-qr.js",
    "export async function startWeixinLoginWithQr() { return {}; }\n",
  );

  return { projectRoot, openclawRoot, bundledOpenClawRoot };
}

/** @param {string} projectRoot */
function createWeixinStateDir(projectRoot) {
  const stateDir = mkTempDir("open-studio-weixin-state-");
  const projectName = path.basename(projectRoot);
  const dest = path.join(stateDir, "npm", "projects", projectName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(projectRoot, dest, { recursive: true });
  return stateDir;
}

describe("depExistsInNodeModules", () => {
  it("detects unscoped packages", () => {
    const root = mkTempDir("open-studio-weixin-deps-");
    writeFile(root, "json5/package.json", `${JSON.stringify({ name: "json5" })}\n`);
    assert.equal(depExistsInNodeModules(root, "json5"), true);
    assert.equal(depExistsInNodeModules(root, "missing-pkg"), false);
  });

  it("detects scoped packages", () => {
    const root = mkTempDir("open-studio-weixin-deps-");
    writeFile(root, "@scope/pkg/package.json", `${JSON.stringify({ name: "@scope/pkg" })}\n`);
    assert.equal(depExistsInNodeModules(root, "@scope/pkg"), true);
  });
});

describe("findMissingCriticalOpenClawRuntimeDeps", () => {
  it("lists json5/yaml/zod when openclaw SDK exists but runtime deps are absent", () => {
    const { projectRoot, bundledOpenClawRoot } = createPartialWeixinNpmProject();
    assert.equal(canResolveOpenClawPeerDep(projectRoot), true);

    const missing = findMissingCriticalOpenClawRuntimeDeps(projectRoot, bundledOpenClawRoot);
    const names = missing.map((row) => row.name);

    assert.ok(names.includes("json5"), "json5 must be reported missing for partial peer install");
    for (const dep of CRITICAL_OPENCLAW_RUNTIME_DEPS) {
      assert.ok(names.includes(dep), `expected critical dep ${dep} in missing list`);
    }
  });

  it("does not false-positive on non-critical packages like clawpdf", () => {
    const { projectRoot, bundledOpenClawRoot } = createPartialWeixinNpmProject();
    writeFile(
      path.join(projectRoot, "node_modules", "openclaw"),
      "node_modules/clawpdf/package.json",
      `${JSON.stringify({ name: "clawpdf", version: "0.3.0" })}\n`,
    );

    const missing = findMissingCriticalOpenClawRuntimeDeps(projectRoot, bundledOpenClawRoot);
    assert.ok(!missing.some((row) => row.name === "clawpdf"));
  });

  it("accepts json5 nested under openclaw/node_modules", () => {
    const { projectRoot, bundledOpenClawRoot } = createPartialWeixinNpmProject({ withNestedJson5: true });
    const missing = findMissingCriticalOpenClawRuntimeDeps(projectRoot, bundledOpenClawRoot);
    assert.ok(!missing.some((row) => row.name === "json5"));
  });

  it("accepts json5 hoisted to plugin project node_modules", () => {
    const { projectRoot, bundledOpenClawRoot } = createPartialWeixinNpmProject({ withProjectJson5: true });
    const missing = findMissingCriticalOpenClawRuntimeDeps(projectRoot, bundledOpenClawRoot);
    assert.ok(!missing.some((row) => row.name === "json5"));
  });
});

describe("resolveOpenClawPeerPackageRoot", () => {
  it("walks from plugin-sdk entry to openclaw package root", () => {
    const { projectRoot, openclawRoot } = createPartialWeixinNpmProject();
    assert.equal(resolveOpenClawPeerPackageRoot(projectRoot), openclawRoot);
  });
});

describe("ensureWeixinPluginOpenClawPeerDep", () => {
  it("returns plugin_missing when state dir has no weixin plugin", () => {
    const stateDir = mkTempDir("open-studio-weixin-empty-state-");
    const result = ensureWeixinPluginOpenClawPeerDep(stateDir, { quiet: true });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "plugin_missing");
  });

  it("does not fail when SDK resolves and all critical runtime deps are present", () => {
    const { projectRoot, openclawRoot, bundledOpenClawRoot } = createPartialWeixinNpmProject({
      withNestedJson5: true,
    });
    const bundledPkg = JSON.parse(fs.readFileSync(path.join(bundledOpenClawRoot, "package.json"), "utf8"));
    for (const dep of CRITICAL_OPENCLAW_RUNTIME_DEPS) {
      if (dep === "json5") continue;
      const spec = String(bundledPkg.dependencies?.[dep] ?? dep);
      writeNestedOpenClawDep(openclawRoot, dep, spec);
    }

    const stateDir = createWeixinStateDir(projectRoot);
    const result = ensureWeixinPluginOpenClawPeerDep(stateDir, { quiet: true });
    assert.equal(result.ok, true, result.message ?? "expected peer/runtime check to pass");
    assert.equal(result.skipped, "present");
  });
});

describe("integration: local dev state (optional)", () => {
  it("repairs ~/.openclaw-dev weixin plugin peer/runtime deps when plugin is installed", { skip: !findWeixinPluginRoot(DEV_STATE_DIR) }, () => {
    const result = ensureWeixinPluginOpenClawPeerDep(DEV_STATE_DIR, { quiet: true });
    assert.equal(result.ok, true, result.message ?? "peer/runtime repair failed");
  });
});
