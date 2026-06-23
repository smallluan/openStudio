import {
  collectMessageArtifacts,
  scrapeArtifactPathsFromText,
} from "./chatLabSessionArtifacts.js";
import { extOfFilename } from "./chatLabArtifactPreviewKind.js";
import { extractAllMarkdownImages, stripMarkdownImages } from "./chatLabMarkdownImageGrid.js";

/** Max media attachments pushed to WeChat per assistant turn. */
export const MAX_WECHAT_OUTBOUND_MEDIA = 6;

/** Extensions WeChat can send as image / video / file attachments. */
const SENDABLE_FILE_EXT =
  /\.(md|markdown|pdf|docx?|xlsx?|pptx?|txt|text|csv|png|jpe?g|gif|webp|svg|bmp|avif|ico|zip|7z|rar|tar|gz|mp4|mov|avi|mkv|webm|json|html?|xml|yaml|yml|ppt|xls|doc)$/i;

const TOOL_TRACE_TEXT_FIELDS = ["result", "partialResult", "summary", "label", "error"];
const TOOL_TRACE_ARG_KEYS = [
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
  "command",
  "cmd",
  "media",
  "mediaUrl",
  "media_url",
];

const BARE_HTTP_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** @param {string} url */
function isLikelyRemoteImageUrl(url) {
  const s = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  const lower = s.toLowerCase();
  const pathPart = s.split("?")[0].split("#")[0];
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)(?:$|[?#])/i.test(pathPart)) return true;
  if (/x-bce-process=image|\/pic\/|\/image\/|format,f_auto|thumbnail|photo|imgcdn|cdn.*\.(jpg|png)/i.test(lower)) {
    return true;
  }
  if (/\/(?:img|images?|pics?|photos?|avatar|thumb)\//i.test(pathPart)) return true;
  return false;
}

/** @param {string} path */
function labelFromMediaPath(path) {
  const s = String(path ?? "").trim();
  if (!s) return "image.jpg";
  if (/^https?:\/\//i.test(s)) {
    try {
      const base = new URL(s).pathname.split("/").pop()?.split("?")[0] || "image";
      return base.includes(".") ? base : `${base.slice(0, 48) || "image"}.jpg`;
    } catch {
      return "image.jpg";
    }
  }
  return s.replace(/\\/g, "/").split("/").pop()?.split("?")[0] || s;
}

/** @param {string} text @returns {string[]} */
function scrapeBareImageUrlsFromText(text) {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  /** @type {Set<string>} */
  const found = new Set();
  BARE_HTTP_URL_RE.lastIndex = 0;
  let m;
  while ((m = BARE_HTTP_URL_RE.exec(t)) !== null) {
    const url = String(m[0] ?? "").replace(/[),.，。；;]+$/g, "");
    if (isLikelyRemoteImageUrl(url)) found.add(url);
  }
  return [...found];
}

/**
 * Strip markdown / bare image URLs from assistant prose before WeChat text send.
 * @param {string} text
 */
export function stripWechatReplyText(text) {
  let out = stripMarkdownImages(text);
  out = out
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(trimmed)) return "";
      if (/^!\S/.test(trimmed)) return "";
      return line;
    })
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^https?:\/\//i.test(trimmed) && isLikelyRemoteImageUrl(trimmed)) return false;
      return true;
    })
    .join("\n");
  out = out.replace(BARE_HTTP_URL_RE, (url) => (isLikelyRemoteImageUrl(url) ? "" : url));
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split assistant reply into WeChat prose + remote/local media to push separately.
 * @param {string} replyText
 */
export function prepareWechatReplyPayload(replyText) {
  const raw = String(replyText ?? "");
  /** @type {Array<{ path: string; label: string }>} */
  const mediaItems = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {string} path @param {string} [preferredLabel] */
  const addMedia = (path, preferredLabel) => {
    const p = String(path ?? "").trim();
    if (!p || !isWechatSendablePath(p)) return;
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mediaItems.push({
      path: p,
      label: String(preferredLabel ?? "").trim() || labelFromMediaPath(p),
    });
  };

  for (const img of extractAllMarkdownImages(raw)) addMedia(img.src, img.alt);
  for (const url of scrapeBareImageUrlsFromText(raw)) addMedia(url);

  return {
    text: stripWechatReplyText(raw),
    mediaItems: mediaItems.slice(0, MAX_WECHAT_OUTBOUND_MEDIA),
  };
}

/** @param {string} p */
function isWechatSendablePath(p) {
  const s = String(p ?? "").trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) {
    if (isLikelyRemoteImageUrl(s)) return true;
    return SENDABLE_FILE_EXT.test(s.split("?")[0] || s);
  }
  return SENDABLE_FILE_EXT.test(s) || SENDABLE_FILE_EXT.test(extOfFilename(s) ? `x${extOfFilename(s)}` : s);
}

/** Prefer workspace copies over chat-log originals when basename matches. */
function workspacePathScore(p) {
  const lower = String(p).replace(/\\/g, "/").toLowerCase();
  let score = 0;
  if (lower.includes("workspace")) score += 120;
  if (lower.includes("/.openclaw")) score += 80;
  if (/^[a-z]:\//i.test(lower)) score += 20;
  return score;
}

/**
 * @param {Map<string, { path: string; label: string; score: number }>} byLabel
 * @param {string} rawPath
 * @param {string} [preferredLabel]
 */
function upsertMediaPath(byLabel, rawPath, preferredLabel) {
  const path = String(rawPath ?? "").trim();
  if (!path || !isWechatSendablePath(path)) return;
  const label = String(preferredLabel ?? "").trim() || labelFromMediaPath(path);
  const key = /^https?:\/\//i.test(path) ? `url:${path.toLowerCase()}` : label.toLowerCase();
  const prev = byLabel.get(key);
  const next = { path, label, score: workspacePathScore(path) };
  if (!prev || next.score > prev.score) byLabel.set(key, next);
}

/**
 * Bare filenames like `report.md` (no directory) — resolved in workspace at send time.
 * @param {string} text
 * @returns {string[]}
 */
function scrapeBareFilenamesFromText(text) {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  /** @type {Set<string>} */
  const found = new Set();
  /** @param {string} raw */
  const add = (raw) => {
    const name = String(raw ?? "")
      .trim()
      .replace(/^[\s>*#\-([（【'"`]+/, "")
      .replace(/[\s>*#\-)\]）】'"`.]+$/, "");
    if (!name || /[\\/]/.test(name)) return;
    if (!isWechatSendablePath(name)) return;
    found.add(name);
  };

  const trimmed = t.trim();
  if (!trimmed.includes("\n") && isWechatSendablePath(trimmed) && !/[\\/]/.test(trimmed)) {
    add(trimmed);
  }

  const lines = t.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(-3)) {
    add(line);
    const bold = line.match(/^\*\*([^*]+)\*\*$/);
    if (bold) add(bold[1]);
    const inline = line.match(/`([^`\n]+)`/);
    if (inline) add(inline[1]);
  }

  const re = /(?:^|[\s(（【>])((?:[^\s/\\:*?"<>|]{1,240})\.(?:md|markdown|pdf|docx?|xlsx?|pptx?|txt|csv|png|jpe?g|gif|webp|zip|7z|json|html?|xml|yaml|yml))(?=$|[\s)）】])/gim;
  let m;
  while ((m = re.exec(t)) !== null) add(m[1]);

  const names = [...found].sort((a, b) => b.length - a.length);
  /** @type {string[]} */
  const deduped = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (deduped.some((k) => k.toLowerCase().endsWith(lower) && k.length > name.length)) continue;
    deduped.push(name);
  }
  return deduped;
}

/**
 * @param {unknown[]} toolTrace
 */
function collectToolTraceMediaPaths(toolTrace) {
  if (!Array.isArray(toolTrace) || toolTrace.length === 0) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  /** @param {string} p */
  const add = (p) => {
    const x = String(p ?? "").trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };

  for (const row of toolTrace) {
    if (!row || typeof row !== "object") continue;
    const rec = /** @type {Record<string, unknown>} */ (row);
    const toolName = String(rec.toolName ?? "").toLowerCase();
    const args =
      rec.args && typeof rec.args === "object"
        ? /** @type {Record<string, unknown>} */ (rec.args)
        : null;

    if (args) {
      for (const key of TOOL_TRACE_ARG_KEYS) {
        const raw = typeof args[key] === "string" ? args[key].trim() : "";
        if (raw) {
          if (/^https?:\/\//i.test(raw)) add(raw);
          else {
            for (const p of scrapeArtifactPathsFromText(raw)) add(p);
            if (isWechatSendablePath(raw) && !/[\\/]/.test(raw)) add(raw);
          }
        }
      }
    }

    for (const field of TOOL_TRACE_TEXT_FIELDS) {
      const txt = typeof rec[field] === "string" ? rec[field] : "";
      for (const p of scrapeArtifactPathsFromText(txt)) add(p);
      for (const name of scrapeBareFilenamesFromText(txt)) add(name);
    }

    if (/(^message$|message[_-]?tool|send[_-]?message)/.test(toolName) && args) {
      for (const key of ["media", "mediaUrl", "media_url", "file", "file_path", "path"]) {
        const raw = typeof args[key] === "string" ? args[key].trim() : "";
        if (raw) add(raw);
      }
    }
  }
  return out;
}

/**
 * @param {string} a
 * @param {string} b
 */
function pathSortKey(a, b) {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const aImg = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(aLower);
  const bImg = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(bLower);
  if (aImg !== bImg) return aImg ? -1 : 1;
  return workspacePathScore(b) - workspacePathScore(a) || aLower.localeCompare(bLower);
}

/**
 * Pick local / remote media paths to push back to WeChat after an assistant turn.
 * @param {{
 *   id?: string;
 *   role?: string;
 *   content?: string;
 *   toolTrace?: unknown[];
 * }} assistantMessage
 * @returns {Array<{ path: string; label: string }>}
 */
export function pickWechatOutboundMedia(assistantMessage) {
  if (!assistantMessage || assistantMessage.role !== "assistant") return [];

  /** @type {Map<string, { path: string; label: string; score: number }>} */
  const byLabel = new Map();

  for (const artifact of collectMessageArtifacts(assistantMessage)) {
    if (artifact.op === "viewed") continue;
    upsertMediaPath(byLabel, artifact.path);
  }

  for (const p of collectToolTraceMediaPaths(
    Array.isArray(assistantMessage.toolTrace) ? assistantMessage.toolTrace : [],
  )) {
    upsertMediaPath(byLabel, p);
  }

  for (const p of scrapeArtifactPathsFromText(String(assistantMessage.content ?? ""))) {
    upsertMediaPath(byLabel, p);
  }

  for (const name of scrapeBareFilenamesFromText(String(assistantMessage.content ?? ""))) {
    upsertMediaPath(byLabel, name);
  }

  const content = String(assistantMessage.content ?? "");
  for (const img of extractAllMarkdownImages(content)) {
    upsertMediaPath(byLabel, img.src, img.alt);
  }
  for (const url of scrapeBareImageUrlsFromText(content)) {
    upsertMediaPath(byLabel, url);
  }

  return [...byLabel.values()]
    .sort((a, b) => pathSortKey(a.path, b.path))
    .slice(0, MAX_WECHAT_OUTBOUND_MEDIA)
    .map(({ path, label }) => ({ path, label }));
}

/**
 * Chat Lab stored body: short intro + markdown gallery (not sent as WeChat text).
 * @param {string} replyText
 * @param {Array<{ path: string; label: string }>} mediaItems
 */
export function buildWechatStoredAssistantContent(replyText, mediaItems) {
  const intro = composeWechatReplyText(replyText, mediaItems) || stripWechatReplyText(replyText);
  /** @type {string[]} */
  const galleryLines = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of mediaItems) {
    const path = String(item.path ?? "").trim();
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (/^https?:\/\//i.test(path)) {
      const alt = String(item.label ?? "").trim() || "image";
      galleryLines.push(`![${alt}](${path})`);
    }
  }
  if (!galleryLines.length) return intro || String(replyText ?? "").trim();
  const gallery = galleryLines.join("\n\n");
  return intro ? `${intro}\n\n${gallery}` : gallery;
}

/**
 * @param {string} replyText
 * @param {Array<{ path: string; label: string }>} mediaToSend
 * @returns {string}
 */
export function composeWechatReplyText(replyText, mediaToSend) {
  let trimmed = stripWechatReplyText(replyText);
  if (!trimmed) return "";
  if (!mediaToSend.length) return trimmed;

  const labels = new Set(mediaToSend.map((m) => m.label.toLowerCase()));
  if (labels.has(trimmed.toLowerCase())) return "";
  if (
    mediaToSend.some(
      (m) =>
        trimmed === m.path ||
        trimmed.endsWith(`\\${m.label}`) ||
        trimmed.endsWith(`/${m.label}`) ||
        trimmed.toLowerCase() === m.label.toLowerCase(),
    )
  ) {
    return "";
  }

  if (mediaToSend.length > 0 && trimmed.length > 500) {
    trimmed = trimmed.slice(0, 500).trim();
  }
  return trimmed;
}

/**
 * @param {Array<{ path: string; label: string }>} mediaToSend
 * @returns {import("./chatSessionsStore.js").PersistedFileRef[]}
 */
export function wechatMediaToFileRefs(mediaToSend) {
  if (!Array.isArray(mediaToSend) || mediaToSend.length === 0) return [];
  return mediaToSend.map((item) => ({
    path: item.path,
    name: item.label,
    kind: /** @type {const} */ ("file"),
  }));
}

/**
 * @param {{
 *   statLocalPath?: (p: string) => Promise<{ exists?: boolean; isFile?: boolean }>;
 *   resolveWechatMediaPath?: (p: string) => Promise<{ ok?: boolean; filePath?: string }>;
 * }} bridge
 * @param {Array<{ path: string; label: string }>} items
 */
export async function filterExistingWechatMedia(bridge, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  /** @type {Array<{ path: string; label: string }>} */
  const out = [];
  for (const item of items) {
    const path = String(item.path ?? "").trim();
    if (!path) continue;
    if (/^https?:\/\//i.test(path)) {
      out.push(item);
      continue;
    }
    try {
      const st = await bridge.statLocalPath?.(path);
      if (st?.exists && st?.isFile) {
        out.push(item);
        continue;
      }
    } catch {
      /* try workspace resolve */
    }
    try {
      const resolved = await bridge.resolveWechatMediaPath?.(path);
      if (resolved?.ok && resolved.filePath) {
        out.push({ path: resolved.filePath, label: item.label });
      }
    } catch {
      /* skip missing path */
    }
  }
  return out;
}
