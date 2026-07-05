const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveOpenClawStateDir, parseAgentIdFromSessionKey } = require("./sync-openclaw-agent-from-studio.cjs");

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "release",
  ".cursor",
  "vendor",
  "tmp",
  "tmp-pack",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
]);

const MAX_SEARCH_RESULTS = 60;
const MAX_SEARCH_FILES = 4000;

/**
 * @param {string} dir
 * @returns {string | null}
 */
function findGitRoot(dir) {
  let cur = path.resolve(dir);
  for (let i = 0; i < 32; i += 1) {
    const gitPath = path.join(cur, ".git");
    try {
      if (fs.existsSync(gitPath)) return cur;
    } catch {
      /* ignore */
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function runGit(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  if (r.error) return { ok: false, message: String(r.error.message ?? r.error) };
  if (r.status !== 0) {
    const msg = String(r.stderr ?? r.stdout ?? "").trim() || "git_failed";
    return { ok: false, message: msg };
  }
  return { ok: true, stdout: String(r.stdout ?? "").trim() };
}

/**
 * @param {string} root
 * @returns {{ ok: true; isRepo: false } | { ok: true; isRepo: true; branch: string; branches: string[] } | { ok: false; message: string }}
 */
function getGitContext(root) {
  const gitRoot = findGitRoot(root);
  if (!gitRoot) return { ok: true, isRepo: false };

  const branchRes = runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchRes.ok) return { ok: false, message: branchRes.message };

  const listRes = runGit(gitRoot, ["branch", "--all", "--format=%(refname:short)"]);
  if (!listRes.ok) return { ok: false, message: listRes.message };

  /** @type {Set<string>} */
  const branches = new Set();
  for (const line of listRes.stdout.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const name = raw.replace(/^remotes\/origin\//, "").replace(/^origin\//, "");
    if (!name || name === "HEAD") continue;
    branches.add(name);
  }

  const current = branchRes.stdout.trim() || "HEAD";
  branches.add(current);

  return {
    ok: true,
    isRepo: true,
    gitRoot,
    branch: current,
    branches: [...branches].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
  };
}

/**
 * @param {string} root
 * @param {string} branch
 */
function checkoutGitBranch(root, branch) {
  const gitRoot = findGitRoot(root);
  if (!gitRoot) return { ok: false, message: "not_git_repo" };
  const name = String(branch ?? "").trim();
  if (!name) return { ok: false, message: "empty_branch" };
  const res = runGit(gitRoot, ["checkout", name]);
  if (!res.ok) return { ok: false, message: res.message };
  const ctx = getGitContext(gitRoot);
  if (!ctx.ok) return ctx;
  return { ok: true, git: ctx };
}

/**
 * @param {string} p
 */
function pathBasenameLabel(p) {
  const base = path.basename(String(p ?? "").replace(/[\\/]+$/, ""));
  return base || String(p ?? "");
}

/**
 * Resolve the active workspace root: explicit user pick, else OpenClaw agent workspace.
 *
 * @param {{ openclaw?: { gatewayBaseUrl?: string; sessionKey?: string } }} cfg
 * @param {string} [userRoot]
 */
function resolveWorkspaceRoot(cfg, userRoot) {
  const picked = String(userRoot ?? "").trim();
  if (picked) {
    try {
      const rp = fs.realpathSync.native ? fs.realpathSync.native(picked) : fs.realpathSync(picked);
      const st = fs.statSync(rp);
      if (st.isDirectory()) return rp;
    } catch {
      /* fall through */
    }
  }

  const gatewayBaseUrl = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
  if (gatewayBaseUrl) {
    const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
    const agentId = parseAgentIdFromSessionKey(cfg?.openclaw?.sessionKey) || "default";
    const ws = path.join(stateDir, "agents", agentId, "workspace");
    try {
      if (fs.existsSync(ws) && fs.statSync(ws).isDirectory()) return path.resolve(ws);
    } catch {
      /* ignore */
    }
  }

  return process.cwd();
}

/**
 * @param {{ openclaw?: { gatewayBaseUrl?: string; sessionKey?: string } }} cfg
 * @param {string} [userRoot]
 */
function getWorkspaceContext(cfg, userRoot) {
  const root = resolveWorkspaceRoot(cfg, userRoot);
  const gitResult = getGitContext(root);
  const git =
    gitResult.ok === true
      ? gitResult
      : { ok: true, isRepo: false };
  return {
    ok: true,
    root,
    label: pathBasenameLabel(root),
    git,
  };
}

/**
 * @param {string} root
 * @param {string} query
 * @param {number} [limit]
 */
function searchWorkspaceFiles(root, query, limit = MAX_SEARCH_RESULTS) {
  const rootResolved = path.resolve(root);
  const q = String(query ?? "").trim().toLowerCase();
  /** @type {Array<{ path: string; name: string; rel: string; score: number }>} */
  const hits = [];
  let scanned = 0;

  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (scanned >= MAX_SEARCH_FILES || hits.length >= limit * 4 || depth > 8) return;
    /** @type {import("fs").Dirent[]} */
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (scanned >= MAX_SEARCH_FILES || hits.length >= limit * 4) return;
      const name = ent.name;
      if (!name || name === "." || name === "..") continue;
      if (ent.isDirectory() && SKIP_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      scanned += 1;
      const rel = path.relative(rootResolved, full).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (!q || name.toLowerCase().includes(q) || rel.toLowerCase().includes(q)) {
          hits.push({ path: full, name, rel, score: name.toLowerCase().startsWith(q) ? 0 : 2 });
        }
        walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!q || name.toLowerCase().includes(q) || rel.toLowerCase().includes(q)) {
        let score = 3;
        const nl = name.toLowerCase();
        if (nl === q) score = 0;
        else if (nl.startsWith(q)) score = 1;
        else if (nl.includes(q)) score = 2;
        hits.push({ path: full, name, rel, score });
      }
    }
  }

  walk(rootResolved, 0);
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      a.rel.split("/").length - b.rel.split("/").length ||
      a.rel.localeCompare(b.rel, undefined, { sensitivity: "base" }),
  );
  return {
    ok: true,
    entries: hits.slice(0, limit).map(({ path: p, name, rel }) => ({ path: p, name, rel })),
  };
}

/**
 * @param {string} root
 * @param {string} [query]
 */
function filterGitBranches(root, query) {
  const ctx = getGitContext(root);
  if (!ctx.ok) return ctx;
  if (!ctx.isRepo) return { ok: true, isRepo: false, branches: [] };
  const q = String(query ?? "").trim().toLowerCase();
  const branches = q
    ? ctx.branches.filter((b) => b.toLowerCase().includes(q))
    : ctx.branches;
  return {
    ok: true,
    isRepo: true,
    branch: ctx.branch,
    branches,
  };
}

const README_CANDIDATES = ["README.md", "Readme.md", "readme.md", "README", "README.txt"];
const MAX_README_CHARS = 2400;
const MAX_TOP_LEVEL = 36;

/**
 * Summarize a user-selected project folder for Chat Lab system prompt injection.
 *
 * @param {string} root
 */
function describeWorkspaceProject(root) {
  const rootResolved = path.resolve(String(root ?? "").trim());
  if (!rootResolved) return { ok: false, message: "empty_path" };

  let st;
  try {
    st = fs.statSync(rootResolved);
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e ?? "stat_failed") };
  }
  if (!st.isDirectory()) return { ok: false, message: "not_a_directory" };

  const git = getGitContext(rootResolved);
  if (!git.ok) return git;

  /** @type {Array<{ name: string; kind: "file" | "dir" }>} */
  const topLevel = [];
  try {
    const ents = fs.readdirSync(rootResolved, { withFileTypes: true });
    ents.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    for (const ent of ents) {
      if (topLevel.length >= MAX_TOP_LEVEL) break;
      if (!ent.name || ent.name === "." || ent.name === "..") continue;
      if (ent.name.startsWith(".")) continue;
      if (ent.isDirectory()) {
        topLevel.push({ name: `${ent.name}/`, kind: "dir" });
      } else if (ent.isFile()) {
        topLevel.push({ name: ent.name, kind: "file" });
      }
    }
  } catch {
    /* ignore listing errors */
  }

  /** @type {string | null} */
  let readmeExcerpt = null;
  for (const name of README_CANDIDATES) {
    const p = path.join(rootResolved, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
      const raw = fs.readFileSync(p, "utf8");
      const text = String(raw ?? "").trim();
      if (text) {
        readmeExcerpt = text.length > MAX_README_CHARS ? `${text.slice(0, MAX_README_CHARS)}\n…` : text;
        break;
      }
    } catch {
      /* try next */
    }
  }

  /** @type {string | null} */
  let packageName = null;
  /** @type {string | null} */
  let packageDescription = null;
  const pkgPath = path.join(rootResolved, "package.json");
  try {
    if (fs.statSync(pkgPath).isFile()) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof pkg?.name === "string" && pkg.name.trim()) packageName = pkg.name.trim();
      if (typeof pkg?.description === "string" && pkg.description.trim()) {
        packageDescription = pkg.description.trim();
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    root: rootResolved,
    label: pathBasenameLabel(rootResolved),
    gitBranch: git.isRepo ? git.branch : null,
    topLevel,
    readmeExcerpt,
    packageName,
    packageDescription,
  };
}

module.exports = {
  findGitRoot,
  getGitContext,
  checkoutGitBranch,
  resolveWorkspaceRoot,
  getWorkspaceContext,
  searchWorkspaceFiles,
  filterGitBranches,
  pathBasenameLabel,
  describeWorkspaceProject,
};
