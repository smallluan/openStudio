/**
 * Runtime JS evaluation + pre-load script injection for preview / Web Explore guests.
 * Used by native tool `sidebar_eval` and tab page-script presets.
 */

"use strict";

const cdp = require("./preview-guest-cdp.cjs");
const { getActiveGuest } = require("./preview-guest-capture.cjs");
const { isDebuggerPaused } = require("./preview-guest-debugger.cjs");

const MAX_EVAL_CHARS = 32_000;
const MAX_PRELOAD_CHARS = 200_000;

/** @type {Map<number, string>} guestId → CDP script identifier */
const preloadScriptIds = new Map();

/**
 * @param {unknown} value
 */
function serializeEvalResult(value) {
  if (value == null) return { type: "undefined", value: null };
  if (typeof value === "string") {
    return {
      type: "string",
      value: value.slice(0, MAX_EVAL_CHARS),
      truncated: value.length > MAX_EVAL_CHARS,
    };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { type: typeof value, value };
  }
  try {
    const json = JSON.stringify(value);
    if (json != null) {
      return {
        type: "json",
        value: json.slice(0, MAX_EVAL_CHARS),
        truncated: json.length > MAX_EVAL_CHARS,
      };
    }
  } catch {
    /* fallthrough */
  }
  const text = String(value);
  return {
    type: "object",
    value: text.slice(0, MAX_EVAL_CHARS),
    truncated: text.length > MAX_EVAL_CHARS,
  };
}

/**
 * @param {Record<string, unknown>} args
 */
async function handleSidebarEval(args = {}) {
  const expression = String(args.expression ?? args.script ?? args.code ?? "").trim();
  if (!expression) {
    return { ok: false, error: "expression_required", message: "expression (or script) is required" };
  }
  if (expression.length > MAX_EVAL_CHARS) {
    return {
      ok: false,
      error: "expression_too_long",
      message: `expression exceeds ${MAX_EVAL_CHARS} characters`,
    };
  }

  if (isDebuggerPaused()) {
    return {
      ok: false,
      error: "debugger_paused",
      message:
        "Page is paused on a breakpoint. Use sidebar_debugger op=evaluate in the paused frame, or op=resume first.",
    };
  }

  const wc = getActiveGuest();
  if (!wc) {
    return { ok: false, error: "no_guest", message: "No preview/Web Explore webview is attached" };
  }

  const resp = await cdp.sendCdpCommand(wc, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    generatePreview: true,
    awaitPromise: true,
  });
  if (!resp.ok) return resp;

  const payload = /** @type {Record<string, unknown>} */ (resp.result || {});
  const result = /** @type {Record<string, unknown>} */ (payload.result || {});
  if (result.exceptionDetails) {
    const details = /** @type {Record<string, unknown>} */ (result.exceptionDetails);
    const ex = /** @type {Record<string, unknown>} */ (details.exception || {});
    return {
      ok: false,
      error: "eval_exception",
      message: String(ex.description || details.text || "Evaluation failed"),
      exceptionDetails: details,
    };
  }

  const serialized = serializeEvalResult(result.value);
  const description = result.description != null ? String(result.description) : null;
  return {
    ok: true,
    expression,
    ...serialized,
    description,
    hint: "Runs in the active Web Explore / preview page context (same as DevTools console).",
  };
}

/**
 * @param {import("electron").WebContents | null | undefined} wc
 * @param {string} code
 */
async function applyGuestPreloadScript(wc, code) {
  if (!wc || wc.isDestroyed?.()) {
    return { ok: false, error: "no_guest", message: "Guest webContents is not available" };
  }
  const trimmed = String(code ?? "").trim();
  const guestId = wc.id;

  const prevId = preloadScriptIds.get(guestId);
  if (prevId) {
    await cdp.sendCdpCommand(wc, "Page.removeScriptToEvaluateOnNewDocument", { identifier: prevId });
    preloadScriptIds.delete(guestId);
  }

  if (!trimmed) {
    return { ok: true, guestId, cleared: true };
  }
  if (trimmed.length > MAX_PRELOAD_CHARS) {
    return {
      ok: false,
      error: "script_too_long",
      message: `Pre-load script exceeds ${MAX_PRELOAD_CHARS} characters`,
    };
  }

  const pageEnable = await cdp.sendCdpCommand(wc, "Page.enable");
  if (!pageEnable.ok) return pageEnable;

  const addResp = await cdp.sendCdpCommand(wc, "Page.addScriptToEvaluateOnNewDocument", {
    source: trimmed,
    runImmediately: false,
  });
  if (!addResp.ok) return addResp;

  const identifier = String(
    /** @type {Record<string, unknown>} */ (addResp.result || {}).identifier ?? "",
  ).trim();
  if (identifier) preloadScriptIds.set(guestId, identifier);

  return { ok: true, guestId, identifier: identifier || null, bytes: trimmed.length };
}

/**
 * @param {Record<string, unknown>} payload
 */
async function handleApplyGuestPreloadScript(payload = {}) {
  const guestId = Number(payload.webContentsId ?? payload.guestId ?? 0);
  const code = String(payload.code ?? payload.script ?? "");
  if (!guestId) {
    return { ok: false, error: "missing_guest_id", message: "webContentsId is required" };
  }

  let wc = null;
  try {
    const { webContents } = require("electron");
    wc = webContents.fromId(guestId);
  } catch {
    wc = null;
  }
  if (!wc || wc.isDestroyed?.()) {
    return { ok: false, error: "guest_not_found", message: `No guest webContents for id ${guestId}` };
  }

  return applyGuestPreloadScript(wc, code);
}

/**
 * @param {import("electron").WebContents} wc
 */
function clearGuestPreloadScript(wc) {
  if (!wc) return;
  preloadScriptIds.delete(wc.id);
}

module.exports = {
  MAX_EVAL_CHARS,
  MAX_PRELOAD_CHARS,
  handleSidebarEval,
  applyGuestPreloadScript,
  handleApplyGuestPreloadScript,
  clearGuestPreloadScript,
};
