import { artifactPreviewKindFromPath } from "./chatLabArtifactPreviewKind.js";

/**
 * @typedef {{
 *   path: string;
 *   name: string;
 *   kind: "file" | "dir";
 *   previewable?: boolean;
 *   children?: PreviewTreeNode[];
 * }} PreviewTreeNode
 */

/** @typedef {"file-only"|"paths"|"directory"} PreviewTreeMode */

/**
 * @typedef {{
 *   path: string;
 *   name: string;
 *   kind: "file" | "dir";
 *   previewable: boolean;
 * }} PreviewDirEntry
 */

/** @param {string} p */
function normPath(p) {
  return String(p ?? "").replace(/\\/g, "/");
}

/** @param {string} p */
function baseName(p) {
  const s = normPath(p);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Build nested tree nodes from flat directory entries (paths may be nested with `/`).
 * @param {PreviewDirEntry[]} entries
 * @returns {PreviewTreeNode[]}
 */
export function buildPreviewTreeFromEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  /** @type {Map<string, PreviewTreeNode>} */
  const dirs = new Map();
  /** @type {PreviewTreeNode[]} */
  const roots = [];

  /** @param {string} dirPath */
  const ensureDir = (dirPath) => {
    const key = normPath(dirPath);
    const existing = dirs.get(key);
    if (existing) return existing;
    const node = {
      path: dirPath,
      name: baseName(dirPath) || dirPath,
      kind: /** @type {"dir"} */ ("dir"),
      children: [],
    };
    dirs.set(key, node);
    const parentKey = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    if (parentKey) {
      const parent = ensureDir(parentKey);
      parent.children = parent.children ?? [];
      if (!parent.children.some((c) => c.path === node.path)) parent.children.push(node);
    } else if (!roots.some((r) => r.path === node.path)) {
      roots.push(node);
    }
    return node;
  };

  for (const ent of entries) {
    const p = String(ent.path ?? "").trim();
    if (!p) continue;
    const parts = normPath(p).split("/").filter(Boolean);
    if (!parts.length) continue;
    if (ent.kind === "dir") {
      ensureDir(parts.join("/"));
      continue;
    }
    const fileName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);
    /** @type {PreviewTreeNode[]} */
    let bucket = roots;
    if (parentParts.length) {
      const parent = ensureDir(parentParts.join("/"));
      parent.children = parent.children ?? [];
      bucket = parent.children;
    }
    if (bucket.some((n) => n.path === p)) continue;
    bucket.push({
      path: p,
      name: fileName,
      kind: "file",
      previewable: Boolean(ent.previewable),
    });
  }

  /** @param {PreviewTreeNode[]} nodes */
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => {
      const ad = a.kind === "dir" ? 0 : 1;
      const bd = b.kind === "dir" ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    for (const n of nodes) {
      if (n.children?.length) sortNodes(n.children);
    }
  };
  sortNodes(roots);
  return roots;
}

/**
 * Merge session artifact paths into a tree (flat artifact list + optional directory scan).
 * @param {Array<{ path: string; label?: string; op?: string }>} artifacts
 * @param {PreviewDirEntry[]} [dirEntries]
 * @returns {PreviewTreeNode[]}
 */
export function mergeArtifactsIntoPreviewTree(artifacts, dirEntries = []) {
  /** @type {PreviewDirEntry[]} */
  const merged = [];
  const seen = new Set();

  for (const ent of dirEntries) {
    const key = normPath(ent.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ent);
  }

  for (const a of artifacts) {
    const p = String(a.path ?? "").trim();
    if (!p) continue;
    const key = normPath(p).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      path: p,
      name: a.label || baseName(p),
      kind: "file",
      previewable: true,
    });
  }

  return buildPreviewTreeFromEntries(merged);
}

/**
 * Default sidebar tree mode from artifact count.
 * @param {Array<{ path?: string }>} files
 * @param {PreviewTreeMode} [explicit]
 * @returns {PreviewTreeMode}
 */
export function resolvePreviewTreeMode(files, explicit) {
  if (explicit) return explicit;
  if (!Array.isArray(files) || files.length <= 1) return "file-only";
  return "paths";
}

/**
 * @param {string} path
 * @returns {"render"|"source"}
 */
export function defaultArtifactViewMode(path) {
  const kind = artifactPreviewKindFromPath(path);
  return kind === "markdown" || kind === "html" ? "render" : "source";
}

/**
 * Build sidebar tree without scanning disk.
 * @param {Array<{ path: string; label?: string }>} files
 * @param {PreviewTreeMode} mode
 * @returns {PreviewTreeNode[]}
 */
export function buildArtifactSidebarTree(files, mode) {
  const list = Array.isArray(files) ? files.filter((f) => f?.path) : [];
  if (!list.length) return [];
  if (mode === "file-only") {
    const f = list[0];
    return [
      {
        path: f.path,
        name: f.label || baseName(f.path),
        kind: "file",
        previewable: true,
      },
    ];
  }
  if (mode === "paths") {
    const paths = list.map((f) => normPath(f.path));
    const looksAbsolute = paths.some((p) => /^[a-zA-Z]:\//.test(p) || p.startsWith("/"));
    if (looksAbsolute) {
      return list.map((f) => ({
        path: f.path,
        name: f.label || baseName(f.path),
        kind: /** @type {"file"} */ ("file"),
        previewable: true,
      }));
    }
    return buildPreviewTreeFromEntries(
      list.map((f) => ({
        path: f.path,
        name: f.label || baseName(f.path),
        kind: "file",
        previewable: true,
      })),
    );
  }
  return [];
}

/**
 * Collect all previewable file paths from a tree (depth-first).
 * @param {PreviewTreeNode[]} nodes
 * @returns {string[]}
 */
export function collectPreviewablePaths(nodes) {
  /** @type {string[]} */
  const out = [];
  /** @param {PreviewTreeNode[]} list */
  const walk = (list) => {
    for (const n of list) {
      if (n.kind === "file" && n.previewable !== false) out.push(n.path);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
