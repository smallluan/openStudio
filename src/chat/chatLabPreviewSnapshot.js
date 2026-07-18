import { readLinkOpenModeLocal } from "./chatLabLinkOpenPreference.js";

/** @typedef {{
 *   ref: string;
 *   tag: string;
 *   role: string;
 *   name: string;
 *   selector: string;
 *   placeholder?: string;
 *   href?: string;
 *   inputType?: string;
 * }} SidebarPreviewInteractiveElement */

/** @typedef {{
 *   ok: boolean;
 *   url: string;
 *   title: string;
 *   text: string;
 *   tabCount: number;
 *   elements?: SidebarPreviewInteractiveElement[];
 *   partial?: boolean;
 *   loginHint?: boolean;
 *   canvasHint?: boolean;
 *   error?: string;
 * }} SidebarPreviewSnapshot */

export const SIDEBAR_PREVIEW_TEXT_MAX = 8000;
export const SIDEBAR_PREVIEW_ELEMENTS_MAX = 60;

/**
 * Extract visible text + interactive element inventory from the active webview.
 * Returns a JSON string: `{ text, canvas, elements: [...] }`.
 */
const EXTRACT_PAGE_SCRIPT = `(function(){
  var TEXT_MAX = ${SIDEBAR_PREVIEW_TEXT_MAX};
  var EL_MAX = ${SIDEBAR_PREVIEW_ELEMENTS_MAX};
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    var st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }
  function visibleText(root) {
    var lines = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        var t = String(node.textContent || "").replace(/[ \\t\\f\\v]+/g, " ").trim();
        if (t) lines.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG") return;
      if (!isVisible(node)) return;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
    walk(root);
    return lines.join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  }
  function iframeTexts(doc, depth) {
    if (depth > 2) return [];
    var out = [];
    var frames = doc.querySelectorAll("iframe");
    for (var i = 0; i < frames.length; i++) {
      try {
        var fd = frames[i].contentDocument;
        if (fd && fd.body) {
          var ft = visibleText(fd.body);
          if (ft) out.push(ft);
          out = out.concat(iframeTexts(fd, depth + 1));
        }
      } catch (e) {}
    }
    return out;
  }
  function largeCanvasPresent() {
    var nodes = document.querySelectorAll("canvas");
    for (var i = 0; i < nodes.length; i++) {
      if (!isVisible(nodes[i])) continue;
      var r = nodes[i].getBoundingClientRect();
      if (r.width > 120 && r.height > 80) return true;
    }
    return false;
  }
  function cssEscape(value) {
    var s = String(value || "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }
  function shorten(s, n) {
    var t = String(s || "").replace(/\\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, Math.max(0, n - 1)) + "…";
  }
  function attr(el, name) {
    try { return String(el.getAttribute(name) || "").trim(); } catch (e) { return ""; }
  }
  function ownText(el) {
    var parts = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) {
        var t = String(n.textContent || "").replace(/\\s+/g, " ").trim();
        if (t) parts.push(t);
      }
    }
    return parts.join(" ").trim();
  }
  function accessibleName(el) {
    var labeled = attr(el, "aria-label");
    if (labeled) return labeled;
    var labelledBy = attr(el, "aria-labelledby");
    if (labelledBy) {
      var bits = [];
      labelledBy.split(/\\s+/).forEach(function(id) {
        var node = document.getElementById(id);
        if (node) bits.push(String(node.textContent || "").replace(/\\s+/g, " ").trim());
      });
      var joined = bits.filter(Boolean).join(" ").trim();
      if (joined) return joined;
    }
    var placeholder = attr(el, "placeholder");
    if (placeholder) return placeholder;
    var title = attr(el, "title");
    if (title) return title;
    var alt = attr(el, "alt");
    if (alt) return alt;
    var value = "";
    try { value = String(el.value || "").trim(); } catch (e) {}
    if (value && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON")) return value;
    var text = ownText(el) || String(el.textContent || "").replace(/\\s+/g, " ").trim();
    return text;
  }
  function uniqueSelector(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch (e) {
      return false;
    }
  }
  function buildSelector(el) {
    var tag = String(el.tagName || "").toLowerCase();
    var id = attr(el, "id");
    if (id && !/\\s/.test(id)) {
      var byId = "#" + cssEscape(id);
      if (uniqueSelector(byId)) return byId;
    }
    var testAttrs = ["data-testid", "data-test", "data-qa", "data-uba-title", "name"];
    for (var i = 0; i < testAttrs.length; i++) {
      var key = testAttrs[i];
      var val = attr(el, key);
      if (!val) continue;
      var sel = tag + "[" + key + "='" + val.replace(/'/g, "\\\\'") + "']";
      if (uniqueSelector(sel)) return sel;
    }
    var aria = attr(el, "aria-label");
    if (aria) {
      var ariaSel = tag + "[aria-label='" + aria.replace(/'/g, "\\\\'") + "']";
      if (uniqueSelector(ariaSel)) return ariaSel;
    }
    var ph = attr(el, "placeholder");
    if (ph) {
      var phSel = tag + "[placeholder='" + ph.replace(/'/g, "\\\\'") + "']";
      if (uniqueSelector(phSel)) return phSel;
    }
    var title = attr(el, "title");
    if (title) {
      var titleSel = tag + "[title='" + title.replace(/'/g, "\\\\'") + "']";
      if (uniqueSelector(titleSel)) return titleSel;
    }
    if (tag === "a") {
      var href = attr(el, "href");
      if (href && href.indexOf("javascript:") !== 0) {
        var hrefSel = "a[href='" + href.replace(/'/g, "\\\\'") + "']";
        if (uniqueSelector(hrefSel)) return hrefSel;
      }
    }
    var name = accessibleName(el);
    if (name && name.length >= 2 && name.length <= 48) {
      return tag + ":contains('" + name.replace(/'/g, "\\\\'") + "')";
    }
    return tag;
  }
  function collectInteractive(rootDoc) {
    var selector = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='searchbox']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='option']",
      "[role='combobox']",
      "[contenteditable='true']",
      "[tabindex]"
    ].join(",");
    var nodes = [];
    try { nodes = Array.prototype.slice.call(rootDoc.querySelectorAll(selector)); } catch (e) { nodes = []; }
    var out = [];
    var seen = {};
    for (var i = 0; i < nodes.length && out.length < EL_MAX; i++) {
      var el = nodes[i];
      if (!isVisible(el)) continue;
      var tag = String(el.tagName || "").toLowerCase();
      if (tag === "input") {
        var itype = String(el.type || "text").toLowerCase();
        if (itype === "hidden") continue;
      }
      var tabIndex = attr(el, "tabindex");
      if (tabIndex === "-1" && !attr(el, "role") && tag !== "a" && tag !== "button" && tag !== "input" && tag !== "textarea" && tag !== "select") {
        continue;
      }
      var role = attr(el, "role") || tag;
      var name = shorten(accessibleName(el), 80);
      var sel = buildSelector(el);
      var key = sel + "|" + role + "|" + name;
      if (seen[key]) continue;
      seen[key] = 1;
      var item = {
        ref: "e" + (out.length + 1),
        tag: tag,
        role: role,
        name: name,
        selector: sel
      };
      var placeholder = attr(el, "placeholder");
      if (placeholder) item.placeholder = shorten(placeholder, 60);
      if (tag === "a") {
        var href = attr(el, "href");
        if (href) item.href = shorten(href, 120);
      }
      if (tag === "input") {
        try { item.inputType = String(el.type || "text"); } catch (e) {}
      }
      out.push(item);
    }
    return out;
  }
  try {
    var bodyText = visibleText(document.body);
    var frameParts = iframeTexts(document, 0);
    var combined = [bodyText].concat(frameParts).filter(Boolean).join("\\n\\n").trim();
    var canvas = largeCanvasPresent();
    var elements = collectInteractive(document);
    return JSON.stringify({
      text: combined.slice(0, TEXT_MAX),
      canvas: canvas,
      elements: elements
    });
  } catch (e) {
    return JSON.stringify({ text: "", canvas: false, elements: [] });
  }
})()`;

/**
 * @param {string} text
 * @param {string} title
 */
function looksLikeLoginGate(text, title) {
  const blob = `${title}\n${text}`.toLowerCase();
  if (/\.xlsx|\.xls|\.csv|spreadsheet|excel|工单/.test(blob) && text.length > 400) return false;
  return /二维码|扫码登录|qr.?code|qrcode|请登录|sign in|log in|不在该链接所属|不在该租户|租户权限|tenant/.test(blob);
}

/**
 * @param {string} title
 * @param {string} url
 * @param {string} text
 */
function looksLikeSpreadsheetSurface(title, url, text) {
  const blob = `${title}\n${url}\n${text}`.toLowerCase();
  return (
    /\.xlsx|\.xls|\.csv|spreadsheet|excel|luckysheet|handsontable|sheetjs|wps/.test(blob) ||
    /\[meta:canvas-or-spreadsheet-ui\]/.test(text)
  );
}

/**
 * @param {HTMLElement | null} node
 * @returns {node is import("electron").WebviewTag}
 */
function isElectronWebview(node) {
  return Boolean(node && typeof /** @type {import("electron").WebviewTag} */ (node).executeJavaScript === "function");
}

/**
 * @param {unknown} raw
 * @returns {{ text: string; canvasHint: boolean; elements: SidebarPreviewInteractiveElement[] }}
 */
function normalizeExtractedPage(raw) {
  /** @type {SidebarPreviewInteractiveElement[]} */
  let elements = [];
  let text = "";
  let canvasHint = false;

  if (typeof raw === "object" && raw && !Array.isArray(raw)) {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    text = String(obj.text ?? "").trim();
    canvasHint = Boolean(obj.canvas);
    if (Array.isArray(obj.elements)) {
      elements = normalizeElements(obj.elements);
    }
    return { text, canvasHint, elements };
  }

  const blob = String(raw ?? "").trim();
  if (!blob) return { text: "", canvasHint: false, elements: [] };

  try {
    const parsed = JSON.parse(blob);
    if (parsed && typeof parsed === "object") {
      return normalizeExtractedPage(parsed);
    }
  } catch {
    /* plain text fallback from older extractors */
  }

  canvasHint = /\[meta:canvas-or-spreadsheet-ui\]\s*$/.test(blob);
  text = blob.replace(/\n?\[meta:canvas-or-spreadsheet-ui\]\s*$/, "").trim();
  return { text, canvasHint, elements };
}

/**
 * @param {unknown[]} rows
 * @returns {SidebarPreviewInteractiveElement[]}
 */
function normalizeElements(rows) {
  /** @type {SidebarPreviewInteractiveElement[]} */
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = /** @type {Record<string, unknown>} */ (row);
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    const selector = typeof item.selector === "string" ? item.selector.trim() : "";
    if (!ref || !selector) continue;
    /** @type {SidebarPreviewInteractiveElement} */
    const next = {
      ref,
      tag: typeof item.tag === "string" ? item.tag.trim() : "",
      role: typeof item.role === "string" ? item.role.trim() : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      selector,
    };
    if (typeof item.placeholder === "string" && item.placeholder.trim()) {
      next.placeholder = item.placeholder.trim();
    }
    if (typeof item.href === "string" && item.href.trim()) next.href = item.href.trim();
    if (typeof item.inputType === "string" && item.inputType.trim()) {
      next.inputType = item.inputType.trim();
    }
    out.push(next);
    if (out.length >= SIDEBAR_PREVIEW_ELEMENTS_MAX) break;
  }
  return out;
}

/**
 * @param {SidebarPreviewInteractiveElement[]} elements
 */
export function formatSidebarPreviewInventory(elements) {
  const list = Array.isArray(elements) ? elements : [];
  if (!list.length) return "";
  return list
    .map((el) => {
      const bits = [el.ref, el.role || el.tag || "el"];
      if (el.name) bits.push(`"${el.name}"`);
      bits.push(`selector=${el.selector}`);
      if (el.placeholder) bits.push(`placeholder=${el.placeholder}`);
      if (el.inputType) bits.push(`type=${el.inputType}`);
      if (el.href) bits.push(`href=${el.href}`);
      return bits.join(" | ");
    })
    .join("\n");
}

/**
 * @param {{
 *   session: { kind?: string; src?: string; title?: string; html?: string } | null;
 *   webviewRef?: import("react").RefObject<HTMLElement | null>;
 *   iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *   previewTabs?: Array<{ id: string; src: string; title: string }>;
 *   activePreviewTabId?: string;
 *   artifactsPanel?: unknown;
 *   forceSidebar?: boolean;
 * }} input
 * @returns {Promise<SidebarPreviewSnapshot | null>}
 */
export async function captureSidebarPreviewSnapshot(input) {
  if (!input.forceSidebar && readLinkOpenModeLocal() === "external") return null;
  if (input.artifactsPanel) return null;

  const session = input.session;
  if (!session || session.kind === "placeholder") return null;

  const tabs = Array.isArray(input.previewTabs) ? input.previewTabs : [];
  const activeTab =
    tabs.find((tab) => tab.id === input.activePreviewTabId) ?? tabs[tabs.length - 1] ?? null;

  /** @type {string} */
  let url = "";
  /** @type {string} */
  let title = "";
  /** @type {string} */
  let text = "";
  /** @type {SidebarPreviewInteractiveElement[]} */
  let elements = [];
  let partial = false;
  let canvasHint = false;

  const webviewNode = input.webviewRef?.current ?? null;
  if (session.kind === "iframe" && isElectronWebview(webviewNode)) {
    const wv = /** @type {import("electron").WebviewTag} */ (webviewNode);
    try {
      url = String(wv.getURL?.() ?? activeTab?.src ?? session.src ?? "").trim();
      title = String(wv.getTitle?.() ?? activeTab?.title ?? session.title ?? "").trim();
      const raw = await wv.executeJavaScript(EXTRACT_PAGE_SCRIPT, false);
      const parsed = normalizeExtractedPage(raw);
      text = parsed.text;
      canvasHint = parsed.canvasHint;
      elements = parsed.elements;
    } catch {
      url = String(activeTab?.src ?? session.src ?? "").trim();
      title = String(activeTab?.title ?? session.title ?? "").trim();
      partial = true;
    }
  } else if (session.kind === "srcdoc") {
    url = "srcdoc:preview";
    title = String(session.title ?? "").trim();
    const frame = input.iframeRef?.current;
    try {
      const doc = frame?.contentDocument;
      text = String(doc?.body?.innerText ?? doc?.body?.textContent ?? "")
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, SIDEBAR_PREVIEW_TEXT_MAX);
    } catch {
      partial = true;
    }
  } else if (session.kind === "iframe") {
    url = String(activeTab?.src ?? session.src ?? "").trim();
    title = String(activeTab?.title ?? session.title ?? "").trim();
    const frame = input.iframeRef?.current;
    try {
      const doc = frame?.contentDocument;
      if (doc?.body) {
        text = String(doc.body.innerText ?? doc.body.textContent ?? "")
          .replace(/\s+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, SIDEBAR_PREVIEW_TEXT_MAX);
      } else {
        partial = true;
      }
    } catch {
      partial = true;
    }
  } else {
    return null;
  }

  if (!url && !title) return null;

  const spreadsheetSurface = looksLikeSpreadsheetSurface(title, url, text);
  if (spreadsheetSurface || canvasHint) canvasHint = true;

  return {
    ok: true,
    url: url || activeTab?.src || "",
    title: title || url,
    text,
    tabCount: tabs.length || 1,
    ...(elements.length ? { elements } : {}),
    ...(partial ? { partial: true } : {}),
    ...(canvasHint ? { canvasHint: true } : {}),
    ...(looksLikeLoginGate(text, title) ? { loginHint: true } : {}),
  };
}

/**
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {SidebarPreviewSnapshot | null | undefined} snap
 * @param {{ webExploreMode?: boolean }} [opts]
 */
export function composeChatLabPreviewContextBlock(t, snap, opts = {}) {
  if (!snap?.url) return "";
  const keyRoot = opts.webExploreMode ? "webExploreChat.previewContext" : "chatLab.sidebarPreviewContext";
  const lines = [String(t(`${keyRoot}.header`) ?? "").trim()];
  lines.push(String(t(`${keyRoot}.methodNote`) ?? "").trim());
  lines.push(t(`${keyRoot}.url`, { url: snap.url }));
  if (snap.title) {
    lines.push(t(`${keyRoot}.title`, { title: snap.title }));
  }
  if (!opts.webExploreMode && snap.tabCount > 1) {
    lines.push(t(`${keyRoot}.tabCount`, { count: snap.tabCount }));
  }
  const inventory = formatSidebarPreviewInventory(snap.elements ?? []);
  if (inventory) {
    lines.push(t(`${keyRoot}.elements`, { inventory }));
  }
  if (snap.text) {
    lines.push(t(`${keyRoot}.body`, { excerpt: snap.text }));
  } else if (snap.partial) {
    lines.push(String(t(`${keyRoot}.partial`) ?? "").trim());
  }
  if (snap.canvasHint) {
    lines.push(String(t(`${keyRoot}.canvasHint`) ?? "").trim());
  }
  if (snap.loginHint && !snap.canvasHint) {
    lines.push(String(t(`${keyRoot}.loginHint`) ?? "").trim());
  }
  lines.push(String(t(`${keyRoot}.instruction`) ?? "").trim());
  return lines.filter(Boolean).join("\n");
}
