import { hasPreviewableFileExtension } from "./chatLabDocumentPreview.js";
import { artifactPreviewKindFromPath, extOfFilename } from "./chatLabArtifactPreviewKind.js";

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

const EXT_ALTS =
  "html|htm|pdf|svg|csv|xlsx|xls|pptx|ppt|md|markdown|txt|js|mjs|cjs|ts|tsx|jsx|json|css|py|rb|go|rs|java|kt|cs|cpp|c|h|sql|sh|yaml|yml|xml|vue|svelte|png|jpg|jpeg|gif|webp";

/** User-facing outputs — prefer these over build/tooling scripts. */
const DELIVERABLE_EXT = new Set([
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".pdf",
  ".svg",
  ".csv",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".docx",
  ".doc",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".avif",
]);

/** Often intermediate when a deliverable exists in the same session. */
const TOOLING_EXT = new Set([".py", ".sh", ".bash", ".zsh", ".ps1", ".bat"]);

/** @typedef {"created"|"modified"} ArtifactOp */

/**
 * @typedef {{
 *   path: string;
 *   label: string;
 *   op: ArtifactOp;
 *   messageId: string;
 *   seq: number;
 *   previewKind: ReturnType<typeof artifactPreviewKindFromPath>;
 * }} SessionArtifact
 */

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

/**
 * @param {string} text
 * @returns {string[]}
 */
function scrapePathsFromText(text) {
  if (!text || typeof text !== "string") return [];
  /** @type {Set<string>} */
  const found = new Set();
  /** @param {string} p */
  const add = (p) => {
    const x = p.trim().replace(/^['"]+|['"]+$/g, "");
    if (!x || /^https?:\/\//i.test(x)) return;
    if (!isArtifactPath(x)) return;
    found.add(x);
  };

  const reWin = new RegExp(`[A-Za-z]:\\\\[^\\n<"'|*?]+\\.(?:${EXT_ALTS})\\b`, "gi");
  const reUnix = new RegExp(`/(?:[^\\s<"')]+/)*[^\\s<"')]+\\.(?:${EXT_ALTS})\\b`, "gi");
  const reBt = new RegExp(`\`([^\n\`]*\\.(?:${EXT_ALTS}))\\b`, "gi");

  let m;
  while ((m = reWin.exec(text)) !== null) add(m[0]);
  while ((m = reUnix.exec(text)) !== null) add(m[0]);
  while ((m = reBt.exec(text)) !== null) add(m[1]);

  return [...found];
}

/** @param {string} p */
function isArtifactPath(p) {
  if (hasPreviewableFileExtension(p)) return true;
  return /\.(md|markdown|txt|text|js|mjs|cjs|ts|tsx|jsx|json|css|py|rb|go|rs|java|kt|cs|cpp|c|h|sql|sh|yaml|yml|xml|vue|svelte|png|jpg|jpeg|gif|webp|log)$/i.test(
    String(p ?? "").trim(),
  );
}

/** @param {string} toolName */
function artifactOpFromTool(toolName) {
  const n = String(toolName).toLowerCase();
  if (/edit|patch|apply_patch|str_replace|replace|update|modify|rename|move/i.test(n)) return "modified";
  if (/write|save|create|output|export|dump|generate|new_file/i.test(n)) return "created";
  return "modified";
}

/** @param {string} toolName */
function isFileMutatingTool(toolName) {
  const n = String(toolName).toLowerCase();
  return /write|save|apply_patch|edit|patch|create|output|export|dump|str_replace|replace|update|modify|rename|move/i.test(
    n,
  );
}

/** @param {string} p */
function filenameHint(p) {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** Canonical map key + stable display path for IPC reads. */
function normalizeArtifactPath(p) {
  const raw = String(p ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/\\\\/g, "\\");
  const key = raw.replace(/\\/g, "/").toLowerCase();
  return { key, path: raw };
}

/** @param {string} path */
function isDeliverablePath(path) {
  return DELIVERABLE_EXT.has(extOfFilename(path));
}

/**
 * Build/helper scripts (e.g. gen_weather_html.py) — not shown when a deliverable exists.
 * @param {string} path
 */
function looksLikeIntermediateScript(path) {
  const base = filenameHint(path);
  if (!TOOLING_EXT.has(extOfFilename(path))) return false;
  const lower = base.toLowerCase();
  if (/^(gen_|generate_|build_|tmp_|temp_|script_|fetch_|scrape_|parse_|run_|make_|convert_)/.test(lower)) {
    return true;
  }
  if (/^gen[^/\\]*\.(py|sh|bash|ps1|bat)$/i.test(lower)) return true;
  if (/_?(generator|builder|script)\./i.test(lower)) return true;
  return false;
}

/**
 * @param {string} path
 * @param {string} [content] assistant markdown around this path
 */
function pathPriorityBonus(path, content) {
  let bonus = 0;
  const ext = extOfFilename(path);
  if (DELIVERABLE_EXT.has(ext)) bonus += 4000;
  else if (TOOLING_EXT.has(ext)) bonus -= 2500;
  else bonus += 800;

  if (looksLikeIntermediateScript(path)) bonus -= 3500;

  if (content) {
    const norm = path.replace(/\\/g, "/");
    const base = filenameHint(path);
    const inBt =
      content.includes(`\`${path}\``) ||
      content.includes(`\`${norm}\``) ||
      content.includes(`\`${base}\``);
    if (inBt) bonus += 2500;
    if (/最终|产物|生成|输出|结果|在这里|请看|👉|deliverable|output file|generated/i.test(content)) {
      if (content.includes(base) || content.includes(norm) || content.includes(path)) bonus += 1200;
    }
  }
  return bonus;
}

/**
 * Drop obvious intermediate scripts when user-facing deliverables were also produced.
 * @param {Array<SessionArtifact & { priority: number }>} ranked
 */
function filterIntermediateWhenDeliverablesExist(ranked) {
  const hasDeliverable = ranked.some((a) => isDeliverablePath(a.path));
  if (!hasDeliverable) return ranked;
  return ranked.filter((a) => !looksLikeIntermediateScript(a.path));
}

/**
 * Same basename (e.g. relative vs absolute path) → keep highest-priority entry.
 * @param {Array<SessionArtifact & { priority: number }>} ranked priority-desc
 */
function dedupeArtifactsByLabel(ranked) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {typeof ranked} */
  const out = [];
  for (const a of ranked) {
    const key = filenameHint(a.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * @param {Map<string, SessionArtifact & { order: number; priority: number }>} byPath
 * @param {string} p
 * @param {{ op: ArtifactOp; messageId: string; seq: number; order: number; priority: number }} meta
 */
function upsertArtifact(byPath, p, meta) {
  const { key, path } = normalizeArtifactPath(p);
  const prev = byPath.get(key);
  const entry = {
    path,
    label: filenameHint(path),
    op: prev && prev.op === "created" && meta.op === "modified" ? "modified" : meta.op,
    messageId: meta.messageId,
    seq: meta.seq,
    previewKind: artifactPreviewKindFromPath(path),
    order: meta.order,
    priority: meta.priority,
  };
  if (!prev || entry.priority > prev.priority || (entry.priority === prev.priority && entry.order >= prev.order)) {
    byPath.set(key, entry);
  }
}

/**
 * Collect workspace file artifacts from an entire conversation.
 * @param {Array<{ id: string; role: string; content?: string; streaming?: boolean; error?: string; toolTrace?: unknown[]; activityLog?: unknown[] }>} messages
 * @returns {SessionArtifact[]}
 */
export function collectSessionArtifacts(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "assistant" && !m.streaming && !m.error) return i;
    }
    return -1;
  })();

  /** @type {Map<string, SessionArtifact & { order: number; priority: number }>} keyed by normalizeArtifactPath().key */
  const byPath = new Map();
  let order = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const message = messages[msgIdx];
    if (!message || message.role !== "assistant" || message.streaming || message.error) continue;
    const messageId = String(message.id ?? "");
    const content = String(message.content ?? "");
    const isLastAssistant = msgIdx === lastAssistantIdx;
    const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];

    for (const row of toolRows) {
      const toolName = String(row.toolName ?? "");
      if (!isFileMutatingTool(toolName)) continue;
      const op = artifactOpFromTool(toolName);
      const seq = typeof row.seq === "number" ? row.seq : order;
      const args =
        row.args && typeof row.args === "object"
          ? /** @type {Record<string, unknown>} */ (row.args)
          : undefined;

      const fromArg = pickArgString(args, PATH_KEYS);
      if (fromArg && isArtifactPath(fromArg)) {
        order += 1;
        upsertArtifact(byPath, fromArg, {
          op,
          messageId,
          seq,
          order,
          priority: 6000 + pathPriorityBonus(fromArg, content),
        });
      }

      for (const field of ["result", "partialResult", "summary", "label"]) {
        const txt = typeof row[field] === "string" ? row[field] : "";
        for (const p of scrapePathsFromText(txt)) {
          order += 1;
          upsertArtifact(byPath, p, {
            op,
            messageId,
            seq,
            order,
            priority: 2000 + pathPriorityBonus(p),
          });
        }
      }
    }

    if (content.trim()) {
      const prosePaths = scrapePathsFromText(content);
      for (const p of prosePaths) {
        order += 1;
        let prosePriority = isLastAssistant ? 8000 : 3500;
        prosePriority += pathPriorityBonus(p, content);
        upsertArtifact(byPath, p, {
          op: "created",
          messageId,
          seq: order,
          order,
          priority: prosePriority,
        });
      }
    }
  }

  const ranked = [...byPath.values()].sort((a, b) => b.priority - a.priority || a.order - b.order);
  const filtered = filterIntermediateWhenDeliverablesExist(ranked);
  const deduped = dedupeArtifactsByLabel(filtered);

  return deduped.map(({ order: _o, priority: _p, ...rest }) => rest);
}
