/** @typedef {{ alt: string; src: string }} MarkdownImageRef */

import { normalizeLatexMathDelimitersForRemark } from "./normalizeLatexMathDelimitersForRemark.js";

const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const MARKDOWN_IMAGE_INLINE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+(?:\([^)]*\))?[^)\s]*)\s*(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMG_SRC_RE = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;

/**
 * @param {string} raw
 */
function normalizeImageSrc(raw) {
  return String(raw ?? "").trim().replace(/^<|>$/g, "");
}

/**
 * @param {Map<string, MarkdownImageRef>} bySrc
 * @param {string} src
 * @param {string} [alt]
 */
function pushImage(bySrc, src, alt = "") {
  const normalized = normalizeImageSrc(src);
  if (!normalized || /^data:/i.test(normalized)) return;
  if (!bySrc.has(normalized)) {
    bySrc.set(normalized, { alt: String(alt ?? ""), src: normalized });
  }
}

/**
 * Match `![alt](url)` anywhere in assistant output (line, inline, or wrapped).
 * @param {string} source
 * @returns {MarkdownImageRef[]}
 */
export function extractAllMarkdownImages(source) {
  const text = String(source ?? "");
  /** @type {Map<string, MarkdownImageRef>} */
  const bySrc = new Map();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lineMatch = IMAGE_LINE_RE.exec(trimmed);
    if (lineMatch) {
      pushImage(bySrc, lineMatch[2], lineMatch[1]);
    }
  }

  MARKDOWN_IMAGE_INLINE_RE.lastIndex = 0;
  let m;
  while ((m = MARKDOWN_IMAGE_INLINE_RE.exec(text)) !== null) {
    pushImage(bySrc, m[2], m[1]);
  }

  HTML_IMG_SRC_RE.lastIndex = 0;
  while ((m = HTML_IMG_SRC_RE.exec(text)) !== null) {
    pushImage(bySrc, m[1], "");
  }

  return [...bySrc.values()];
}

/**
 * Remove markdown/HTML image syntax so prose render does not duplicate thumbnails.
 * @param {string} source
 */
export function stripMarkdownImages(source) {
  let text = String(source ?? "");
  text = text.replace(/^\s*!\[[^\]]*\]\([^)]+\)\s*$/gm, "");
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  text = text.replace(/<img\b[^>]*>/gi, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * @typedef {{ kind: "prose"; body: string } | { kind: "gallery"; images: MarkdownImageRef[] }} MarkdownContentBlock
 */

/**
 * @param {string} line
 * @returns {MarkdownImageRef | null}
 */
function imageFromLine(line) {
  const m = IMAGE_LINE_RE.exec(String(line ?? "").trim());
  if (!m) return null;
  return { alt: m[1] ?? "", src: normalizeImageSrc(m[2]) };
}

/**
 * @param {string} line
 */
function isImageOnlyLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return false;
  if (imageFromLine(trimmed)?.src) return true;
  const inline = extractAllMarkdownImages(trimmed);
  return inline.length > 0 && stripMarkdownImages(trimmed) === "";
}

/**
 * @param {string[]} lines
 * @param {number} fromIdx
 */
function nextNonEmptyLine(lines, fromIdx) {
  for (let i = fromIdx; i < lines.length; i++) {
    const trimmed = String(lines[i] ?? "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * @param {MarkdownContentBlock[]} blocks
 * @returns {MarkdownContentBlock[]}
 */
function mergeAdjacentGalleryBlocks(blocks) {
  /** @type {MarkdownContentBlock[]} */
  const out = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (block.kind === "gallery" && prev?.kind === "gallery") {
      prev.images.push(...block.images);
      continue;
    }
    out.push(block);
  }
  return out;
}

/**
 * Split one markdown blob into alternating prose + image gallery blocks (order preserved).
 * @param {string} source
 * @returns {MarkdownContentBlock[]}
 */
export function segmentMarkdownContentBlocks(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  /** @type {MarkdownContentBlock[]} */
  const blocks = [];
  /** @type {string[]} */
  let proseBuf = [];
  /** @type {MarkdownImageRef[]} */
  let imageBuf = [];

  const flushProse = () => {
    const body = proseBuf.join("\n").trim();
    if (body) blocks.push({ kind: "prose", body: proseBuf.join("\n") });
    proseBuf = [];
  };
  const flushImages = () => {
    if (imageBuf.length) blocks.push({ kind: "gallery", images: [...imageBuf] });
    imageBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!String(line ?? "").trim()) {
      if (imageBuf.length) {
        const nextLine = nextNonEmptyLine(lines, i + 1);
        if (nextLine && isImageOnlyLine(nextLine)) continue;
        flushImages();
      } else {
        proseBuf.push(line);
      }
      continue;
    }
    const img = imageFromLine(line);
    if (img?.src) {
      flushProse();
      imageBuf.push(img);
      continue;
    }
    const inline = extractAllMarkdownImages(line);
    if (inline.length > 0 && stripMarkdownImages(line) === "") {
      flushProse();
      imageBuf.push(...inline);
      continue;
    }
    flushImages();
    proseBuf.push(line);
  }

  flushProse();
  flushImages();
  return mergeAdjacentGalleryBlocks(blocks);
}

/**
 * @param {string} text
 */
export function isImageOnlyMarkdown(text) {
  return extractAllMarkdownImages(text).length > 0 && !stripMarkdownImages(text);
}

/**
 * @param {string} source
 */
export function prepareChatLabMarkdownSource(source) {
  return String(source ?? "");
}

/**
 * @param {string} source
 */
export function prepareChatLabMarkdownForRender(source) {
  return normalizeLatexMathDelimitersForRemark(prepareChatLabMarkdownSource(source));
}

/**
 * @param {{ kind?: string }} part
 */
function isTimelineGapPart(part) {
  return part?.kind === "toolActivityGap" || part?.kind === "thinking";
}

/**
 * Merge image-only timeline text segments separated only by tool/thinking gaps.
 * Prose text blocks act as delimiters between distinct photo groups.
 * @template {{ kind: string; body?: string; key: string }} T
 * @param {T[]} parts
 * @returns {T[]}
 */
export function coalesceImageOnlyTextParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;

  /** @type {T[]} */
  const out = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part?.kind !== "text" || !isImageOnlyMarkdown(part.body)) {
      out.push(part);
      i++;
      continue;
    }

    /** @type {string[]} */
    const bodies = [String(part.body ?? "")];
    let j = i + 1;
    while (j < parts.length) {
      const next = parts[j];
      if (isTimelineGapPart(next)) {
        j++;
        continue;
      }
      if (next?.kind === "text" && isImageOnlyMarkdown(next.body)) {
        bodies.push(String(next.body ?? ""));
        j++;
        continue;
      }
      break;
    }

    if (bodies.length > 1) {
      out.push({ ...part, body: bodies.join("\n\n") });
    } else {
      out.push(part);
    }
    i = j;
  }
  return out;
}