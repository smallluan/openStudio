import { prismLangFromFilename } from "./chatLabSyntaxLang.js";

/**
 * @typedef {"markdown"|"html"|"code"|"pdf"|"csv"|"svg"|"image"|"office"|"text"|"binary"} ArtifactPreviewKind
 */

const OFFICE_EXT = new Set([".xlsx", ".xls", ".pptx", ".ppt", ".docx", ".doc"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".avif"]);

/** @param {string} name */
export function extOfFilename(name) {
  const s = String(name ?? "").trim();
  const slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  const base = slash >= 0 ? s.slice(slash + 1) : s;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * @param {string} filenameOrPath
 * @returns {ArtifactPreviewKind}
 */
export function artifactPreviewKindFromPath(filenameOrPath) {
  const ext = extOfFilename(filenameOrPath);
  if (!ext) return "text";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".pdf") return "pdf";
  if (ext === ".csv") return "csv";
  if (ext === ".svg") return "svg";
  if (IMAGE_EXT.has(ext)) return "image";
  if (OFFICE_EXT.has(ext)) return "office";
  if (prismLangFromFilename(filenameOrPath)) return "code";
  if (ext === ".txt" || ext === ".text" || ext === ".log") return "text";
  return "binary";
}

/**
 * @param {ArtifactPreviewKind} kind
 * @returns {boolean}
 */
export function artifactKindSupportsRenderToggle(kind) {
  return kind === "markdown" || kind === "html";
}
