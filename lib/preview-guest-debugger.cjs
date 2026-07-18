/**
 * CDP Debugger for Open Studio preview / Web Explore guest pages.
 * Used by native tool `sidebar_debugger`.
 */

"use strict";

const cdp = require("./preview-guest-cdp.cjs");
const { getActiveGuest } = require("./preview-guest-capture.cjs");

const MAX_SCRIPTS = 800;
const MAX_SOURCE_CHARS = 500_000;
const MAX_SEARCH_MATCHES = 20;
const MAX_BREAKPOINTS = 12;
const MAX_SCOPE_PROPS = 40;
const MAX_EVAL_CHARS = 8000;
const MAX_LIST_SCRIPTS = 80;
const MAX_SNIPPET_CHARS = 240;
const MAX_SNIPPET_LINE_CHARS = 400;
const SOURCE_SNIPPET_LINES = 8;
const SCRIPT_INDEX_QUIET_MS = 150;
const SCRIPT_INDEX_MAX_WAIT_MS = 1200;
const SEARCH_CONCURRENCY = 8;

/** Lower = preferred when ranking search hits. */
const LANG_URL_RE =
  /(?:^|[/\-_.=?])(?:lang|i18n|locale|locales|messages?)(?:[/\-_.=?]|$)|[-_]zh[_-]cn|[-_]en[_-]us|templatebyuuid|\.json(\?|$)/i;
const JS_URL_RE = /\.(?:js|mjs|cjs)(\?|$)/i;
/** Legacy guest banner id — remove if a previous build left it in the page. */
const LEGACY_PAUSE_OVERLAY_ID = "__openstudio_debugger_pause__";

/** @type {boolean} */
let sessionActive = false;
/** @type {Map<string, { scriptId: string; url: string; startLine: number; endLine: number; length: number }>} */
const scripts = new Map();
/** @type {Map<string, string>} */
const sourceCache = new Map();
/** @type {Map<string, { breakpointId: string; url: string; line: number; column?: number; text?: string }>} */
const breakpoints = new Map();
/** @type {{ paused: boolean; reason?: string; callFrames?: unknown[]; data?: unknown; hitBreakpoints?: string[]; ts?: number } | null} */
let pauseState = null;
/** @type {Array<{ resolve: (v: unknown) => void; timer: NodeJS.Timeout }>} */
const pauseWaiters = [];

/** @type {(() => void) | null} */
let unregisterHandler = null;

/** Dedupe scriptId:line breakpoints. @type {Set<string>} */
const breakpointKeys = new Set();

/**
 * @type {{
 *   text: string;
 *   caseSensitive: boolean;
 *   maxTotal: number;
 *   setCount: number;
 *   urlContains?: string;
 *   skipLangPacks?: boolean;
 * } | null}
 */
let pendingTextWatch = null;

/** @type {import("electron").WebContents | null} */
let activeGuestWc = null;

/** @type {Set<(evt: Record<string, unknown>) => void>} */
const pauseListeners = new Set();

/**
 * @param {(evt: Record<string, unknown>) => void} fn
 * @returns {() => void}
 */
function subscribeDebuggerPause(fn) {
  if (typeof fn !== "function") return () => {};
  pauseListeners.add(fn);
  return () => pauseListeners.delete(fn);
}

/**
 * @param {Record<string, unknown>} evt
 */
function emitDebuggerPause(evt) {
  for (const fn of pauseListeners) {
    try {
      fn(evt);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} scriptId
 * @param {number} line
 */
function breakpointKey(scriptId, line) {
  return `${scriptId}:${line}`;
}

/**
 * @param {string} scriptId
 * @param {string} url
 * @param {number} [startLine]
 * @param {number} [endLine]
 * @param {number} [length]
 */
function rememberScript(scriptId, url, startLine = 0, endLine = 0, length = 0) {
  if (!scriptId) return;
  // Keep inline / eval scripts too (empty url). DevTools Search includes them.
  const resolvedUrl = String(url ?? "").trim() || `(inline:${scriptId})`;
  scripts.set(scriptId, {
    scriptId,
    url: resolvedUrl,
    startLine: Number(startLine) || 0,
    endLine: Number(endLine) || 0,
    length: Number(length) || 0,
  });
  if (scripts.size > MAX_SCRIPTS) {
    const firstKey = scripts.keys().next().value;
    if (firstKey) {
      scripts.delete(firstKey);
      sourceCache.delete(firstKey);
    }
  }
}

/**
 * Debugger.enable returns before scriptParsed events finish flooding in.
 * Wait until the index stops growing for a short quiet period.
 */
async function waitForScriptIndexSettle(
  quietMs = SCRIPT_INDEX_QUIET_MS,
  maxMs = SCRIPT_INDEX_MAX_WAIT_MS,
) {
  const started = Date.now();
  let lastCount = scripts.size;
  let lastChangeAt = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (scripts.size !== lastCount) {
      lastCount = scripts.size;
      lastChangeAt = Date.now();
      continue;
    }
    if (Date.now() - lastChangeAt >= quietMs) break;
  }
  return scripts.size;
}

/**
 * @param {string} url
 */
function scriptUrlRank(url) {
  const s = String(url ?? "");
  if (isLangPackUrl(s)) return 30;
  if (JS_URL_RE.test(s)) return 0;
  return 10;
}

/**
 * Locale / i18n packs often contain the same user-visible copy as logic bundles.
 * Breaking on those lines usually never hits (string table runs once at load).
 * @param {string} url
 */
function isLangPackUrl(url) {
  const s = String(url ?? "");
  if (!s) return false;
  if (LANG_URL_RE.test(s)) return true;
  // Common CDN locale chunk names: *-zh_CN-*.js, *i18n*, *lang*
  if (/zh[_-]cn|en[_-]us|ja[_-]jp|ko[_-]kr/i.test(s) && /\.js(\?|$)/i.test(s)) return true;
  return false;
}

/**
 * @param {string} [urlContains]
 * @returns {Array<{ scriptId: string; url: string; startLine: number; endLine: number; length: number }>}
 */
function listScriptMetas(urlContains = "") {
  const needle = String(urlContains ?? "").trim().toLowerCase();
  /** @type {Array<{ scriptId: string; url: string; startLine: number; endLine: number; length: number }>} */
  const out = [];
  for (const meta of scripts.values()) {
    if (needle && !meta.url.toLowerCase().includes(needle)) continue;
    out.push(meta);
  }
  out.sort((a, b) => scriptUrlRank(a.url) - scriptUrlRank(b.url) || a.url.localeCompare(b.url));
  return out;
}

/**
 * Resolve a filename fragment or partial URL to a loaded script.
 * @param {string} urlOrFilename
 */
function resolveScriptByUrlHint(urlOrFilename) {
  const hint = String(urlOrFilename ?? "").trim();
  if (!hint) return null;
  const lower = hint.toLowerCase();
  /** @type {Array<{ scriptId: string; url: string; startLine: number; endLine: number; length: number }>} */
  const hits = [];
  for (const meta of scripts.values()) {
    const u = meta.url.toLowerCase();
    if (u === lower || u.endsWith(`/${lower}`) || u.includes(lower)) {
      hits.push(meta);
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const aExact = a.url.toLowerCase().endsWith(lower) || a.url.toLowerCase() === lower ? 0 : 1;
    const bExact = b.url.toLowerCase().endsWith(lower) || b.url.toLowerCase() === lower ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return scriptUrlRank(a.url) - scriptUrlRank(b.url);
  });
  return hits[0];
}

/**
 * @param {string} fragment
 */
function urlRegexFromFragment(fragment) {
  const base = String(fragment ?? "").trim();
  if (!base) return "";
  return base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} method
 * @param {unknown} params
 */
function onCdpMessage(method, params, wc) {
  const p = /** @type {Record<string, unknown>} */ (params || {});
  if (method === "Debugger.scriptParsed") {
    const scriptId = String(p.scriptId ?? "");
    rememberScript(
      scriptId,
      String(p.url ?? ""),
      Number(p.startLine) || 0,
      Number(p.endLine) || 0,
      Number(p.length) || 0,
    );
    const guest = wc || activeGuestWc;
    if (guest && pendingTextWatch) {
      void maybeWatchScriptForText(guest, scriptId);
    }
    return;
  }
  if (method === "Debugger.paused") {
    pauseState = {
      paused: true,
      reason: String(p.reason ?? "other"),
      callFrames: Array.isArray(p.callFrames) ? p.callFrames : [],
      data: p.data ?? null,
      hitBreakpoints: Array.isArray(p.hitBreakpoints) ? p.hitBreakpoints.map(String) : [],
      ts: Date.now(),
    };
    const snap = formatPauseResult(pauseState);
    // Never await CDP sendCommand inside the message handler — it can deadlock the debugger pipe.
    setImmediate(() => {
      emitDebuggerPause({ ...snap, paused: true });
    });
    for (const waiter of pauseWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(snap);
    }
    return;
  }
  if (method === "Debugger.resumed") {
    pauseState = null;
    const guest = wc || activeGuestWc;
    setImmediate(() => {
      if (guest && !guest.isDestroyed?.()) {
        void removeLegacyGuestPauseBanner(guest);
      }
      emitDebuggerPause({ ok: true, paused: false, reason: "resumed", ts: Date.now() });
    });
  }
}

/**
 * Strip leftover in-page banner from older builds (host UI is the only pause chrome now).
 * @param {import("electron").WebContents} wc
 */
async function removeLegacyGuestPauseBanner(wc) {
  const expr = `(() => {
    try {
      const el = document.getElementById(${JSON.stringify(LEGACY_PAUSE_OVERLAY_ID)});
      if (el) el.remove();
      return true;
    } catch (e) { return String(e); }
  })()`;
  try {
    await cdp.sendCdpCommand(wc, "Runtime.evaluate", { expression: expr, returnByValue: true });
  } catch {
    /* ignore */
  }
}

/**
 * Compact pause snapshot for tools / sidebar_action early-return (no extra CDP).
 */
function getDebuggerPauseSnapshot() {
  if (!pauseState?.paused) {
    return { ok: true, paused: false, hit: false };
  }
  return formatPauseResult(pauseState);
}

function isDebuggerPaused() {
  return Boolean(pauseState?.paused);
}

/**
 * @param {import("electron").WebContents} wc
 */
async function ensureSession(wc) {
  if (!unregisterHandler) {
    unregisterHandler = cdp.registerCdpMessageHandler(onCdpMessage);
  }
  const enabled = await cdp.enableCdpDebugger(wc);
  if (!enabled.ok) return enabled;
  sessionActive = true;
  activeGuestWc = wc;
  // Ensure breakpoints are armed (DevTools does this implicitly when Sources is open).
  await cdp.sendCdpCommand(wc, "Debugger.setBreakpointsActive", { active: true });
  try {
    await cdp.sendCdpCommand(wc, "Runtime.runIfWaitingForDebugger");
  } catch {
    /* optional */
  }
  await waitForScriptIndexSettle();
  // If still empty after settle, force re-enable so Chromium re-emits scriptParsed.
  if (scripts.size === 0) {
    const forced = await cdp.forceEnableCdpDebugger(wc);
    if (!forced.ok) return forced;
    await cdp.sendCdpCommand(wc, "Debugger.setBreakpointsActive", { active: true });
    await waitForScriptIndexSettle();
  }
  try {
    await removeLegacyGuestPauseBanner(wc);
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    sessionActive: true,
    scriptCount: scripts.size,
    breakpointCount: breakpoints.size,
    paused: Boolean(pauseState?.paused),
    guestId: wc.id,
    hint: "Like DevTools global search: break_on_text searches all loaded scripts and sets a breakpoint on each match; also watches future dynamic chunks. When a breakpoint hits: host pause UI + sidebar_action returns debuggerPaused:true — then inspect / resume.",
  };
}

/**
 * @param {import("electron").WebContents | null | undefined} wc
 */
async function disableSession(wc) {
  sessionActive = false;
  pendingTextWatch = null;
  activeGuestWc = null;
  breakpointKeys.clear();
  breakpoints.clear();
  scripts.clear();
  sourceCache.clear();
  pauseState = null;
  for (const waiter of pauseWaiters.splice(0)) {
    clearTimeout(waiter.timer);
    waiter.resolve({ ok: true, paused: false, reason: "session_disabled" });
  }
  if (wc && !wc.isDestroyed?.()) {
    void removeLegacyGuestPauseBanner(wc);
    try {
      await cdp.sendCdpCommand(wc, "Debugger.disable");
    } catch {
      /* ignore */
    }
  }
  emitDebuggerPause({ ok: true, paused: false, reason: "session_disabled", ts: Date.now() });
  if (unregisterHandler) {
    unregisterHandler();
    unregisterHandler = null;
  }
  await cdp.disableCdpDebugger(wc);
  return { ok: true, sessionActive: false };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} scriptId
 */
async function getScriptSource(wc, scriptId) {
  const cached = sourceCache.get(scriptId);
  if (cached != null) return cached;
  const meta = scripts.get(scriptId);
  if (!meta) return null;
  const resp = await cdp.sendCdpCommand(wc, "Debugger.getScriptSource", { scriptId });
  if (!resp.ok) return null;
  const text = String(resp.result?.scriptSource ?? "");
  const clipped = text.length > MAX_SOURCE_CHARS ? text.slice(0, MAX_SOURCE_CHARS) : text;
  sourceCache.set(scriptId, clipped);
  return clipped;
}

/**
 * @param {string} source
 * @param {number} index
 */
function indexToLineColumn(source, index) {
  let line = 0;
  let column = 0;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * @param {string} source
 * @param {number} line
 * @param {number} [radius]
 */
function snippetAroundLine(source, line, radius = SOURCE_SNIPPET_LINES) {
  const lines = source.split("\n");
  const start = Math.max(0, line - radius);
  const end = Math.min(lines.length - 1, line + radius);
  /** @type {Array<{ line: number; text: string; truncated?: boolean }>} */
  const out = [];
  for (let i = start; i <= end; i += 1) {
    let text = lines[i] ?? "";
    let truncated = false;
    if (text.length > MAX_SNIPPET_LINE_CHARS) {
      text = `${text.slice(0, MAX_SNIPPET_LINE_CHARS)}…`;
      truncated = true;
    }
    out.push({ line: i, text, ...(truncated ? { truncated: true } : {}) });
  }
  return out;
}

/**
 * Compact snippet for minified single-line bundles — slice around match column, not whole line.
 * @param {string} source
 * @param {number} column
 * @param {number} [line]
 */
function snippetAroundColumn(source, column, line = 0) {
  const lines = source.split("\n");
  const lineText = lines[line] ?? source;
  if (lineText.length <= MAX_SNIPPET_LINE_CHARS) {
    return snippetAroundLine(source, line, 1);
  }
  const half = Math.floor(MAX_SNIPPET_CHARS / 2);
  const start = Math.max(0, column - half);
  const end = Math.min(lineText.length, column + half);
  return [
    {
      line,
      column,
      text: lineText.slice(start, end),
      truncated: start > 0 || end < lineText.length,
    },
  ];
}

/**
 * @param {string} source
 * @param {number} line
 * @param {number} column
 */
function formatMatchSnippet(source, line, column) {
  const lines = source.split("\n");
  const lineText = lines[line] ?? "";
  if (lineText.length > MAX_SNIPPET_LINE_CHARS) {
    return snippetAroundColumn(source, column, line);
  }
  return snippetAroundLine(source, line, 1);
}

/**
 * @param {string} source
 * @param {string} needle
 * @param {boolean} caseSensitive
 * @param {number} [maxPerScript]
 */
function findTextMatchesInSource(source, needle, caseSensitive, maxPerScript = 20) {
  /** @type {Array<{ line: number; column: number }>} */
  const out = [];
  const hay = caseSensitive ? source : source.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  let from = 0;
  while (out.length < maxPerScript) {
    const idx = hay.indexOf(n, from);
    if (idx < 0) break;
    out.push(indexToLineColumn(source, idx));
    from = idx + Math.max(1, n.length);
  }
  return out;
}

/**
 * @param {string} lineContent
 * @param {string} needle
 * @param {boolean} caseSensitive
 * @param {number} [max]
 */
function findColumnsInLine(lineContent, needle, caseSensitive, max = 20) {
  /** @type {number[]} */
  const out = [];
  const hay = caseSensitive ? lineContent : lineContent.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  if (!n) return out;
  let from = 0;
  while (out.length < max) {
    const idx = hay.indexOf(n, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + Math.max(1, n.length);
  }
  return out;
}

/**
 * Snippet from CDP SearchMatch.lineContent (no full source fetch).
 * @param {string} lineContent
 * @param {number} line
 * @param {number} column
 */
function snippetFromLineContent(lineContent, line, column) {
  if (lineContent.length <= MAX_SNIPPET_LINE_CHARS) {
    return [{ line, column, text: lineContent }];
  }
  const half = Math.floor(MAX_SNIPPET_CHARS / 2);
  const start = Math.max(0, column - half);
  const end = Math.min(lineContent.length, column + half);
  return [
    {
      line,
      column,
      text: lineContent.slice(start, end),
      truncated: start > 0 || end < lineContent.length,
    },
  ];
}

/**
 * Prefer Chromium Debugger.searchInContent (full script, no 500KB clip).
 * Falls back to local scan of getScriptSource when CDP search is unavailable.
 * @param {import("electron").WebContents} wc
 * @param {string} scriptId
 * @param {string} query
 * @param {boolean} caseSensitive
 */
async function searchInScript(wc, scriptId, query, caseSensitive) {
  const resp = await cdp.sendCdpCommand(wc, "Debugger.searchInContent", {
    scriptId,
    query,
    caseSensitive: Boolean(caseSensitive),
    isRegex: false,
  });
  if (resp.ok) {
    const rows = Array.isArray(resp.result?.result) ? resp.result.result : [];
    /** @type {Array<{ line: number; column: number; lineContent: string }>} */
    const matches = [];
    for (const raw of rows) {
      const row = /** @type {Record<string, unknown>} */ (raw || {});
      const line = Number(row.lineNumber) || 0;
      const lineContent = String(row.lineContent ?? "");
      const cols = findColumnsInLine(lineContent, query, caseSensitive);
      if (!cols.length) {
        matches.push({ line, column: 0, lineContent });
        continue;
      }
      for (const column of cols) {
        matches.push({ line, column, lineContent });
      }
    }
    return { ok: true, method: "searchInContent", matches };
  }

  // Fallback: local scan. Avoid caching a clipped source as "complete".
  const srcResp = await cdp.sendCdpCommand(wc, "Debugger.getScriptSource", { scriptId });
  if (!srcResp.ok) {
    return { ok: false, method: "getScriptSource", matches: [], error: srcResp };
  }
  const source = String(srcResp.result?.scriptSource ?? "");
  if (source && source.length <= MAX_SOURCE_CHARS) {
    sourceCache.set(scriptId, source);
  }
  const locs = findTextMatchesInSource(source, query, caseSensitive);
  return {
    ok: true,
    method: "getScriptSource",
    truncated: source.length > MAX_SOURCE_CHARS,
    matches: locs.map((loc) => ({
      line: loc.line,
      column: loc.column,
      lineContent: "",
    })),
    source,
  };
}

/**
 * Run async work over items with a concurrency limit.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapPool(items, concurrency, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} scriptId
 */
async function maybeWatchScriptForText(wc, scriptId) {
  const watch = pendingTextWatch;
  if (!watch || watch.setCount >= watch.maxTotal) {
    if (watch && watch.setCount >= watch.maxTotal) pendingTextWatch = null;
    return;
  }
  const meta = scripts.get(scriptId);
  if (!meta) return;
  const urlFilter = String(watch.urlContains ?? "").trim().toLowerCase();
  if (urlFilter && !meta.url.toLowerCase().includes(urlFilter)) return;
  if (watch.skipLangPacks !== false && isLangPackUrl(meta.url)) return;

  const found = await searchInScript(wc, scriptId, watch.text, watch.caseSensitive);
  if (!found.ok || !found.matches.length) return;
  for (const loc of found.matches) {
    if (watch.setCount >= watch.maxTotal) break;
    const key = breakpointKey(scriptId, loc.line);
    if (breakpointKeys.has(key)) continue;
    const bp = await setBreakpointOnScript(wc, scriptId, loc.line, loc.column, watch.text);
    if (bp.ok) {
      breakpointKeys.add(key);
      watch.setCount += 1;
    }
  }
  if (watch.setCount >= watch.maxTotal) pendingTextWatch = null;
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Array<Record<string, unknown>>} matches
 * @param {string} label
 * @param {number} maxBp
 */
async function applyBreakpointsFromMatches(wc, matches, label, maxBp) {
  /** @type {Array<Record<string, unknown>>} */
  const details = [];
  let okCount = 0;
  for (const match of matches) {
    if (okCount >= maxBp) break;
    const scriptId = String(match.scriptId ?? "");
    const line = Number(match.line) || 0;
    const key = breakpointKey(scriptId, line);
    if (breakpointKeys.has(key)) {
      details.push({ ...match, breakpoint: { ok: true, skipped: true, reason: "already_set" } });
      continue;
    }
    const bp = await setBreakpointAt(
      wc,
      String(match.url ?? ""),
      line,
      Number(match.column) || 0,
      label,
      scriptId,
    );
    if (bp.ok) {
      breakpointKeys.add(key);
      okCount += 1;
    }
    details.push({ ...match, breakpoint: bp });
  }
  return { okCount, details };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} args
 */
async function searchScripts(wc, args = {}) {
  const text = String(args.text ?? args.query ?? "").trim();
  if (!text) {
    return { ok: false, error: "text_required", message: "text is required for search" };
  }
  const maxMatches = Math.min(MAX_SEARCH_MATCHES, Math.max(1, Number(args.maxMatches) || 8));
  const caseSensitive = args.caseSensitive === true;
  const urlContains = String(args.urlContains ?? args.filename ?? "").trim();
  const preferJs = args.preferJs !== false;

  /** @type {Array<Record<string, unknown>>} */
  const matches = [];
  const metas = listScriptMetas(urlContains);
  if (urlContains && !metas.length) {
    return {
      ok: true,
      text,
      matchCount: 0,
      matches: [],
      urlContains,
      scriptCount: scripts.size,
      scriptsScanned: 0,
      scriptsFailed: 0,
      hint:
        "No loaded script URL contains that fragment. Call op=list_scripts or enable then reload the page so chunks are indexed.",
    };
  }

  const scanList = metas.length ? metas : listScriptMetas();

  // Scan ALL indexed scripts (like DevTools Search). Rank/trim after the full pass —
  // early-exit used to miss later chunks (e.g. extend.*.min.js) when earlier hits filled the budget.
  const perScript = await mapPool(scanList, SEARCH_CONCURRENCY, async (meta) => {
    const found = await searchInScript(wc, meta.scriptId, text, caseSensitive);
    /** @type {Array<Record<string, unknown>>} */
    const localMatches = [];
    if (!found.ok) {
      return { failed: true, method: "none", matches: localMatches };
    }
    /** @type {Set<string>} */
    const seen = new Set();
    for (const loc of found.matches) {
      const dedupe = `${loc.line}:${loc.column}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      let snippet;
      if (loc.lineContent) {
        snippet = snippetFromLineContent(loc.lineContent, loc.line, loc.column);
      } else if (found.source) {
        snippet = formatMatchSnippet(found.source, loc.line, loc.column);
      } else {
        snippet = [{ line: loc.line, column: loc.column, text: text }];
      }
      localMatches.push({
        scriptId: meta.scriptId,
        url: meta.url,
        line: loc.line,
        column: loc.column,
        rank: scriptUrlRank(meta.url),
        snippet,
      });
    }
    return { failed: false, method: found.method || "none", matches: localMatches };
  });

  let scriptsFailed = 0;
  let usedSearchInContent = 0;
  let usedSourceFallback = 0;
  for (const row of perScript) {
    if (row.failed) scriptsFailed += 1;
    else if (row.method === "searchInContent") usedSearchInContent += 1;
    else if (row.method === "getScriptSource") usedSourceFallback += 1;
    for (const m of row.matches) matches.push(m);
  }

  matches.sort(
    (a, b) =>
      (preferJs ? Number(a.rank) - Number(b.rank) : 0) ||
      String(a.url).localeCompare(String(b.url)) ||
      Number(a.line) - Number(b.line) ||
      Number(a.column) - Number(b.column),
  );
  const trimmed = matches.slice(0, maxMatches).map(({ rank, ...rest }) => rest);

  return {
    ok: true,
    text,
    urlContains: urlContains || undefined,
    matchCount: trimmed.length,
    totalMatchCount: matches.length,
    matches: trimmed,
    scriptCount: scripts.size,
    scriptsScanned: scanList.length,
    scriptsFailed,
    searchMethod:
      usedSearchInContent > 0
        ? "Debugger.searchInContent"
        : usedSourceFallback > 0
          ? "Debugger.getScriptSource"
          : "none",
    hint: trimmed.length
      ? "Global search across loaded scripts (CDP searchInContent, like DevTools Search). Use break_on_text to set a breakpoint on each match."
      : scriptsFailed > 0
        ? `No matches; ${scriptsFailed}/${scanList.length} scripts failed to search. Retry enable, or avoid opening guest DevTools while debugging.`
        : "No matches in loaded scripts yet. break_on_text with watch=true will auto-breakpoint when dynamic chunks load.",
  };
}

/**
 * @param {string} url
 * @returns {string[]}
 */
function urlVariants(url) {
  const s = String(url ?? "").trim();
  if (!s) return [];
  /** @type {string[]} */
  const out = [s];
  try {
    const u = new URL(s);
    out.push(`${u.origin}${u.pathname}`);
    if (u.search) out.push(`${u.origin}${u.pathname}${u.search}`);
  } catch {
    /* not a full URL */
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} scriptId
 * @param {number} line
 * @param {number} [column]
 * @param {string} [label]
 */
async function setBreakpointOnScript(wc, scriptId, line, column = 0, label = "") {
  const resp = await cdp.sendCdpCommand(wc, "Debugger.setBreakpoint", {
    location: {
      scriptId,
      lineNumber: Math.max(0, Number(line) || 0),
      columnNumber: Math.max(0, Number(column) || 0),
    },
  });
  if (!resp.ok) return resp;
  const breakpointId = String(resp.result?.breakpointId ?? "");
  const actual = /** @type {Record<string, unknown> | null} */ (resp.result?.actualLocation || null);
  if (!breakpointId || !actual || actual.scriptId == null) {
    return {
      ok: false,
      error: "breakpoint_unbound",
      scriptId,
      line: Number(line) || 0,
      column: Number(column) || 0,
      message:
        "CDP accepted the request but did not bind an actualLocation (common on string-literal / i18n lines).",
    };
  }
  const boundLine = Number(actual.lineNumber) || 0;
  const boundColumn = Number(actual.columnNumber) || 0;
  const boundScriptId = String(actual.scriptId);
  const meta = scripts.get(boundScriptId) || scripts.get(scriptId);
  breakpoints.set(breakpointId, {
    breakpointId,
    url: meta?.url || scriptId,
    line: boundLine,
    column: boundColumn,
    text: label,
  });
  return {
    ok: true,
    breakpointId,
    scriptId: boundScriptId,
    url: meta?.url || "",
    line: boundLine,
    column: boundColumn,
    requested: { scriptId, line: Number(line) || 0, column: Number(column) || 0 },
    actualLocation: actual,
    method: "scriptId",
  };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} url
 * @param {number} line
 * @param {number} [column]
 * @param {string} [label]
 * @param {string} [scriptId]
 */
async function setBreakpointAt(wc, url, line, column = 0, label = "", scriptId = "") {
  if (scriptId) {
    const byScript = await setBreakpointOnScript(wc, scriptId, line, column, label);
    if (byScript.ok) return byScript;
  }

  const resolved = resolveScriptByUrlHint(url);
  if (resolved) {
    const byResolved = await setBreakpointOnScript(wc, resolved.scriptId, line, column, label);
    if (byResolved.ok) return { ...byResolved, url: resolved.url, resolvedFrom: url };
  }

  /** @type {Record<string, unknown> | null} */
  let lastError = null;
  /** @type {string[]} */
  const attempts = [...urlVariants(resolved?.url || url)];
  const regex = urlRegexFromFragment(url);
  if (regex) attempts.push(`__regex__:${regex}`);

  for (const variant of attempts) {
    /** @type {Record<string, unknown>} */
    const params = {
      lineNumber: Math.max(0, Number(line) || 0),
      columnNumber: Math.max(0, Number(column) || 0),
    };
    if (variant.startsWith("__regex__:")) {
      params.urlRegex = variant.slice("__regex__:".length);
    } else {
      params.url = variant;
    }
    const resp = await cdp.sendCdpCommand(wc, "Debugger.setBreakpointByUrl", params);
    if (resp.ok && Array.isArray(resp.result?.locations) && resp.result.locations.length) {
      const breakpointId = String(resp.result.breakpointId ?? "");
      breakpoints.set(breakpointId, {
        breakpointId,
        url: variant.startsWith("__regex__:") ? url : variant,
        line: Number(line) || 0,
        column: Number(column) || 0,
        text: label,
      });
      return {
        ok: true,
        breakpointId,
        url: resolved?.url || (variant.startsWith("__regex__:") ? url : variant),
        line: Number(line) || 0,
        column: Number(column) || 0,
        locations: resp.result.locations,
        method: variant.startsWith("__regex__:") ? "urlRegex" : "url",
      };
    }
    lastError = resp;
  }
  return {
    ok: false,
    error: "breakpoint_failed",
    url,
    scriptId: scriptId || resolved?.scriptId || "",
    line,
    scriptCount: scripts.size,
    message: lastError?.message || "Could not resolve breakpoint location",
    hint: "Use op=search for global text search, then break_on_text to breakpoint every match. Dynamic chunks are watched automatically.",
  };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} args
 */
async function breakOnText(wc, args = {}) {
  const text = String(args.text ?? args.query ?? "").trim();
  if (!text) {
    return { ok: false, error: "text_required", message: "text is required" };
  }
  activeGuestWc = wc;
  const caseSensitive = args.caseSensitive === true;
  const maxBp = Math.min(MAX_BREAKPOINTS, Math.max(1, Number(args.maxBreakpoints) || MAX_BREAKPOINTS));
  const watchDynamic = args.watch !== false;
  const urlContains = String(args.urlContains ?? args.filename ?? "").trim();
  // Default: do not bind breakpoints on locale/i18n packs (string tables rarely re-execute).
  const skipLangPacks = args.skipLangPacks !== false;

  if (watchDynamic) {
    pendingTextWatch = {
      text,
      caseSensitive,
      maxTotal: maxBp,
      setCount: 0,
      urlContains,
      skipLangPacks,
    };
  }

  const search = await searchScripts(wc, {
    ...args,
    text,
    maxMatches: Math.min(MAX_SEARCH_MATCHES, Math.max(maxBp * 3, 12)),
  });
  if (!search.ok) return search;

  /** @type {Array<Record<string, unknown>>} */
  let candidateMatches = Array.isArray(search.matches) ? [...search.matches] : [];
  const langSkipped = candidateMatches.filter((m) => isLangPackUrl(String(m.url ?? "")));
  if (skipLangPacks) {
    const logicOnly = candidateMatches.filter((m) => !isLangPackUrl(String(m.url ?? "")));
    if (logicOnly.length) candidateMatches = logicOnly;
  }
  candidateMatches = candidateMatches.slice(0, maxBp);

  const applied = await applyBreakpointsFromMatches(wc, candidateMatches, text, maxBp);
  if (pendingTextWatch) {
    pendingTextWatch.setCount = applied.okCount;
    if (pendingTextWatch.setCount >= maxBp) pendingTextWatch = null;
  }

  const okCount = applied.okCount;
  /** @type {Array<Record<string, unknown>>} */
  const compactBreakpoints = applied.details.map((row) => {
    const bp = /** @type {Record<string, unknown>} */ (row.breakpoint || {});
    return {
      scriptId: row.scriptId,
      url: row.url,
      line: row.line,
      column: row.column,
      breakpoint: {
        ok: bp.ok,
        skipped: bp.skipped,
        method: bp.method,
        error: bp.error,
        message: bp.message,
        actualLocation: bp.actualLocation,
      },
    };
  });

  let hint =
    okCount > 0
      ? `Set ${okCount} breakpoint(s). Reproduce with sidebar_action — if hit, it returns debuggerPaused:true (+ inspect). After inspecting, ALWAYS op=resume before retrying or more clicks (yellow bar / page stays frozen until resume).`
      : watchDynamic
        ? "No matches in loaded scripts yet; watching for dynamic chunks. Reproduce now — breakpoints will bind when matching scripts load."
        : "No matches. Try a code token (function name / error uuid) instead of user-visible copy.";
  if (okCount > 0 && langSkipped.length && skipLangPacks) {
    hint += ` Skipped ${langSkipped.length} locale/i18n hit(s) (string tables usually do not re-run).`;
  }
  if (okCount === 0 && langSkipped.length && skipLangPacks) {
    hint =
      "Only locale/i18n hits found; skipped them by default. Prefer break_on_text on a logic chunk (urlContains) or a code id like BX-FE_… / function name. Pass skipLangPacks:false to force locale breakpoints.";
  }

  return {
    ok: okCount > 0 || watchDynamic,
    text,
    matchCount: search.matchCount,
    breakpointsSet: okCount,
    breakpoints: compactBreakpoints,
    skippedLangPackMatches: skipLangPacks ? langSkipped.length : 0,
    watchActive: watchDynamic && Boolean(pendingTextWatch),
    scriptCount: scripts.size,
    paused: Boolean(pauseState?.paused),
    hint,
  };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} args
 */
async function breakOnLocation(wc, args = {}) {
  const url = String(args.url ?? args.filename ?? "").trim();
  const line = Number(args.line);
  if (!url || !Number.isFinite(line)) {
    return { ok: false, error: "url_line_required", message: "url (or filename) and line are required" };
  }
  const column = Number(args.column) || 0;
  const scriptId = String(args.scriptId ?? "").trim();
  const bp = await setBreakpointAt(wc, url, line, column, "", scriptId);
  return {
    ...bp,
    hint: bp.ok ? "Reproduce with sidebar_action, then call waitPaused." : bp.hint,
  };
}

/**
 * @param {Record<string, unknown>} args
 */
function listScripts(args = {}) {
  const max = Math.min(MAX_LIST_SCRIPTS, Math.max(1, Number(args.max) || 40));
  const urlContains = String(args.urlContains ?? args.filename ?? "").trim();
  const metas = listScriptMetas(urlContains).slice(0, max);
  return {
    ok: true,
    scriptCount: scripts.size,
    listed: metas.length,
    scripts: metas.map((m) => ({
      scriptId: m.scriptId,
      url: m.url,
      length: m.length,
    })),
    hint: urlContains
      ? "Pick a script url/scriptId, search with urlContains + code token, then break_on_text."
      : "Filter with urlContains (e.g. extend.258) to find lazy-loaded chunks.",
  };
}

/**
 * @param {import("electron").WebContents} wc
 */
async function clearBreakpoints(wc) {
  for (const id of breakpoints.keys()) {
    await cdp.sendCdpCommand(wc, "Debugger.removeBreakpoint", { breakpointId: id });
  }
  breakpoints.clear();
  return { ok: true, cleared: true, breakpointCount: 0 };
}

/**
 * @param {{ paused?: boolean; reason?: string; callFrames?: unknown[]; data?: unknown; hitBreakpoints?: string[]; ts?: number }} state
 */
function formatPauseResult(state) {
  const frames = Array.isArray(state.callFrames) ? state.callFrames : [];
  const callFrames = frames.slice(0, 12).map((raw, index) => {
    const f = /** @type {Record<string, unknown>} */ (raw || {});
    const loc = /** @type {Record<string, unknown>} */ (f.location || {});
    const scriptId = loc.scriptId != null ? String(loc.scriptId) : "";
    return {
      index,
      callFrameId: f.callFrameId,
      functionName: f.functionName || "(anonymous)",
      url: scriptId ? scripts.get(scriptId)?.url || scriptId : "",
      scriptId,
      lineNumber: loc.lineNumber,
      columnNumber: loc.columnNumber,
    };
  });
  const top = callFrames[0] || null;
  return {
    ok: true,
    paused: true,
    hit: true,
    debuggerPaused: true,
    reason: state.reason || "other",
    hitBreakpoints: state.hitBreakpoints || [],
    ts: state.ts || Date.now(),
    topFrame: top,
    callFrames,
    hint:
      "BREAKPOINT HIT — page JS is frozen (pause bar on preview). Next: op=inspect / evaluate, then ALWAYS op=resume before any further sidebar_action or retry. Leaving it paused blocks the user.",
  };
}

/**
 * @param {Record<string, unknown>} args
 */
async function waitPaused(args = {}) {
  const timeoutMs = Math.max(500, Math.min(60_000, Number(args.timeoutMs) || 10_000));
  if (pauseState?.paused) {
    return formatPauseResult(pauseState);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = pauseWaiters.findIndex((w) => w.timer === timer);
      if (idx >= 0) pauseWaiters.splice(idx, 1);
      resolve({
        ok: true,
        paused: false,
        reason: "timeout",
        timeoutMs,
        breakpointCount: breakpoints.size,
        hint:
          "Breakpoint not hit. Common causes: (1) break was on i18n/string-table only — use logic chunk or error uuid; (2) that code path did not run on reproduce; (3) no DevTools UI — a hit shows an orange top banner and wait_paused returns paused:true. Retry break_on_text with urlContains pointing at extend.*.js / business chunk.",
      });
    }, timeoutMs);
    pauseWaiters.push({ resolve, timer });
  });
}

/**
 * @param {unknown} props
 */
function formatRuntimeProperties(props) {
  if (!Array.isArray(props)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const item of props.slice(0, MAX_SCOPE_PROPS)) {
    const p = /** @type {Record<string, unknown>} */ (item || {});
    const name = String(p.name ?? "");
    const value = /** @type {Record<string, unknown>} */ (p.value || {});
    out.push({
      name,
      type: value.type,
      value: value.value != null ? String(value.value).slice(0, 500) : undefined,
      description: value.description ? String(value.description).slice(0, 500) : undefined,
      objectId: value.objectId,
    });
  }
  return out;
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} args
 */
async function inspectPaused(wc, args = {}) {
  if (!pauseState?.paused || !Array.isArray(pauseState.callFrames) || !pauseState.callFrames.length) {
    return {
      ok: false,
      error: "not_paused",
      message: "Debugger is not paused. Use waitPaused after reproducing.",
      paused: false,
    };
  }
  const frameIndex = Math.max(0, Number(args.frameIndex) || 0);
  const frame = /** @type {Record<string, unknown>} */ (pauseState.callFrames[frameIndex] || pauseState.callFrames[0]);
  const callFrameId = String(frame.callFrameId ?? "");
  const loc = /** @type {Record<string, unknown>} */ (frame.location || {});
  const scriptId = String(loc.scriptId ?? "");
  const meta = scripts.get(scriptId);
  const source = scriptId ? await getScriptSource(wc, scriptId) : null;
  const line = Number(loc.lineNumber) || 0;

  /** @type {Array<Record<string, unknown>>} */
  const scopes = [];
  const scopeChain = Array.isArray(frame.scopeChain) ? frame.scopeChain : [];
  for (const scopeRaw of scopeChain.slice(0, 6)) {
    const scope = /** @type {Record<string, unknown>} */ (scopeRaw || {});
    const object = /** @type {Record<string, unknown>} */ (scope.object || {});
    if (!object.objectId) continue;
    const props = await cdp.sendCdpCommand(wc, "Runtime.getProperties", {
      objectId: object.objectId,
      ownProperties: true,
    });
    scopes.push({
      type: scope.type,
      name: scope.name || "",
      variables: props.ok ? formatRuntimeProperties(props.result?.result) : [],
    });
  }

  return {
    ok: true,
    paused: true,
    reason: pauseState.reason,
    frameIndex,
    callFrameId,
    functionName: frame.functionName || "(anonymous)",
    url: meta?.url || "",
    lineNumber: line,
    columnNumber: loc.columnNumber,
    sourceSnippet: source ? formatMatchSnippet(source, line, Number(loc.columnNumber) || 0) : [],
    scopes,
    hint: "Use evaluate with callFrameId for deeper inspection, then resume or stepOver.",
  };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} args
 */
async function evaluatePaused(wc, args = {}) {
  const expression = String(args.expression ?? "").trim();
  if (!expression) {
    return { ok: false, error: "expression_required", message: "expression is required" };
  }
  if (!pauseState?.paused || !Array.isArray(pauseState.callFrames) || !pauseState.callFrames.length) {
    return { ok: false, error: "not_paused", message: "Debugger is not paused" };
  }
  const frameIndex = Math.max(0, Number(args.frameIndex) || 0);
  const frame = /** @type {Record<string, unknown>} */ (pauseState.callFrames[frameIndex] || pauseState.callFrames[0]);
  const callFrameId = String(args.callFrameId || frame.callFrameId || "");
  const resp = await cdp.sendCdpCommand(wc, "Debugger.evaluateOnCallFrame", {
    callFrameId,
    expression,
    returnByValue: true,
    generatePreview: true,
  });
  if (!resp.ok) return resp;
  const result = /** @type {Record<string, unknown>} */ (resp.result?.result || {});
  const text = result.value != null ? String(result.value) : String(result.description ?? "");
  return {
    ok: true,
    expression,
    type: result.type,
    value: text.slice(0, MAX_EVAL_CHARS),
    truncated: text.length > MAX_EVAL_CHARS,
  };
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} command
 */
async function debuggerControl(wc, command) {
  const resp = await cdp.sendCdpCommand(wc, command);
  if (!resp.ok) return resp;
  if (command === "Debugger.resume") {
    pauseState = null;
  }
  return { ok: true, command };
}

/**
 * @param {Record<string, unknown>} args
 */
async function handleSidebarDebugger(args = {}) {
  const op = String(args.op ?? args.action ?? "status").trim().toLowerCase();
  const knownOps = new Set([
    "enable",
    "start",
    "disable",
    "stop",
    "status",
    "list_scripts",
    "listscripts",
    "search",
    "break_on_text",
    "breakontext",
    "break_on_location",
    "breakonlocation",
    "clear_breakpoints",
    "clear",
    "wait_paused",
    "waitpaused",
    "inspect",
    "evaluate",
    "resume",
    "step_over",
    "stepover",
    "step_into",
    "stepinto",
    "step_out",
    "stepout",
  ]);
  if (!knownOps.has(op)) {
    return {
      ok: false,
      error: "unknown_op",
      message: `Unknown op "${op}". Use enable|disable|status|list_scripts|search|break_on_text|break_on_location|clear_breakpoints|wait_paused|inspect|evaluate|resume|step_over|step_into|step_out.`,
    };
  }

  const wc = getActiveGuest();
  if (!wc && !["status", "disable", "stop", "wait_paused", "waitpaused"].includes(op)) {
    return { ok: false, error: "no_guest", message: "No preview/Web Explore webview is attached" };
  }

  switch (op) {
    case "enable":
    case "start":
      return ensureSession(/** @type {import("electron").WebContents} */ (wc));
    case "disable":
    case "stop":
      return disableSession(wc);
    case "status":
      return {
        ok: true,
        sessionActive,
        scriptCount: scripts.size,
        breakpointCount: breakpoints.size,
        paused: Boolean(pauseState?.paused),
        watchActive: Boolean(pendingTextWatch),
        watchText: pendingTextWatch?.text || null,
        breakpoints: [...breakpoints.values()],
        guestId: wc?.id ?? null,
      };
    case "list_scripts":
    case "listscripts": {
      const ensuredList = await ensureSession(/** @type {import("electron").WebContents} */ (wc));
      if (!ensuredList.ok) return ensuredList;
      return listScripts(args);
    }
    case "search": {
      const ensuredSearch = await ensureSession(/** @type {import("electron").WebContents} */ (wc));
      if (!ensuredSearch.ok) return ensuredSearch;
      return searchScripts(/** @type {import("electron").WebContents} */ (wc), args);
    }
    case "break_on_text":
    case "breakontext": {
      const ensuredBreak = await ensureSession(/** @type {import("electron").WebContents} */ (wc));
      if (!ensuredBreak.ok) return ensuredBreak;
      return breakOnText(/** @type {import("electron").WebContents} */ (wc), args);
    }
    case "break_on_location":
    case "breakonlocation": {
      const ensuredLoc = await ensureSession(/** @type {import("electron").WebContents} */ (wc));
      if (!ensuredLoc.ok) return ensuredLoc;
      return breakOnLocation(/** @type {import("electron").WebContents} */ (wc), args);
    }
    case "clear_breakpoints":
    case "clear":
      return clearBreakpoints(/** @type {import("electron").WebContents} */ (wc));
    case "wait_paused":
    case "waitpaused":
      return waitPaused(args);
    case "inspect":
      return inspectPaused(/** @type {import("electron").WebContents} */ (wc), args);
    case "evaluate":
      return evaluatePaused(/** @type {import("electron").WebContents} */ (wc), args);
    case "resume":
      return debuggerControl(/** @type {import("electron").WebContents} */ (wc), "Debugger.resume");
    case "step_over":
    case "stepover":
      return debuggerControl(/** @type {import("electron").WebContents} */ (wc), "Debugger.stepOver");
    case "step_into":
    case "stepinto":
      return debuggerControl(/** @type {import("electron").WebContents} */ (wc), "Debugger.stepInto");
    case "step_out":
    case "stepout":
      return debuggerControl(/** @type {import("electron").WebContents} */ (wc), "Debugger.stepOut");
    default:
      return {
        ok: false,
        error: "unknown_op",
        message: `Unknown op "${op}". Use enable|disable|status|list_scripts|search|break_on_text|break_on_location|clear_breakpoints|wait_paused|inspect|evaluate|resume|step_over|step_into|step_out.`,
      };
  }
}

function resetDebuggerState() {
  sessionActive = false;
  pendingTextWatch = null;
  activeGuestWc = null;
  breakpointKeys.clear();
  scripts.clear();
  sourceCache.clear();
  breakpoints.clear();
  pauseState = null;
  for (const waiter of pauseWaiters.splice(0)) {
    clearTimeout(waiter.timer);
    waiter.resolve({ ok: true, paused: false, reason: "reset" });
  }
  if (unregisterHandler) {
    unregisterHandler();
    unregisterHandler = null;
  }
}

module.exports = {
  handleSidebarDebugger,
  resetDebuggerState,
  subscribeDebuggerPause,
  getDebuggerPauseSnapshot,
  isDebuggerPaused,
  // Pure helpers for unit tests
  _test: {
    findColumnsInLine,
    findTextMatchesInSource,
    snippetFromLineContent,
    scriptUrlRank,
    isLangPackUrl,
  },
};
