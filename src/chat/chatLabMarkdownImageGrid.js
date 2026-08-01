/** @typedef {{ alt: string; src: string }} MarkdownImageRef */
/** @typedef {import("./chatLabAsciiTree.js").AsciiTreeNode} AsciiTreeNode */

import { normalizeLatexMathDelimitersForRemark } from "./normalizeLatexMathDelimitersForRemark.js";
import { repairChartCodeFences } from "./chatLabMarkdownChartFenceRepair.js";
import { repairHtmlMarkdownForRender } from "./chatLabMarkdownHtmlFenceRepair.js";
import { repairGfmMarkdownTables } from "./chatLabMarkdownTableRepair.js";
import {
  isAsciiTreeLine,
  isBlankOrBlockquoteSeparator,
  isMarkdownBlockquoteLine,
  looksLikeAsciiTreeText,
  normalizeAsciiTreeLine,
  parseAsciiTree,
  stripMarkdownBlockquotePrefix,
} from "./chatLabAsciiTree.js";

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
 * @typedef {{
 *   kind: "prose";
 *   body: string;
 * } | {
 *   kind: "gallery";
 *   images: MarkdownImageRef[];
 * } | {
 *   kind: "tree";
 *   body: string;
 *   tree: AsciiTreeNode;
 * } | {
 *   kind: "html";
 *   body: string;
 * }} MarkdownContentBlock
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
 * @param {string[]} lines
 * @param {number} fromIdx
 */
function nextAsciiTreeLine(lines, fromIdx) {
  for (let i = fromIdx; i < lines.length; i++) {
    const raw = lines[i];
    if (!String(raw ?? "").trim()) continue;
    if (isAsciiTreeLine(raw)) return raw;
    return null;
  }
  return null;
}

/**
 * @param {string} line
 * @param {string | null} openDelim
 * @returns {{ nextDelim: string | null; isFenceLine: boolean }}
 */
function stepFenceState(line, openDelim) {
  const trimmed = String(line ?? "").trim();
  const m = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if (!m) return { nextDelim: openDelim, isFenceLine: false };

  const delim = m[1];
  const info = (m[2] ?? "").trim();

  if (!openDelim) {
    return { nextDelim: delim, isFenceLine: true };
  }

  if (delim[0] !== openDelim[0] || delim.length < openDelim.length || info !== "") {
    return { nextDelim: openDelim, isFenceLine: false };
  }

  return { nextDelim: null, isFenceLine: true };
}

/**
 * @param {string} line
 */
function spilloverBlockquoteContent(line) {
  if (!isMarkdownBlockquoteLine(line)) return "";
  return stripMarkdownBlockquotePrefix(line).trim();
}

/**
 * @param {string} content
 */
function isSpilloverBlockquoteContent(content) {
  if (!content) return false;
  return (
    /^#{1,6}\s/.test(content) ||
    /^---+$/.test(content) ||
    /^[-*+]\s/.test(content) ||
    /^\d+\.\s/.test(content)
  );
}

/**
 * @param {string} body
 */
function proseBlockStartsWithSpilloverBlockquote(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    if (!isMarkdownBlockquoteLine(line)) return false;
    return isSpilloverBlockquoteContent(spilloverBlockquoteContent(line));
  }
  return false;
}

/**
 * @param {string} body
 */
function unwrapSpilloverBlockquoteBody(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  let consecutiveNormal = 0;
  /** @type {string[]} */
  const out = [];

  for (const line of lines) {
    const raw = String(line ?? "");
    const trimmed = raw.trim();

    if (consecutiveNormal >= 2) {
      out.push(raw);
      continue;
    }

    if (isMarkdownBlockquoteLine(raw)) {
      consecutiveNormal = 0;
      out.push(trimmed === ">" ? "" : stripMarkdownBlockquotePrefix(raw));
      continue;
    }

    out.push(raw);
    if (trimmed) consecutiveNormal += 1;
  }

  return out.join("\n");
}

/**
 * @param {MarkdownContentBlock[]} blocks
 */
function postProcessMarkdownBlocks(blocks) {
  let afterTree = false;

  for (const block of blocks) {
    if (block.kind === "tree") {
      afterTree = true;
      continue;
    }
    if (block.kind !== "prose") continue;

    if (afterTree || proseBlockStartsWithSpilloverBlockquote(block.body)) {
      block.body = unwrapSpilloverBlockquoteBody(block.body);
    }
  }

  return blocks;
}

export function segmentMarkdownContentBlocks(source, options = {}) {
  const renderDirectoryTrees = options.renderDirectoryTrees !== false;
  const repaired = repairHtmlMarkdownForRender(String(source ?? ""), options);
  const lines = repaired.split(/\r?\n/);
  /** @type {MarkdownContentBlock[]} */
  const blocks = [];
  /** @type {string[]} */
  let proseBuf = [];
  /** @type {MarkdownImageRef[]} */
  let imageBuf = [];
  /** @type {string[]} */
  let treeBuf = [];
  /** @type {string | null} */
  let fenceDelim = null;
  let inHtmlFence = false;
  /** @type {string[]} */
  let htmlBuf = [];

  const HTML_FENCE_OPEN_RE = /^```html\b/i;
  const FENCE_CLOSE_RE = /^```\s*$/;

  /** @param {string} line */
  const pushProseLine = (line) => {
    proseBuf.push(line);
  };

  const flushProse = () => {
    const body = proseBuf.join("\n").trim();
    if (body) blocks.push({ kind: "prose", body: proseBuf.join("\n") });
    proseBuf = [];
  };
  const flushHtml = () => {
    if (!inHtmlFence) return;
    const body = htmlBuf.join("\n").trim();
    if (body) blocks.push({ kind: "html", body: htmlBuf.join("\n") });
    htmlBuf = [];
    inHtmlFence = false;
  };
  const flushImages = () => {
    if (imageBuf.length) blocks.push({ kind: "gallery", images: [...imageBuf] });
    imageBuf = [];
  };
  const flushTree = () => {
    if (!treeBuf.length) return;
    const treeLines = [...treeBuf];
    treeBuf = [];
    const body = treeLines.join("\n").trim();
    if (!body) return;
    if (!looksLikeAsciiTreeText(body)) {
      for (const line of treeLines) pushProseLine(line);
      return;
    }
    const tree = parseAsciiTree(body);
    if (tree) blocks.push({ kind: "tree", body, tree });
    else for (const line of treeLines) pushProseLine(line);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = String(line ?? "").trim();

    if (inHtmlFence) {
      if (FENCE_CLOSE_RE.test(trimmed)) {
        flushHtml();
        continue;
      }
      htmlBuf.push(line);
      continue;
    }

    if (!fenceDelim && HTML_FENCE_OPEN_RE.test(trimmed)) {
      if (treeBuf.length) flushTree();
      flushProse();
      flushImages();
      inHtmlFence = true;
      htmlBuf = [];
      continue;
    }

    const fenceStep = stepFenceState(line, fenceDelim);
    if (fenceStep.isFenceLine) {
      if (treeBuf.length) flushTree();
      pushProseLine(line);
      fenceDelim = fenceStep.nextDelim;
      continue;
    }
    if (fenceDelim) {
      pushProseLine(line);
      continue;
    }
    if (renderDirectoryTrees && isAsciiTreeLine(line)) {
      flushProse();
      flushImages();
      treeBuf.push(normalizeAsciiTreeLine(line));
      continue;
    }
    if (renderDirectoryTrees && treeBuf.length) {
      if (isBlankOrBlockquoteSeparator(line)) {
        const nextTree = nextAsciiTreeLine(lines, i + 1);
        if (nextTree) continue;
        flushTree();
        if (!String(line ?? "").trim()) pushProseLine(line);
        continue;
      }
      flushTree();
    }
    if (!String(line ?? "").trim()) {
      if (imageBuf.length) {
        const nextLine = nextNonEmptyLine(lines, i + 1);
        if (nextLine && isImageOnlyLine(nextLine)) continue;
        flushImages();
      } else {
        pushProseLine(line);
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
    pushProseLine(line);
  }

  flushProse();
  flushHtml();
  flushImages();
  if (renderDirectoryTrees) flushTree();
  return mergeAdjacentGalleryBlocks(postProcessMarkdownBlocks(blocks));
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
  let text = prepareChatLabMarkdownSource(source);
  text = repairChartCodeFences(text);
  text = repairGfmMarkdownTables(text);
  return normalizeLatexMathDelimitersForRemark(text);
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