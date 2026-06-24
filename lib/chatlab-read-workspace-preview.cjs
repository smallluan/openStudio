const fs = require("fs");
const path = require("path");
const { resolveOpenClawStateDir, parseAgentIdFromSessionKey } = require("./sync-openclaw-agent-from-studio.cjs");

const ARTIFACT_EXT = new Set([
  ".html",
  ".htm",
  ".pdf",
  ".svg",
  ".csv",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".docx",
  ".doc",
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".log",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".yaml",
  ".yml",
  ".xml",
  ".vue",
  ".svelte",
  ".toml",
  ".ini",
  ".env",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".avif",
]);

/** Extensions read as UTF-8 text for the artifact preview pane. */
const TEXT_READ_EXT = new Set([
  ".html",
  ".htm",
  ".svg",
  ".csv",
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".log",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".yaml",
  ".yml",
  ".xml",
  ".vue",
  ".svelte",
  ".toml",
  ".ini",
  ".env",
]);

const MAX_BYTES = 26_214_400; /** ~25 MiB */

/** @param {string} p */
function extOf(p) {
  return path.extname(p).toLowerCase();
}

/** @param {string} p */
function isPreviewablePath(p) {
  return ARTIFACT_EXT.has(extOf(p));
}

/**
 * @param {string} ext
 * @returns {string}
 */
function mimeForExt(ext) {
  switch (ext.toLowerCase()) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".ppt":
      return "application/vnd.ms-powerpoint";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".doc":
      return "application/msword";
    case ".md":
    case ".markdown":
      return "text/markdown; charset=utf-8";
    case ".txt":
    case ".text":
    case ".log":
      return "text/plain; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript; charset=utf-8";
    case ".ts":
    case ".tsx":
      return "text/typescript; charset=utf-8";
    case ".jsx":
      return "text/jsx; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".css":
    case ".scss":
    case ".less":
      return "text/css; charset=utf-8";
    case ".py":
      return "text/x-python; charset=utf-8";
    case ".yaml":
    case ".yml":
      return "text/yaml; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".bmp":
      return "image/bmp";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

/**
 * @param {string} stateDir
 * @param {string} agentId
 * @returns {string[]}
 */
function searchBases(stateDir, agentId) {
  /** @type {string[]} */
  const bases = [
    path.join(stateDir, "agents", agentId, "workspace"),
    path.join(stateDir, "agents", agentId, "agent"),
    path.join(stateDir, "agents", agentId),
    path.join(stateDir, "workspace"),
    path.join(stateDir, "workspace-dev"),
    stateDir,
  ];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const b of bases) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/**
 * Resolve a relative or basename path by probing OpenClaw workspace roots.
 * @param {string[] | null} bases
 * @param {string} rawPath
 * @returns {string | null}
 */
function findFileInWorkspaceBases(bases, rawPath) {
  if (!bases?.length) return null;
  const raw = String(rawPath ?? "").trim();
  if (!raw) return null;

  for (const b of bases) {
    const c = path.join(b, raw);
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }

  const bn = path.basename(raw);
  if (!bn || bn === "." || bn === "..") return null;
  for (const b of bases) {
    const c = path.join(b, bn);
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }

  if (process.platform === "win32") {
    const want = bn.toLowerCase();
    for (const b of bases) {
      try {
        for (const ent of fs.readdirSync(b)) {
          if (ent.toLowerCase() !== want) continue;
          const c = path.join(b, ent);
          if (fs.statSync(c).isFile()) return c;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return null;
}

/** @deprecated use findFileInWorkspaceBases */
function tryWorkspacePathByBasename(bases, rawPath) {
  return findFileInWorkspaceBases(bases, rawPath);
}

/**
 * Resolve a workspace / absolute preview path to a real path (extension + size validated).
 * Same rules as {@link readWorkspacePreviewFile}, but does not read bytes.
 *
 * @param {{ openclaw?: { gatewayBaseUrl?: string; sessionKey?: string } }} cfg
 * @param {string} rawPath
 * @returns {{ ok: true; filePath: string; ext: string; mime: string } | { ok: false; message: string }}
 */
function resolveWorkspacePreviewTarget(cfg, rawPath) {
  const gatewayBaseUrl = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
  const raw = String(rawPath ?? "").trim();
  if (!raw) return { ok: false, message: "empty_path" };

  /** @type {string[] | null} */
  let wsBases = null;
  if (gatewayBaseUrl) {
    const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
    const agentId = parseAgentIdFromSessionKey(cfg?.openclaw?.sessionKey);
    wsBases = searchBases(stateDir, agentId);
  }

  /** @type {string} */
  let candidate;
  if (path.isAbsolute(raw)) {
    candidate = path.normalize(raw);
  } else {
    if (!wsBases) return { ok: false, message: "no_gateway" };
    const found = findFileInWorkspaceBases(wsBases, raw);
    candidate = found ?? path.join(wsBases[0], raw);
  }

  const rp = fs.realpathSync.native || fs.realpathSync;
  let realTarget;
  try {
    realTarget = rp(candidate);
  } catch (e) {
    const alt = findFileInWorkspaceBases(wsBases, raw);
    if (!alt) {
      return {
        ok: false,
        message: String(e?.code === "ENOENT" ? "file_not_found" : e?.message ?? e ?? "not_found"),
      };
    }
    try {
      realTarget = rp(alt);
    } catch (e2) {
      return {
        ok: false,
        message: String(e2?.code === "ENOENT" ? "file_not_found" : e2?.message ?? e2 ?? "not_found"),
      };
    }
  }

  const ext = extOf(realTarget);
  if (!ARTIFACT_EXT.has(ext)) {
    return { ok: false, message: "unsupported_type" };
  }

  let st;
  try {
    st = fs.statSync(realTarget);
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e ?? "stat_failed") };
  }
  if (!st.isFile()) return { ok: false, message: "not_a_file" };
  if (st.size > MAX_BYTES) return { ok: false, message: "file_too_large" };

  const mime = mimeForExt(ext);
  return { ok: true, filePath: realTarget, ext, mime };
}

/**
 * Read a previewable file from disk. Absolute paths work anywhere on the host (allowed
 * extensions only, size cap). Relative paths are resolved under the OpenClaw agent
 * workspace for the configured gateway (requires gatewayBaseUrl).
 *
 * @param {{ openclaw?: { gatewayBaseUrl?: string; sessionKey?: string } }} cfg
 * @param {string} rawPath relative under agent workspace, or any absolute path to a previewable file
 * @returns {{
 *   ok: true;
 *   kind: "text" | "bytes";
 *   mime: string;
 *   ext: string;
 *   filePath: string;
 *   text?: string;
 *   base64?: string;
 * } | { ok: false; message: string }}
 */
function readWorkspacePreviewFile(cfg, rawPath) {
  const resolved = resolveWorkspacePreviewTarget(cfg, rawPath);
  if (!resolved.ok) return resolved;
  const { filePath: realTarget, ext, mime } = resolved;

  if (TEXT_READ_EXT.has(ext)) {
    try {
      const text = fs.readFileSync(realTarget, "utf8");
      return { ok: true, kind: "text", mime, ext, filePath: realTarget, text };
    } catch (e) {
      return { ok: false, message: String(e?.message ?? e ?? "read_failed") };
    }
  }

  try {
    const buf = fs.readFileSync(realTarget);
    return { ok: true, kind: "bytes", mime, ext, filePath: realTarget, base64: buf.toString("base64") };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e ?? "read_failed") };
  }
}

const MAX_DIR_ENTRIES = 400;
const MAX_TREE_DEPTH = 6;

/**
 * @param {string} dirPath
 * @param {string} [rootHint]
 * @returns {string}
 */
function displayPathForEntry(dirPath, rootHint) {
  if (!rootHint) return dirPath;
  const norm = (p) => String(p ?? "").replace(/\\/g, "/");
  const d = norm(dirPath);
  const r = norm(rootHint);
  if (d.toLowerCase().startsWith(r.toLowerCase() + "/")) {
    return d.slice(r.length + 1);
  }
  return dirPath;
}

/**
 * List previewable files under a directory (recursive, depth-capped).
 *
 * @param {string} dirPath absolute directory
 * @param {number} depth
 * @param {number} maxDepth
 * @param {{ entries: Array<{ path: string; name: string; kind: "file"|"dir"; previewable: boolean }>; count: number }} acc
 * @param {string} [rootHint]
 */
function walkPreviewDirectory(dirPath, depth, maxDepth, acc, rootHint) {
  if (acc.count >= MAX_DIR_ENTRIES || depth > maxDepth) return;
  /** @type {import("fs").Dirent[]} */
  let ents;
  try {
    ents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  ents.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1;
    const bd = b.isDirectory() ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const ent of ents) {
    if (acc.count >= MAX_DIR_ENTRIES) return;
    const name = ent.name;
    if (!name || name === "." || name === ".." || name.startsWith(".")) continue;
    const full = path.join(dirPath, name);
    if (ent.isDirectory()) {
      acc.entries.push({
        path: displayPathForEntry(full, rootHint),
        name,
        kind: "dir",
        previewable: false,
      });
      acc.count += 1;
      if (depth < maxDepth) {
        walkPreviewDirectory(full, depth + 1, maxDepth, acc, rootHint);
      }
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = extOf(full);
    const previewable = ARTIFACT_EXT.has(ext);
    acc.entries.push({
      path: displayPathForEntry(full, rootHint),
      name,
      kind: "file",
      previewable,
    });
    acc.count += 1;
  }
}

/**
 * List files and folders near a workspace preview path (parent directory tree).
 *
 * @param {{ openclaw?: { gatewayBaseUrl?: string; sessionKey?: string } }} cfg
 * @param {string} rawPath file or directory path (relative or absolute)
 * @param {{ maxDepth?: number }} [opts]
 * @returns {{
 *   ok: true;
 *   rootPath: string;
 *   entries: Array<{ path: string; name: string; kind: "file"|"dir"; previewable: boolean }>;
 * } | { ok: false; message: string }}
 */
function listWorkspacePreviewDirectory(cfg, rawPath, opts = {}) {
  const raw = String(rawPath ?? "").trim();
  if (!raw) return { ok: false, message: "empty_path" };

  const gatewayBaseUrl = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
  /** @type {string[] | null} */
  let wsBases = null;
  if (gatewayBaseUrl) {
    const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
    const agentId = parseAgentIdFromSessionKey(cfg?.openclaw?.sessionKey);
    wsBases = searchBases(stateDir, agentId);
  }

  /** @type {string | null} */
  let anchorFile = null;
  /** @type {string | null} */
  let anchorDir = null;

  if (path.isAbsolute(raw)) {
    const norm = path.normalize(raw);
    try {
      const st = fs.statSync(norm);
      if (st.isDirectory()) anchorDir = norm;
      else if (st.isFile()) anchorFile = norm;
    } catch {
      return { ok: false, message: "not_found" };
    }
  } else {
    if (!wsBases) return { ok: false, message: "no_gateway" };
    const found = findFileInWorkspaceBases(wsBases, raw);
    if (found) {
      anchorFile = found;
    } else {
      for (const b of wsBases) {
        const c = path.join(b, raw);
        try {
          const st = fs.statSync(c);
          if (st.isDirectory()) {
            anchorDir = c;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      if (!anchorDir) return { ok: false, message: "file_not_found" };
    }
  }

  const rootDir = anchorDir ?? (anchorFile ? path.dirname(anchorFile) : null);
  if (!rootDir) return { ok: false, message: "not_found" };

  const maxDepth = Math.min(MAX_TREE_DEPTH, Math.max(1, Number(opts.maxDepth) || 4));
  /** @type {{ entries: Array<{ path: string; name: string; kind: "file"|"dir"; previewable: boolean }>; count: number }} */
  const acc = { entries: [], count: 0 };
  const rootHint = wsBases?.[0] ?? rootDir;
  walkPreviewDirectory(rootDir, 0, maxDepth, acc, rootHint);

  return { ok: true, rootPath: rootDir, entries: acc.entries };
}

module.exports = {
  readWorkspacePreviewFile,
  resolveWorkspacePreviewTarget,
  listWorkspacePreviewDirectory,
  isPreviewablePath,
};
