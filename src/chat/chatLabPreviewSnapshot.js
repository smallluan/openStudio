import { readLinkOpenModeLocal } from "./chatLabLinkOpenPreference.js";

/** @typedef {{
 *   ok: boolean;
 *   url: string;
 *   title: string;
 *   text: string;
 *   tabCount: number;
 *   partial?: boolean;
 *   loginHint?: boolean;
 *   canvasHint?: boolean;
 *   error?: string;
 * }} SidebarPreviewSnapshot */

export const SIDEBAR_PREVIEW_TEXT_MAX = 12000;

/**
 * Extract **visible** text from the active webview (not a screenshot).
 * Walks same-origin iframes; canvas / cross-origin spreadsheet cells are often unreadable.
 */
const EXTRACT_TEXT_SCRIPT = `(function(){
  var MAX = ${SIDEBAR_PREVIEW_TEXT_MAX};
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
  try {
    var bodyText = visibleText(document.body);
    var frameParts = iframeTexts(document, 0);
    var combined = [bodyText].concat(frameParts).filter(Boolean).join("\\n\\n").trim();
    var canvas = largeCanvasPresent();
    var meta = canvas ? "\\n[meta:canvas-or-spreadsheet-ui]" : "";
    return (combined + meta).slice(0, MAX);
  } catch (e) {
    return "";
  }
})()`;

/**
 * @param {string} text
 * @param {string} title
 */
function looksLikeLoginGate(text, title) {
  const blob = `${title}\n${text}`.toLowerCase();
  if (/\\.xlsx|\\.xls|\\.csv|spreadsheet|excel|工单/.test(blob) && text.length > 400) return false;
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
    /\\.xlsx|\\.xls|\\.csv|spreadsheet|excel|luckysheet|handsontable|sheetjs|wps/.test(blob) ||
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
 * @param {string} raw
 */
function normalizeExtractedText(raw) {
  const text = String(raw ?? "").trim();
  const canvasHint = /\[meta:canvas-or-spreadsheet-ui\]\s*$/.test(text);
  const cleaned = text.replace(/\n?\[meta:canvas-or-spreadsheet-ui\]\s*$/, "").trim();
  return { text: cleaned, canvasHint };
}

/**
 * @param {{
 *   session: { kind?: string; src?: string; title?: string; html?: string } | null;
 *   webviewRef?: import("react").RefObject<HTMLElement | null>;
 *   iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *   previewTabs?: Array<{ id: string; src: string; title: string }>;
 *   activePreviewTabId?: string;
 *   artifactsPanel?: unknown;
 * }} input
 * @returns {Promise<SidebarPreviewSnapshot | null>}
 */
export async function captureSidebarPreviewSnapshot(input) {
  if (readLinkOpenModeLocal() === "external") return null;
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
  let partial = false;
  let canvasHint = false;

  const webviewNode = input.webviewRef?.current ?? null;
  if (session.kind === "iframe" && isElectronWebview(webviewNode)) {
    const wv = /** @type {import("electron").WebviewTag} */ (webviewNode);
    try {
      url = String(wv.getURL?.() ?? activeTab?.src ?? session.src ?? "").trim();
      title = String(wv.getTitle?.() ?? activeTab?.title ?? session.title ?? "").trim();
      const raw = String((await wv.executeJavaScript(EXTRACT_TEXT_SCRIPT, false)) ?? "").trim();
      const parsed = normalizeExtractedText(raw);
      text = parsed.text;
      canvasHint = parsed.canvasHint;
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
    ...(partial ? { partial: true } : {}),
    ...(canvasHint ? { canvasHint: true } : {}),
    ...(looksLikeLoginGate(text, title) ? { loginHint: true } : {}),
  };
}

/**
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {SidebarPreviewSnapshot | null | undefined} snap
 */
export function composeChatLabPreviewContextBlock(t, snap) {
  if (!snap?.url) return "";
  const lines = [String(t("chatLab.sidebarPreviewContext.header") ?? "").trim()];
  lines.push(String(t("chatLab.sidebarPreviewContext.methodNote") ?? "").trim());
  lines.push(t("chatLab.sidebarPreviewContext.url", { url: snap.url }));
  if (snap.title) {
    lines.push(t("chatLab.sidebarPreviewContext.title", { title: snap.title }));
  }
  if (snap.tabCount > 1) {
    lines.push(t("chatLab.sidebarPreviewContext.tabCount", { count: snap.tabCount }));
  }
  if (snap.text) {
    lines.push(t("chatLab.sidebarPreviewContext.body", { excerpt: snap.text }));
  } else if (snap.partial) {
    lines.push(String(t("chatLab.sidebarPreviewContext.partial") ?? "").trim());
  }
  if (snap.canvasHint) {
    lines.push(String(t("chatLab.sidebarPreviewContext.canvasHint") ?? "").trim());
  }
  if (snap.loginHint && !snap.canvasHint) {
    lines.push(String(t("chatLab.sidebarPreviewContext.loginHint") ?? "").trim());
  }
  lines.push(String(t("chatLab.sidebarPreviewContext.instruction") ?? "").trim());
  return lines.filter(Boolean).join("\n");
}
