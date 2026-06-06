/**
 * Resolve @tencent-weixin/openclaw-weixin on disk under an OpenClaw state dir.
 * OpenClaw versions differ: flat `npm/node_modules/...` vs `npm/projects/<id>/node_modules/...`.
 */

const fs = require("fs");
const path = require("path");

/**
 * @param {string} stateDir
 * @returns {string[]}
 */
function listWeixinPluginCandidateRoots(stateDir) {
  /** @type {string[]} */
  const roots = [];
  const seen = new Set();

  const push = (p) => {
    const n = path.normalize(p);
    if (!seen.has(n) && fs.existsSync(n)) {
      seen.add(n);
      roots.push(n);
    }
  };

  push(path.join(stateDir, "npm", "node_modules", "@tencent-weixin", "openclaw-weixin"));

  const npmProjects = path.join(stateDir, "npm", "projects");
  if (fs.existsSync(npmProjects)) {
    for (const entry of fs.readdirSync(npmProjects, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      push(
        path.join(npmProjects, entry.name, "node_modules", "@tencent-weixin", "openclaw-weixin"),
      );
    }
  }

  return roots;
}

/**
 * @param {string} root
 */
function isWeixinPluginRoot(root) {
  if (!root || !fs.existsSync(root)) return false;
  return (
    fs.existsSync(path.join(root, "dist", "src", "auth", "login-qr.js")) ||
    fs.existsSync(path.join(root, "dist", "index.js")) ||
    fs.existsSync(path.join(root, "package.json"))
  );
}

/**
 * @param {string} stateDir
 * @returns {string | null}
 */
function findWeixinPluginRoot(stateDir) {
  for (const root of listWeixinPluginCandidateRoots(stateDir)) {
    if (isWeixinPluginRoot(root)) return root;
  }
  return null;
}

/**
 * @param {string} pluginRoot
 * @param {string} relPath e.g. `auth/login-qr.js`
 * @returns {string | null}
 */
function resolveWeixinPluginModulePath(pluginRoot, relPath) {
  const direct = path.join(pluginRoot, "dist", "src", relPath);
  if (fs.existsSync(direct)) return direct;

  const fileName = path.basename(relPath);
  const distDir = path.join(pluginRoot, "dist");
  if (!fs.existsSync(distDir)) return null;

  /** @param {string} dir @param {number} depth */
  function walk(dir, depth) {
    if (depth > 6) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name === fileName) return full;
      if (ent.isDirectory()) {
        const hit = walk(full, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  return walk(distDir, 0);
}

module.exports = {
  listWeixinPluginCandidateRoots,
  isWeixinPluginRoot,
  findWeixinPluginRoot,
  resolveWeixinPluginModulePath,
};
