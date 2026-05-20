import { hasPreviewableFileExtension } from "./chatLabDocumentPreview.js";

const PATH_KEYS = [
  "path",
  "file_path",
  "filepath",
  "target_file",
  "absolute_path",
  "file",
  "uri",
  "resolvedPath",
  "target",
  "dest",
  "output_path",
  "output",
  "out_path",
  "local_path",
];

/** @param {Record<string, unknown> | undefined} args @param {string[]} keys */
function pickArgString(args, keys) {
  if (!args || typeof args !== "object") return "";
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, k)) continue;
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const EXT_ALTS = "html|htm|pdf|svg|csv|xlsx|xls|pptx|ppt";

/**
 * @param {string} text
 * @returns {string[]}
 */
function scrapePathsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const s = text;
  /** @type {Set<string>} */
  const found = new Set();
  /** @param {string} p */
  const add = (p) => {
    const x = p.trim().replace(/^['"]+|['"]+$/g, "");
    if (!x || /^https?:\/\//i.test(x)) return;
    if (!hasPreviewableFileExtension(x)) return;
    found.add(x);
  };

  const reWin = new RegExp(`[A-Za-z]:\\\\[^\\n<"'|*?]+\\.(?:${EXT_ALTS})\\b`, "gi");
  const reUnix = new RegExp(`/(?:[^\\s<"')]+/)*[^\\s<"')]+\\.(?:${EXT_ALTS})\\b`, "gi");
  const reBt = /\`([^\n`]*\.(?:html|htm|pdf|svg|csv|xlsx|xls|pptx|ppt))\b/gi;
  const reWord = new RegExp(`\\b([\\w./\\\\-]+\\.(?:${EXT_ALTS}))\\b`, "gi");

  let m;
  while ((m = reWin.exec(s)) !== null) add(m[0]);
  while ((m = reUnix.exec(s)) !== null) add(m[0]);
  while ((m = reBt.exec(s)) !== null) add(m[1]);
  while ((m = reWord.exec(s)) !== null) add(m[1]);

  return [...found];
}

/** @param {string} name */
function isWriteLikeTool(name) {
  const n = String(name).toLowerCase();
  return /write|save|apply_patch|edit|patch|create|output|export|dump/i.test(n);
}

/** @param {string} p */
function filenameHint(p) {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Best-effort path → OpenClaw workspace file for dock preview.
 * @param {*} message
 * @returns {{ path: string; label: string } | null}
 */
export function pickPrimaryWorkspacePreviewCandidate(message) {
  if (!message || message.role !== "assistant") return null;
  /** @type {{ path: string; label: string; score: number }[]} */
  const ranked = [];

  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  for (const row of toolRows) {
    const toolName = String(row.toolName ?? "");
    const scoreBase = isWriteLikeTool(toolName) ? 100 : 50;
    const args = row.args && typeof row.args === "object" ? /** @type {Record<string, unknown>} */ (row.args) : undefined;
    const fromArg = pickArgString(args, PATH_KEYS);
    if (fromArg && hasPreviewableFileExtension(fromArg)) {
      ranked.push({ path: fromArg, label: filenameHint(fromArg), score: scoreBase + 25 });
    }
    for (const field of ["result", "partialResult", "summary", "label"]) {
      const txt = typeof row[field] === "string" ? row[field] : "";
      for (const p of scrapePathsFromText(txt)) {
        ranked.push({ path: p, label: filenameHint(p), score: scoreBase });
      }
    }
  }

  const activityRows = Array.isArray(message.activityLog) ? message.activityLog : [];
  for (const row of activityRows) {
    const txt = `${row.title ?? ""}\n${row.text ?? ""}`;
    for (const p of scrapePathsFromText(txt)) {
      ranked.push({ path: p, label: filenameHint(p), score: 40 });
    }
  }

  // Do not scrape assistant prose alone — models often mention hypothetical filenames
  // (e.g. clarify-intent-card.html) without writing them to the workspace.

  if (!ranked.length) return null;

  const hasWriteEvidence = ranked.some((x) => x.score >= 100);
  if (!hasWriteEvidence) return null;

  /** @type {Map<string, { path: string; label: string; score: number }>} */
  const byPath = new Map();
  for (const x of ranked) {
    const prev = byPath.get(x.path);
    if (!prev || x.score > prev.score) byPath.set(x.path, x);
  }
  const merged = [...byPath.values()].sort((a, b) => b.score - a.score || b.path.length - a.path.length);
  const best = merged[0];
  return { path: best.path, label: best.label || best.path };
}
