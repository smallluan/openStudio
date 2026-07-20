/**
 * Set files on guest <input type="file"> via CDP (bypasses native OS picker).
 * Does NOT intercept the native file dialog — manual uploads keep working.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const cdp = require("./preview-guest-cdp.cjs");
const { getActiveGuest } = require("./preview-guest-capture.cjs");

/** @type {{ info?: Function; warn?: Function } | null} */
let log = null;

/**
 * @param {{ info?: Function; warn?: Function } | null | undefined} logger
 */
function initPreviewGuestFileInput(logger) {
  log = logger ?? null;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeAbsoluteFiles(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  for (const item of raw) {
    const p = path.resolve(String(item ?? "").trim());
    if (!p) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * @param {import("electron").WebContents} wc
 * @param {{ selector?: string; files?: string[]; webContentsId?: number }} payload
 */
async function setGuestFileInputFiles(wc, payload) {
  const selector = String(payload?.selector ?? "").trim();
  const files = normalizeAbsoluteFiles(payload?.files);
  if (!selector) return { ok: false, error: "missing_selector" };
  if (!files.length) {
    return { ok: false, error: "files_not_found", message: "Provide absolute file paths that exist on disk." };
  }
  if (!wc || wc.isDestroyed?.()) {
    return { ok: false, error: "no_guest", message: "Preview webview is not available." };
  }

  const domEnable = await cdp.sendCdpCommand(wc, "DOM.enable");
  if (!domEnable.ok) return domEnable;

  const doc = await cdp.sendCdpCommand(wc, "DOM.getDocument", { depth: -1, pierce: true });
  const rootId = doc.result?.root?.nodeId;
  if (!doc.ok || !rootId) {
    return { ok: false, error: "no_document", message: doc.message || "Could not read guest document." };
  }

  const queried = await cdp.sendCdpCommand(wc, "DOM.querySelector", {
    nodeId: rootId,
    selector,
  });
  const nodeId = queried.result?.nodeId;
  if (!queried.ok || !nodeId) {
    return {
      ok: false,
      error: "element_not_found",
      selector,
      message: "Could not find input[type=file] for selector.",
    };
  }

  const set = await cdp.sendCdpCommand(wc, "DOM.setFileInputFiles", { nodeId, files });
  if (!set.ok) return set;

  await cdp.sendCdpCommand(wc, "Runtime.enable");
  await cdp.sendCdpCommand(wc, "Runtime.evaluate", {
    expression: `(function(){
      try {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch (e) { return false; }
    })()`,
  });

  return {
    ok: true,
    action: "set_files",
    selector,
    files: files.map((f) => path.basename(f)),
    count: files.length,
  };
}

/**
 * @param {{ selector?: string; files?: string[]; webContentsId?: number }} payload
 */
async function handleSetGuestFileInputFiles(payload) {
  const id = Number(payload?.webContentsId);
  let wc = Number.isFinite(id) && id > 0 ? null : getActiveGuest();
  if (Number.isFinite(id) && id > 0) {
    try {
      const { webContents } = require("electron");
      const candidate = webContents.fromId(id);
      if (candidate && !candidate.isDestroyed()) wc = candidate;
    } catch {
      /* ignore */
    }
  }
  if (!wc) wc = getActiveGuest();
  if (!wc) return { ok: false, error: "no_guest" };
  return setGuestFileInputFiles(wc, payload);
}

module.exports = {
  initPreviewGuestFileInput,
  handleSetGuestFileInputFiles,
  setGuestFileInputFiles,
};
