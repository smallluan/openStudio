/** Shared helpers + protocol constants for the Chat Lab document preview iframe. */

export const CHAT_LAB_PREVIEW_MESSAGE_CHANNEL = "openstudio-preview";

/** @returns {string} */
export function newPreviewFrameKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pf_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

/** Mobile Safari UA for preview webview device emulation. */
export const PREVIEW_MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

/**
 * @param {string} href
 * @returns {"pdf"|"html"|"sheet"|"slides"|"blob"|"web"|null}
 */
export function previewKindFromHref(href) {
  const h = String(href ?? "").trim();
  if (!h) return null;
  if (/^blob:/i.test(h)) return "blob";
  if (/^data:application\/pdf/i.test(h)) return "pdf";
  if (/^data:text\/html/i.test(h)) return "html";

  let pathname = h;
  let protocol = "";
  try {
    const u = new URL(h, window.location.href);
    pathname = u.pathname;
    protocol = u.protocol;
  } catch {
    /* keep raw */
  }
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "sheet";
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) return "slides";
  if (protocol === "http:" || protocol === "https:") return "web";
  return null;
}

/**
 * @param {string} href
 * @returns {boolean}
 */
export function isPreviewInterceptableHref(href) {
  const h = String(href ?? "").trim();
  if (!h || h.startsWith("#") || /^javascript:/i.test(h)) return false;
  try {
    const u = new URL(h, window.location.href);
    if (u.origin === window.location.origin) {
      const path = u.pathname.toLowerCase();
      const inAppRoute =
        path === "/" ||
        path === "/chat" ||
        path === "/studio" ||
        path === "/lobster" ||
        path === "/skills" ||
        path.startsWith("/settings");
      if (inAppRoute) return false;
    }
  } catch {
    /* ignore */
  }
  return previewKindFromHref(h) != null;
}

/**
 * Loose filename / path check for workspace + dock pipeline.
 * @param {string} name
 */
export function hasPreviewableFileExtension(name) {
  return /\.(html|htm|pdf|svg|csv|xlsx|xls|pptx|ppt)$/i.test(String(name ?? "").trim());
}

/**
 * @param {string} href
 * @returns {string | null}
 */
export function absoluteHttpUrlMaybe(href) {
  try {
    const u = new URL(href, window.location.href);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Microsoft Office Online embed (requires a reachable HTTPS document URL in practice).
 * @param {string} fileHttpUrl
 * @returns {string | null}
 */
export function officeEmbedViewerUrl(fileHttpUrl) {
  if (!fileHttpUrl || !/^https:\/\//i.test(fileHttpUrl)) return null;
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileHttpUrl)}`;
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Best-effort CSV → HTML table for lightweight preview (no full RFC 4180 parser).
 * @param {string} csv
 * @returns {string} HTML document body inner HTML
 */
export function csvToHtmlDocument(csv) {
  const lines = String(csv ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>CSV</title></head><body><p>Empty</p></body></html>`;
  }
  const rows = lines.map((line) => line.split(",").map((c) => escapeHtmlText(c.trim())));
  const head = rows[0];
  const bodyRows = rows.slice(1);
  const th = head.map((c) => `<th>${c}</th>`).join("");
  const trs = bodyRows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>CSV</title><style>
    body{font-family:system-ui,sans-serif;margin:12px;background:var(--bg,#fff);color:var(--fg,#111)}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th,td{border:1px solid color-mix(in srgb, currentColor 22%, transparent);padding:6px 8px;text-align:left}
    th{background:color-mix(in srgb, currentColor 8%, transparent);font-weight:600}
  </style></head><body><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}

/**
 * Wrap raw SVG markup in a minimal HTML document for iframe srcDoc.
 * @param {string} svgSource
 */
export function svgToHtmlDocument(svgSource) {
  const trimmed = String(svgSource ?? "").trim();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>html,body{margin:0;height:100%;background:#f8fafc}svg{display:block;max-width:100%;height:auto}</style></head><body>${trimmed}</body></html>`;
}

/**
 * Wrap a loose HTML fragment (or full document) for iframe `srcDoc`.
 * @param {string} htmlInner
 * @returns {string}
 */
export function wrapLooseHtmlFragmentForSrcDoc(htmlInner) {
  const t = String(htmlInner ?? "").trim();
  if (!t) return "";
  if (/<!DOCTYPE|<\s*html[\s>]/i.test(t) || /<\s*body[\s>]/i.test(t)) return t;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${t}</body></html>`;
}

/**
 * Last ```html … ``` fence in markdown/plain text → full HTML document for `srcDoc`, or null.
 * @param {string} markdownText
 * @returns {string | null}
 */
export function lastHtmlFenceAsSrcDocDocument(markdownText) {
  const blocks = [...String(markdownText ?? "").matchAll(/```\s*html\s*\n?([\s\S]*?)```/gi)];
  if (!blocks.length) return null;
  const raw = blocks[blocks.length - 1][1].trim();
  if (!raw) return null;
  return wrapLooseHtmlFragmentForSrcDoc(raw);
}
