/**
 * Detect URLs and local file paths in chat text selections for the selection toolbar.
 */

import { hasPreviewableFileExtension } from "./chatLabDocumentPreview.js";

/**
 * Strip wrapping quotes and trailing sentence punctuation from a selection.
 * @param {string} text
 */
export function trimSelectionAddress(text) {
  let s = String(text ?? "").trim();
  s = s.replace(/^[「『"'（(\[]+/, "").replace(/[」』"'）)\].,;:!?]+$/, "");
  return s.trim();
}

/** @param {string} path */
export function trimPathTrailingPunctuation(path) {
  return String(path ?? "").replace(/[.,;:!?)」』"'`\uFF09\uFF3D\u3011]+$/u, "");
}

/**
 * Slash-led strings need at least one path-like ASCII segment or a file extension.
 * Models often write Chinese "or" lists (`点击/输入/滚动`) that are not file paths.
 * @param {string} raw
 */
function looksLikeUnixLocalPath(raw) {
  const segments = String(raw ?? "")
    .split("/")
    .filter(Boolean);
  if (!segments.length) return false;
  if (/\.[a-zA-Z0-9]{1,8}$/.test(raw)) return true;
  if (segments.length < 2) return false;
  return segments.some((seg) => /[a-zA-Z0-9._-]/.test(seg));
}

/**
 * @param {string} text
 * @returns {{ kind: "url"; href: string } | { kind: "local"; path: string } | null}
 */
export function classifySelectionAddress(text) {
  const raw = trimSelectionAddress(text);
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      return { kind: "url", href: new URL(raw).href };
    } catch {
      return null;
    }
  }

  if (/^www\./i.test(raw)) {
    try {
      return { kind: "url", href: new URL(`https://${raw}`).href };
    } catch {
      return null;
    }
  }

  if (/^file:\/\//i.test(raw)) {
    return { kind: "local", path: raw };
  }

  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(raw)) {
    return { kind: "local", path: raw };
  }

  if (raw.startsWith("/") && !raw.startsWith("//") && looksLikeUnixLocalPath(raw)) {
    return { kind: "local", path: raw };
  }

  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) {
    return { kind: "local", path: raw };
  }

  if (hasPreviewableFileExtension(raw) && /^(?:[\w.\-]+[\\/])+[\w.\-]+$/.test(raw)) {
    return { kind: "local", path: raw };
  }

  return null;
}

/**
 * @param {string} text
 * @returns {{ start: number; end: number; path: string }[]}
 */
export function findLocalPathSpansInText(text) {
  const s = String(text ?? "");
  if (!s) return [];

  /** @type {{ start: number; end: number; path: string }[]} */
  const raw = [];

  const pathChars = String.raw`[^\s<>"'|*?，。；：！？、（）]+`;
  const patterns = [
    /file:\/\/[^\s<>"'|*?，。；：！？、]+/gi,
    /(?:[a-zA-Z]:[\\/]|\\\\)[^\s<>"'|*?，。；：！？、]+/g,
    /~(?:[\\/][^\s<>"'|*?，。；：！？、]+)?/g,
    new RegExp(String.raw`\/(?:${pathChars}\/)*${pathChars}`, "g"),
    /(?:[\w.\-]+[\\/])+[\w.\-]+\.(?:html|htm|pdf|svg|csv|xlsx|xls|pptx|ppt)\b/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const start = m.index;
      if (m[0].startsWith("/") && start > 0 && s[start - 1] === ":") continue;
      const path = trimPathTrailingPunctuation(m[0]);
      if (!path || classifySelectionAddress(path)?.kind !== "local") continue;
      raw.push({ start, end: start + path.length, path });
    }
  }

  if (!raw.length) return [];

  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  /** @type {{ start: number; end: number; path: string }[]} */
  const merged = [];
  for (const span of raw) {
    const prev = merged[merged.length - 1];
    if (prev && span.start < prev.end) {
      if (span.end - span.start > prev.end - prev.start) merged[merged.length - 1] = span;
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/**
 * @param {string} path
 * @param {{ openFromWorkspacePath?: (path: string) => void | Promise<void> } | null | undefined} previewApi
 */
export function openChatLabLocalPath(path, previewApi) {
  const classified = classifySelectionAddress(path);
  if (!classified || classified.kind !== "local") return;

  const p = classified.path;
  const isAbsolute = /^(?:[a-zA-Z]:[\\/]|\\\\|file:|\/|~)/i.test(p);
  if (isAbsolute) {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (bridge?.revealLocalPath) void bridge.revealLocalPath(p);
    return;
  }
  if (previewApi?.openFromWorkspacePath) void previewApi.openFromWorkspacePath(p);
}
