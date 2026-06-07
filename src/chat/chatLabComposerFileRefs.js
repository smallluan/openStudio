/** Composer file / folder path refs for Chat Lab (Electron local paths). */

export const MAX_CHAT_COMPOSER_FILE_REFS = 12;

/** @returns {string} */
export function newComposerFileRefId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `fref_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * @typedef {'file' | 'directory'} ComposerFileRefKind
 * @typedef {{ id: string; path: string; name: string; kind: ComposerFileRefKind }} ComposerFileRef
 */

/** @param {string} p */
export function basenameFromPath(p) {
  const s = String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** @param {string} p */
function normalizePathForCompare(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/**
 * @param {string} norm normalized forward-slash path
 * @param {string} sample original path (for separator style)
 */
function pathFromNormalized(norm, sample) {
  if (sample.includes("\\")) return norm.replace(/\//g, "\\");
  return norm;
}

/**
 * @param {string[]} paths
 * @param {(path: string) => Promise<{ exists?: boolean; isDirectory?: boolean } | null | undefined>} statLocalPath
 * @returns {Promise<ComposerFileRef[] | null>}
 */
async function tryCollapseToDroppedFolder(paths, statLocalPath) {
  if (paths.length < 2) return null;
  const norm = paths.map(normalizePathForCompare);
  let common = norm[0];
  for (const p of norm.slice(1)) {
    while (common.length > 0 && !p.startsWith(common)) {
      const idx = common.lastIndexOf("/");
      if (idx <= 0) {
        common = "";
        break;
      }
      common = common.slice(0, idx);
    }
    if (!common) return null;
  }
  if (!common) return null;
  const allUnder = norm.every((p) => p === common || p.startsWith(`${common}/`));
  if (!allUnder) return null;
  const sample = paths.find((p) => normalizePathForCompare(p) === common) ?? paths[0];
  const folderPath = pathFromNormalized(common, sample);
  const st = await statLocalPath(folderPath);
  if (!st?.exists || !st.isDirectory) return null;
  return [
    {
      id: newComposerFileRefId(),
      path: folderPath,
      name: basenameFromPath(folderPath),
      kind: /** @type {const} */ ("directory"),
    },
  ];
}

/**
 * Resolve unique local paths from a drop (files + folders).
 * @param {File[]} files
 * @param {(file: File) => string} getPathForFile
 * @param {(path: string) => Promise<{ exists?: boolean; isFile?: boolean; isDirectory?: boolean } | null | undefined>} statLocalPath
 * @returns {Promise<ComposerFileRef[]>}
 */
export async function resolveDroppedLocalPaths(files, getPathForFile, statLocalPath) {
  /** @type {string[]} */
  const rawPaths = [];
  for (const file of files) {
    if (!file) continue;
    try {
      const p = getPathForFile(file);
      if (typeof p === "string" && p.trim()) rawPaths.push(p.trim());
    } catch {
      /* ignore */
    }
  }
  const unique = [...new Set(rawPaths)];
  if (unique.length === 0) return [];

  if (unique.length > 1) {
    const collapsed = await tryCollapseToDroppedFolder(unique, statLocalPath);
    if (collapsed?.length) return collapsed;
  }

  /** @type {ComposerFileRef[]} */
  const out = [];
  for (const p of unique) {
    const st = await statLocalPath(p);
    if (st && st.exists === false) continue;
    const kind = st?.isDirectory ? /** @type {const} */ ("directory") : /** @type {const} */ ("file");
    out.push({
      id: newComposerFileRefId(),
      path: p,
      name: basenameFromPath(p),
      kind,
    });
  }
  return out;
}

/** @param {ComposerFileRefKind} kind */
export function emojiForFileRefKind(kind) {
  return kind === "directory" ? "📁" : "📄";
}

/**
 * @param {Array<{ path?: string; kind?: string }> | undefined} fileRefs
 */
export function formatFileRefsForGateway(fileRefs) {
  const refs = Array.isArray(fileRefs) ? fileRefs : [];
  if (!refs.length) return "";
  const lines = [];
  for (const r of refs) {
    const path = typeof r?.path === "string" ? r.path.trim() : "";
    if (!path) continue;
    const kind = r.kind === "directory" ? "directory" : "file";
    lines.push(`- ${path} (${kind})`);
  }
  if (!lines.length) return "";
  return `[Attached local paths — read these from disk]\n${lines.join("\n")}`;
}

/**
 * Plain-text user line for gateway history / `chat.send`.
 * @param {unknown} text
 * @param {Array<{ dataUrl?: string }> | undefined} imageAttachments
 * @param {Array<{ path?: string; kind?: string }> | undefined} fileRefs
 */
export function gatewayUserMessageBodyWithRefs(text, imageAttachments, fileRefs) {
  const t = String(text ?? "").trim();
  const imgs = Array.isArray(imageAttachments) ? imageAttachments : [];
  let n = 0;
  for (const a of imgs) {
    const url = typeof a?.dataUrl === "string" ? a.dataUrl : "";
    if (url.startsWith("data:image/")) n++;
  }
  const refBlock = formatFileRefsForGateway(fileRefs);
  const parts = [];
  if (t) parts.push(t);
  if (n > 0) {
    const note = n === 1 ? "[1 image attached]" : `[${n} images attached]`;
    parts.push(note);
  }
  if (refBlock) parts.push(refBlock);
  return parts.join("\n\n");
}
