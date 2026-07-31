import { analyzeHtmlFenceBody } from "./chatLabHtmlFenceBody.js";

/** Default iframe placeholder before first measure (matches CSS min-height). */
export const HTML_FENCE_DEFAULT_RESERVED_PX = 120;

/** Fixed layout height when HTML is structurally invalid or iframe render fails. */
export const HTML_FENCE_ERROR_RESERVED_PX = 100;

/** Extra chrome above the iframe (embed toolbar + margins). */
export const HTML_FENCE_EMBED_CHROME_PX = 36;

const HEIGHT_COMMENT_RE = /<!--\s*openstudio-embed-height:\s*(\d+(?:\.\d+)?)\s*-->/i;
const HEIGHT_META_RE =
  /<meta\b[^>]*\bname=["']openstudio-embed-height["'][^>]*\bcontent=["'](\d+(?:\.\d+)?)["'][^>]*>/i;
const HEIGHT_META_RE_ALT =
  /<meta\b[^>]*\bcontent=["'](\d+(?:\.\d+)?)["'][^>]*\bname=["']openstudio-embed-height["'][^>]*>/i;
const HEIGHT_DATA_RE = /\bdata-os-embed-height=["'](\d+(?:\.\d+)?)["']/i;

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
export function normalizeHtmlFenceHeightPx(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(8000, Math.max(1, Math.round(n)));
}

/**
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractHtmlFenceBodiesFromMarkdown(markdown) {
  const text = String(markdown ?? "");
  /** @type {string[]} */
  const bodies = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  /** @type {string[]} */
  let buf = [];
  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!inFence && /^```html\b/i.test(trimmed)) {
      inFence = true;
      buf = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(trimmed)) {
      const body = buf.join("\n").trim();
      if (body) bodies.push(body);
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  if (inFence && buf.length) {
    const body = buf.join("\n").trim();
    if (body) bodies.push(body);
  }
  return bodies;
}

/**
 * Parse optional model-provided embed height from HTML body.
 * @param {string} htmlBody
 * @returns {number | null}
 */
export function parseHtmlFenceHeightHint(htmlBody) {
  const text = String(htmlBody ?? "");
  for (const re of [HEIGHT_COMMENT_RE, HEIGHT_META_RE, HEIGHT_META_RE_ALT, HEIGHT_DATA_RE]) {
    const m = re.exec(text);
    if (m) {
      const px = normalizeHtmlFenceHeightPx(m[1]);
      if (px) return px;
    }
  }
  return null;
}

/**
 * True when every ```html``` fence in markdown has a persisted measured height.
 * @param {string} markdown
 * @param {Record<string, number> | null | undefined} stored
 */
export function htmlFenceHeightsCompleteForMarkdown(markdown, stored) {
  const bodies = extractHtmlFenceBodiesFromMarkdown(markdown);
  if (!bodies.length) return true;
  return bodies.every((_, i) => Boolean(normalizeHtmlFenceHeightPx(stored?.[String(i)])));
}

/**
 * @param {string} htmlBody
 * @param {Record<string, number> | null | undefined} stored
 * @param {number} blockIndex
 * @param {{ allowHint?: boolean }} [options]
 */
export function resolveHtmlFenceReservedHeight(htmlBody, stored, blockIndex, options = {}) {
  const allowHint = options.allowHint !== false;
  const key = String(blockIndex);
  const saved = normalizeHtmlFenceHeightPx(stored?.[key]);
  if (saved) return saved;
  if (allowHint) {
    const hinted = parseHtmlFenceHeightHint(htmlBody);
    if (hinted) return hinted;
  }
  const analysis = analyzeHtmlFenceBody(htmlBody);
  if (!analysis.empty && !analysis.ok) return HTML_FENCE_ERROR_RESERVED_PX;
  return HTML_FENCE_DEFAULT_RESERVED_PX;
}

/**
 * Extra layout height for virtual row estimates (stored/hinted iframe minus prose char estimate).
 * @param {string} markdown
 * @param {Record<string, number> | null | undefined} [stored]
 */
export function estimateHtmlFenceLayoutExtra(markdown, stored) {
  const bodies = extractHtmlFenceBodiesFromMarkdown(markdown);
  let extra = 0;
  bodies.forEach((body, i) => {
    const reserved = resolveHtmlFenceReservedHeight(body, stored, i);
    const proseEstimate = Math.min(360, Math.ceil(body.length / 2.6));
    extra += Math.max(0, reserved + HTML_FENCE_EMBED_CHROME_PX - proseEstimate);
  });
  return extra;
}

/**
 * @param {Record<string, number> | null | undefined} heights
 * @param {number} blockIndex
 * @param {number} height
 * @returns {Record<string, number> | null}
 */
export function mergeHtmlFenceHeight(heights, blockIndex, height) {
  const px = normalizeHtmlFenceHeightPx(height);
  if (!px) return heights ?? null;
  const key = String(blockIndex);
  const prev = heights?.[key];
  if (prev === px) return null;
  return { ...(heights ?? {}), [key]: px };
}

/**
 * @param {Record<string, unknown> | null | undefined} heights
 * @returns {Record<string, number> | undefined}
 */
export function sanitizeHtmlFenceHeights(heights) {
  if (!heights || typeof heights !== "object") return undefined;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, val] of Object.entries(heights)) {
    const px = normalizeHtmlFenceHeightPx(val);
    if (px) out[String(key)] = px;
  }
  return Object.keys(out).length ? out : undefined;
}
