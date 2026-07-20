import { normalizeExploreRedirectGroups } from "./exploreRedirectOverride.js";
import {
  normalizeExploreTabPageScripts,
  serializeExploreTabPageScripts,
} from "./explorePageScript.js";

const STORAGE_KEY = "openstudio_web_explore_url_presets_v1";

export const EXPLORE_URL_PRESETS_CHANGE_EVENT = "openstudio-web-explore-presets-changed";

/**
 * @typedef {import("./exploreRedirectOverride.js").ExploreRedirectGroup} ExploreRedirectGroup
 *
 * @typedef {import("./explorePageScript.js").ExploreTabPageScript} ExploreTabPageScript
 *
 * @typedef {{
 *   id: string;
 *   urls: string[];
 *   redirectGroups?: ExploreRedirectGroup[];
 *   tabPageScripts?: (ExploreTabPageScript | null)[];
 *   createdAt: number;
 *   updatedAt: number;
 * }} ExploreUrlPreset
 */

/**
 * @param {string} raw
 */
export function normalizePresetUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("about:")) return s;
  return `https://${s}`;
}

/**
 * @param {string[]} urls
 */
export function collectPresetUrls(urls) {
  if (!Array.isArray(urls)) return [];
  /** @type {string[]} */
  const out = [];
  for (const raw of urls) {
    const next = normalizePresetUrl(raw);
    if (next) out.push(next);
  }
  return out;
}

/**
 * @param {string[]} urls
 */
export function presetUrlsFingerprint(urls) {
  return collectPresetUrls(urls).join("\n");
}

/** @returns {ExploreUrlPreset[]} */
export function loadExploreUrlPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map((row) => ({
        id: String(row?.id ?? "").trim(),
        urls: collectPresetUrls(row?.urls),
        redirectGroups: normalizeExploreRedirectGroups(row?.redirectGroups),
        tabPageScripts: normalizeExploreTabPageScripts(row?.tabPageScripts, collectPresetUrls(row?.urls).length),
        createdAt: Number(row?.createdAt) || 0,
        updatedAt: Number(row?.updatedAt) || 0,
      }))
      .filter((row) => row.id && row.urls.length > 0)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  } catch {
    return [];
  }
}

/** @param {ExploreUrlPreset[]} presets */
export function saveExploreUrlPresets(presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    window.dispatchEvent(new CustomEvent(EXPLORE_URL_PRESETS_CHANGE_EVENT));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * @param {string[]} urls
 * @param {string} [presetId] When set, update this preset in place (even if URLs changed).
 * @param {ExploreRedirectGroup[]} [redirectGroups]
 * @param {(ExploreTabPageScript | null)[]} [tabPageScripts]
 * @returns {ExploreUrlPreset | null}
 */
export function upsertExploreUrlPreset(urls, presetId, redirectGroups, tabPageScripts) {
  const normalized = collectPresetUrls(urls);
  if (!normalized.length) return null;

  const presets = loadExploreUrlPresets();
  const now = Date.now();
  const targetId = String(presetId ?? "").trim();

  const nextGroups =
    redirectGroups !== undefined ? normalizeExploreRedirectGroups(redirectGroups) : undefined;
  const nextScripts =
    tabPageScripts !== undefined
      ? serializeExploreTabPageScripts(normalizeExploreTabPageScripts(tabPageScripts, normalized.length))
      : undefined;

  if (targetId) {
    const existing = presets.find((row) => row.id === targetId);
    if (existing) {
      const updated = {
        ...existing,
        urls: normalized,
        redirectGroups: nextGroups ?? existing.redirectGroups ?? [],
        tabPageScripts: nextScripts ?? existing.tabPageScripts ?? [],
        updatedAt: now,
      };
      saveExploreUrlPresets([updated, ...presets.filter((row) => row.id !== targetId)]);
      return updated;
    }
  }

  const fingerprint = presetUrlsFingerprint(normalized);
  const matched = presets.find((row) => presetUrlsFingerprint(row.urls) === fingerprint);
  if (matched) {
    const updated = {
      ...matched,
      urls: normalized,
      redirectGroups: nextGroups ?? matched.redirectGroups ?? [],
      tabPageScripts: nextScripts ?? matched.tabPageScripts ?? [],
      updatedAt: now,
    };
    saveExploreUrlPresets([updated, ...presets.filter((row) => row.id !== matched.id)]);
    return updated;
  }

  const preset = {
    id: `explore_preset_${now.toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
    urls: normalized,
    redirectGroups: nextGroups ?? [],
    tabPageScripts: nextScripts ?? [],
    createdAt: now,
    updatedAt: now,
  };
  saveExploreUrlPresets([preset, ...presets]);
  return preset;
}

/**
 * @param {string} id
 */
export function removeExploreUrlPreset(id) {
  const nextId = String(id ?? "").trim();
  if (!nextId) return;
  saveExploreUrlPresets(loadExploreUrlPresets().filter((row) => row.id !== nextId));
}

/**
 * @param {string} url
 */
export function presetHostnameLabel(url) {
  const s = String(url ?? "").trim();
  if (!s || s.startsWith("about:")) return s;
  try {
    return new URL(s).hostname.replace(/^www\./i, "");
  } catch {
    return s;
  }
}

/**
 * @param {string[]} urls
 */
export function presetTitleFromUrls(urls) {
  const list = collectPresetUrls(urls);
  if (!list.length) return "";
  const first = presetHostnameLabel(list[0]);
  if (list.length === 1) return first;
  return `${first} +${list.length - 1}`;
}
