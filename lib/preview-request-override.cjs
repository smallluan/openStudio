/**
 * Request redirect overrides for preview / Web Explore webview partition.
 */

"use strict";

const PREVIEW_PARTITION = "persist:openstudio-preview";

/** @type {{ info?: Function; warn?: Function } | null} */
let log = null;
/** @type {boolean} */
let hooked = false;
/** @type {boolean} */
let responseHooked = false;
/** @type {boolean} */
let protocolHooked = false;
/** @type {number} */
let devCacheEpoch = Date.now();
/** @type {Array<{ enabled: boolean; rules: Array<{ from: string; to: string; enabled: boolean }> }>} */
let activeGroups = [];

/**
 * @param {{ info?: Function; warn?: Function } | null | undefined} logger
 */
function initPreviewRequestOverride(logger) {
  log = logger ?? null;
  ensureHook();
}

/**
 * @param {unknown} raw
 */
function normalizeGroups(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {typeof activeGroups} */
  const out = [];
  for (const groupRaw of raw) {
    if (!groupRaw || typeof groupRaw !== "object") continue;
    const group = /** @type {Record<string, unknown>} */ (groupRaw);
    const rulesRaw = Array.isArray(group.rules) ? group.rules : [];
    /** @type {Array<{ from: string; to: string; enabled: boolean }>} */
    const rules = [];
    for (const ruleRaw of rulesRaw) {
      if (!ruleRaw || typeof ruleRaw !== "object") continue;
      const rule = /** @type {Record<string, unknown>} */ (ruleRaw);
      const from = String(rule.from ?? "").trim();
      const to = String(rule.to ?? "").trim();
      if (!from || !to) continue;
      rules.push({ from, to, enabled: rule.enabled !== false });
    }
    out.push({
      enabled: group.enabled !== false,
      rules,
    });
  }
  return out;
}

/**
 * Glob-style pattern (`*` wildcard) to RegExp for full URL matching.
 * @param {string} pattern
 */
function patternToRegExp(pattern) {
  const s = String(pattern ?? "").trim();
  if (!s) return null;
  let body = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "*") {
      body += ".*";
    } else if (/[+^${}()|[\]\\.]/.test(c)) {
      body += `\\${c}`;
    } else {
      body += c;
    }
  }
  try {
    return new RegExp(`^${body}$`, "i");
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @returns {string[]}
 */
function urlMatchCandidates(url) {
  const target = String(url ?? "").trim();
  if (!target) return [];
  /** @type {string[]} */
  const out = [target];
  try {
    const u = new URL(target);
    const originPath = `${u.origin}${u.pathname}`;
    const originPathQuery = `${originPath}${u.search}`;
    if (!out.includes(originPathQuery)) out.push(originPathQuery);
    if (!out.includes(originPath)) out.push(originPath);
    if (!out.includes(u.pathname)) out.push(u.pathname);
  } catch {
    /* ignore malformed URLs */
  }
  return out;
}

/**
 * @param {string} url
 * @param {string} pattern
 */
function urlMatchesPattern(url, pattern) {
  const re = patternToRegExp(pattern);
  if (!re) return false;
  for (const candidate of urlMatchCandidates(url)) {
    if (re.test(candidate)) return true;
  }
  return false;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
function matchRedirectTarget(url) {
  const target = String(url ?? "").trim();
  if (!target) return null;
  for (const group of activeGroups) {
    if (!group.enabled) continue;
    for (const rule of group.rules) {
      if (!rule.enabled) continue;
      if (urlMatchesPattern(target, rule.from)) return rule.to;
    }
  }
  return null;
}

function getPreviewSession() {
  const { session } = require("electron");
  return session.fromPartition(PREVIEW_PARTITION);
}

/**
 * @param {string} hostname
 */
function isLocalDevHost(hostname) {
  const h = String(hostname ?? "").trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h === "0.0.0.0";
}

/**
 * @param {string} rawUrl
 */
function isLocalDevUrl(rawUrl) {
  try {
    return isLocalDevHost(new URL(String(rawUrl ?? "")).hostname);
  } catch {
    return false;
  }
}

function hasActiveLocalRedirectRules() {
  for (const group of activeGroups) {
    if (!group.enabled) continue;
    for (const rule of group.rules) {
      if (rule.enabled && isLocalDevUrl(rule.to)) return true;
    }
  }
  return false;
}

function hasActiveRedirectRules() {
  return activeGroups.some((group) => group.enabled && group.rules.some((rule) => rule.enabled));
}

/**
 * @param {string} redirectURL
 * @param {number} [requestId]
 */
function withDevCacheBust(redirectURL, requestId) {
  const target = String(redirectURL ?? "").trim();
  if (!target || !isLocalDevUrl(target)) return target;
  try {
    const u = new URL(target);
    u.searchParams.set(
      "__os_dev",
      `${devCacheEpoch}_${Number(requestId) || 0}_${Date.now()}`,
    );
    return u.toString();
  } catch {
    return target;
  }
}

/**
 * @param {Record<string, string[] | undefined> | undefined} headers
 */
function stripCachingResponseHeaders(headers) {
  const next = { ...(headers || {}) };
  for (const key of Object.keys(next)) {
    if (/^(cache-control|pragma|expires|etag|last-modified|age)$/i.test(key)) {
      delete next[key];
    }
  }
  next["Cache-Control"] = ["no-store, no-cache, must-revalidate, max-age=0"];
  next["Pragma"] = ["no-cache"];
  next["Expires"] = ["0"];
  return next;
}

/**
 * @param {Record<string, string[] | undefined> | undefined} headers
 */
function withoutConditionalRequestHeaders(headers) {
  const next = { ...(headers || {}) };
  for (const key of Object.keys(next)) {
    if (/^if-(none-match|modified-since|unmodified-since)$/i.test(key)) {
      delete next[key];
    }
  }
  next["Cache-Control"] = ["no-cache, no-store, must-revalidate"];
  next["Pragma"] = ["no-cache"];
  return next;
}

function bumpPreviewDevCacheEpoch() {
  devCacheEpoch = Date.now();
  return devCacheEpoch;
}

function ensureLocalDevProtocolHook() {
  if (protocolHooked) return;
  try {
    const { net } = require("electron");
    const ses = getPreviewSession();
    if (typeof ses.protocol?.handle !== "function") {
      log?.warn?.("[preview-request-override] session.protocol.handle unavailable");
      return;
    }
    ses.protocol.handle("http", async (request) => {
      try {
        const url = new URL(request.url);
        if (isLocalDevHost(url.hostname) && hasActiveLocalRedirectRules()) {
          const headers = new Headers(request.headers);
          headers.delete("if-none-match");
          headers.delete("if-modified-since");
          headers.delete("if-unmodified-since");
          headers.set("cache-control", "no-cache, no-store, must-revalidate");
          headers.set("pragma", "no-cache");
          const fetchUrl = new URL(request.url);
          fetchUrl.searchParams.set("__os_fetch", String(Date.now()));
          return net.fetch(fetchUrl.toString(), {
            bypassCustomProtocolHandlers: true,
            cache: "no-store",
            headers,
          });
        }
      } catch (e) {
        log?.warn?.("[preview-request-override] protocol fetch failed:", e?.message ?? e);
      }
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
    protocolHooked = true;
  } catch (e) {
    log?.warn?.("[preview-request-override] protocol hook failed:", e?.message ?? e);
  }
}

function ensureResponseHook() {
  if (responseHooked) return;
  try {
    const ses = getPreviewSession();
    const localFilter = {
      urls: [
        "http://127.0.0.1/*",
        "http://localhost/*",
        "http://[::1]/*",
        "http://0.0.0.0/*",
        "https://127.0.0.1/*",
        "https://localhost/*",
        "https://[::1]/*",
      ],
    };
    ses.webRequest.onBeforeSendHeaders(localFilter, (details, callback) => {
      try {
        if (!hasActiveLocalRedirectRules()) {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }
        callback({
          requestHeaders: withoutConditionalRequestHeaders(details.requestHeaders),
        });
      } catch (e) {
        log?.warn?.("[preview-request-override] beforeSendHeaders failed:", e?.message ?? e);
        callback({ requestHeaders: details.requestHeaders });
      }
    });
    ses.webRequest.onHeadersReceived(localFilter, (details, callback) => {
      try {
        if (!hasActiveLocalRedirectRules()) {
          callback({});
          return;
        }
        callback({
          responseHeaders: stripCachingResponseHeaders(details.responseHeaders),
        });
      } catch (e) {
        log?.warn?.("[preview-request-override] headersReceived failed:", e?.message ?? e);
        callback({});
      }
    });
    responseHooked = true;
  } catch (e) {
    log?.warn?.("[preview-request-override] response hook unavailable:", e?.message ?? e);
  }
}

function ensureHook() {
  ensureLocalDevProtocolHook();
  ensureResponseHook();
  if (hooked) return;
  try {
    const ses = getPreviewSession();
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      try {
        const matched = matchRedirectTarget(details.url);
        if (matched) {
          const redirectURL = withDevCacheBust(matched, details.id);
          callback({ redirectURL });
          return;
        }
      } catch (e) {
        log?.warn?.("[preview-request-override] match failed:", e?.message ?? e);
      }
      callback({});
    });
    hooked = true;
  } catch (e) {
    log?.warn?.("[preview-request-override] hook unavailable:", e?.message ?? e);
  }
}

async function clearPreviewDevStorage() {
  try {
    const ses = getPreviewSession();
    if (typeof ses.clearStorageData !== "function") return { ok: true };
    await ses.clearStorageData({
      storages: ["serviceworkers", "cachestorage"],
    });
    return { ok: true };
  } catch (e) {
    log?.warn?.("[preview-request-override] clearStorageData failed:", e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function clearPreviewSessionCache() {
  try {
    const ses = getPreviewSession();
    await ses.clearCache();
    if (typeof ses.clearCodeCaches === "function") {
      await ses.clearCodeCaches({});
    }
    return { ok: true };
  } catch (e) {
    log?.warn?.("[preview-request-override] clearCache failed:", e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function clearPreviewDevCaches() {
  await clearPreviewDevStorage();
  return clearPreviewSessionCache();
}

/**
 * Bump dev cache epoch, clear HTTP/code/SW/cachestorage — call before hard reload in Web Explore.
 */
async function refreshPreviewDevCache() {
  bumpPreviewDevCacheEpoch();
  return clearPreviewDevCaches();
}

/**
 * @param {unknown} groups
 */
async function setPreviewRequestOverrides(groups) {
  activeGroups = normalizeGroups(groups);
  ensureHook();
  if (!hasActiveRedirectRules()) {
    return { ok: true, cacheCleared: false, activeRuleCount: 0 };
  }
  bumpPreviewDevCacheEpoch();
  const cleared = await clearPreviewDevCaches();
  const activeRuleCount = activeGroups.reduce(
    (sum, group) =>
      sum + (group.enabled ? group.rules.filter((rule) => rule.enabled).length : 0),
    0,
  );
  return { ok: cleared.ok, cacheCleared: cleared.ok, activeRuleCount };
}

module.exports = {
  initPreviewRequestOverride,
  setPreviewRequestOverrides,
  clearPreviewSessionCache,
  refreshPreviewDevCache,
};
