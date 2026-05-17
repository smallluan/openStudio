const fs = require("fs");
const path = require("path");
const { resolveOpenClawStateDir, parseAgentIdFromSessionKey } = require("./sync-openclaw-agent-from-studio.cjs");

const PREVIEW_EXT = new Set([".html", ".htm", ".pdf", ".svg", ".csv", ".xlsx", ".xls", ".pptx", ".ppt"]);
const MAX_BYTES = 26_214_400; /** ~25 MiB */

/** @param {string} p */
function extOf(p) {
  return path.extname(p).toLowerCase();
}

/** @param {string} p */
function isPreviewablePath(p) {
  return PREVIEW_EXT.has(extOf(p));
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
  return [
    path.join(stateDir, "agents", agentId, "workspace"),
    path.join(stateDir, "agents", agentId, "agent"),
    path.join(stateDir, "agents", agentId),
  ];
}

/**
 * When tools echo a wrong absolute path, the same basename may exist under the agent workspace.
 * @param {string[] | null} bases
 * @param {string} rawPath
 * @returns {string | null}
 */
function tryWorkspacePathByBasename(bases, rawPath) {
  if (!bases?.length) return null;
  const bn = path.basename(String(rawPath ?? "").trim());
  if (!bn || bn === "." || bn === "..") return null;
  for (const b of bases) {
    const c = path.join(b, bn);
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
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
    let found = null;
    for (const b of wsBases) {
      const c = path.join(b, raw);
      try {
        if (fs.existsSync(c)) {
          found = c;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    candidate = found ?? path.join(wsBases[0], raw);
  }

  const rp = fs.realpathSync.native || fs.realpathSync;
  let realTarget;
  try {
    realTarget = rp(candidate);
  } catch (e) {
    const alt = tryWorkspacePathByBasename(wsBases, raw);
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
  if (!PREVIEW_EXT.has(ext)) {
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

  if (ext === ".html" || ext === ".htm" || ext === ".svg" || ext === ".csv") {
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

module.exports = {
  readWorkspacePreviewFile,
  resolveWorkspacePreviewTarget,
  isPreviewablePath,
};
