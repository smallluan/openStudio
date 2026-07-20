/**
 * Request redirect overrides for preview / Web Explore webview partition.
 */

"use strict";

const PREVIEW_PARTITION = "persist:openstudio-preview";

/** @type {{ info?: Function; warn?: Function } | null} */
let log = null;
/** @type {boolean} */
let hooked = false;
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

function ensureHook() {
  if (hooked) return;
  try {
    const ses = getPreviewSession();
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      try {
        const redirectURL = matchRedirectTarget(details.url);
        if (redirectURL) {
          log?.info?.(
            "[preview-request-override] redirect",
            String(details.url || "").slice(0, 160),
            "->",
            redirectURL,
          );
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

/**
 * Cached responses bypass onBeforeRequest — clear preview cache when rules change.
 */
async function clearPreviewSessionCache() {
  try {
    const ses = getPreviewSession();
    await ses.clearCache();
    return { ok: true };
  } catch (e) {
    log?.warn?.("[preview-request-override] clearCache failed:", e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * @param {unknown} groups
 */
async function setPreviewRequestOverrides(groups) {
  activeGroups = normalizeGroups(groups);
  ensureHook();
  const hasActiveRules = activeGroups.some(
    (group) => group.enabled && group.rules.some((rule) => rule.enabled),
  );
  if (!hasActiveRules) return { ok: true, cacheCleared: false, activeRuleCount: 0 };
  const cleared = await clearPreviewSessionCache();
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
};
