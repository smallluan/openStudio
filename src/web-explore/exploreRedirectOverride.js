/**
 * Request redirect override rules for Web Explore (Resource Override style).
 */

/**
 * @typedef {{
 *   id: string;
 *   from: string;
 *   to: string;
 *   enabled: boolean;
 * }} ExploreRedirectRule
 *
 * @typedef {{
 *   id: string;
 *   name: string;
 *   enabled: boolean;
 *   rules: ExploreRedirectRule[];
 * }} ExploreRedirectGroup
 */

/**
 * @param {string} [prefix]
 */
export function createExploreRedirectRuleId(prefix = "rule") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * @param {string} [name]
 */
export function createExploreRedirectGroup(name = "") {
  return {
    id: createExploreRedirectRuleId("group"),
    name: String(name ?? "").trim(),
    enabled: true,
    rules: [],
  };
}

/**
 * @param {unknown} raw
 * @returns {ExploreRedirectRule | null}
 */
export function normalizeExploreRedirectRule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const from = String(row.from ?? "").trim();
  const to = String(row.to ?? "").trim();
  if (!from || !to) return null;
  return {
    id: String(row.id ?? createExploreRedirectRuleId()).trim() || createExploreRedirectRuleId(),
    from,
    to,
    enabled: row.enabled !== false,
  };
}

/**
 * @param {unknown} raw
 * @returns {ExploreRedirectGroup | null}
 */
export function normalizeExploreRedirectGroup(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const rulesRaw = Array.isArray(row.rules) ? row.rules : [];
  const rules = rulesRaw.map(normalizeExploreRedirectRule).filter(Boolean);
  return {
    id: String(row.id ?? createExploreRedirectRuleId("group")).trim() || createExploreRedirectRuleId("group"),
    name: String(row.name ?? "").trim(),
    enabled: row.enabled !== false,
    rules: /** @type {ExploreRedirectRule[]} */ (rules),
  };
}

/**
 * @param {unknown} raw
 * @returns {ExploreRedirectGroup[]}
 */
export function normalizeExploreRedirectGroups(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeExploreRedirectGroup).filter(Boolean);
}

/**
 * @param {ExploreRedirectGroup[]} groups
 */
export function hasActiveExploreRedirectRules(groups) {
  if (!Array.isArray(groups)) return false;
  return groups.some((group) => group.enabled && group.rules.some((rule) => rule.enabled));
}

/**
 * Glob-style pattern (`*` wildcard) to RegExp for full URL matching.
 * @param {string} pattern
 */
export function exploreRedirectPatternToRegExp(pattern) {
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
export function exploreRedirectUrlMatchCandidates(url) {
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
    /* ignore */
  }
  return out;
}

/**
 * @param {string} url
 * @param {string} pattern
 */
export function exploreRedirectUrlMatchesPattern(url, pattern) {
  const re = exploreRedirectPatternToRegExp(pattern);
  if (!re) return false;
  for (const candidate of exploreRedirectUrlMatchCandidates(url)) {
    if (re.test(candidate)) return true;
  }
  return false;
}

/**
 * @param {string} url
 * @param {ExploreRedirectGroup[]} groups
 * @returns {string | null}
 */
export function matchExploreRedirectTarget(url, groups) {
  const target = String(url ?? "").trim();
  if (!target) return null;
  for (const group of groups) {
    if (!group?.enabled) continue;
    for (const rule of group.rules) {
      if (!rule?.enabled) continue;
      if (exploreRedirectUrlMatchesPattern(target, rule.from)) return rule.to;
    }
  }
  return null;
}

/**
 * Flatten groups into serializable payload for main process.
 * @param {ExploreRedirectGroup[]} groups
 */
export function serializeExploreRedirectGroups(groups) {
  return normalizeExploreRedirectGroups(groups).map((group) => ({
    id: group.id,
    name: group.name,
    enabled: group.enabled,
    rules: group.rules.map((rule) => ({
      id: rule.id,
      from: rule.from,
      to: rule.to,
      enabled: rule.enabled,
    })),
  }));
}
