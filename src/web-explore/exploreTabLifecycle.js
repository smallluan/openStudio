/**
 * Web Explore tab survival: keep a small warm cache of mounted frames,
 * hibernate (discard) the rest — similar to Chromium tab discarding.
 */

/** Max webviews/iframes kept mounted at once (active + warm cache). */
export const EXPLORE_TAB_MAX_LIVE = 3;

/** Inactive mounted tabs hibernate after this idle period. */
export const EXPLORE_TAB_IDLE_HIBERNATE_MS = 5 * 60 * 1000;

/**
 * @typedef {{
 *   lifecycle: "beforeLoad";
 *   code: string;
 * }} ExploreTabPageScript
 *
 * @typedef {{
 *   id: string;
 *   url: string;
 *   frameKey: string;
 *   lastActiveAt: number;
 *   hibernated: boolean;
 *   pageScript?: ExploreTabPageScript | null;
 * }} ExploreTab
 */

/**
 * @param {string} [url]
 * @param {number} [now]
 * @returns {ExploreTab}
 */
export function createExploreTab(url = "", now = Date.now()) {
  const id = `webtab_${now.toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const normalized = String(url ?? "").trim();
  return {
    id,
    url: normalized,
    frameKey: `explore-${id}-${now}`,
    lastActiveAt: now,
    hibernated: false,
  };
}

/**
 * @param {ExploreTab[]} tabs
 * @param {string} tabId
 * @param {number} [now]
 * @returns {ExploreTab[]}
 */
export function touchExploreTab(tabs, tabId, now = Date.now()) {
  const id = String(tabId ?? "").trim();
  if (!id) return tabs;
  return tabs.map((tab) =>
    tab.id === id ? { ...tab, lastActiveAt: now, hibernated: false } : tab,
  );
}

/**
 * Keep the active tab + recently used tabs mounted (up to maxLive).
 * Remaining tabs with a URL are hibernated (frame unmounted, URL retained).
 *
 * @param {ExploreTab[]} tabs
 * @param {string} activeTabId
 * @param {{ maxLive?: number }} [opts]
 * @returns {ExploreTab[]}
 */
export function reconcileExploreTabLifecycle(tabs, activeTabId, opts = {}) {
  const list = Array.isArray(tabs) ? tabs : [];
  const maxLive = Math.max(1, Number(opts.maxLive) || EXPLORE_TAB_MAX_LIVE);
  const activeId = String(activeTabId ?? "").trim();

  /** @type {ExploreTab[]} */
  const mountedCandidates = list.filter((tab) => tab && String(tab.url ?? "").trim());
  const ranked = [...mountedCandidates].sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return (Number(b.lastActiveAt) || 0) - (Number(a.lastActiveAt) || 0);
  });

  /** @type {Set<string>} */
  const liveIds = new Set();
  for (const tab of ranked) {
    if (liveIds.size >= maxLive) break;
    liveIds.add(tab.id);
  }
  if (activeId && mountedCandidates.some((tab) => tab.id === activeId)) {
    liveIds.add(activeId);
    if (liveIds.size > maxLive) {
      const drop = ranked
        .filter((tab) => tab.id !== activeId && liveIds.has(tab.id))
        .sort((a, b) => (Number(a.lastActiveAt) || 0) - (Number(b.lastActiveAt) || 0));
      while (liveIds.size > maxLive && drop.length) {
        liveIds.delete(drop.shift().id);
      }
    }
  }

  let changed = false;
  const next = list.map((tab) => {
    if (!tab) return tab;
    if (!String(tab.url ?? "").trim()) {
      if (tab.hibernated) {
        changed = true;
        return { ...tab, hibernated: false };
      }
      return tab;
    }
    const shouldLive = liveIds.has(tab.id);
    if (shouldLive) {
      if (tab.hibernated) {
        changed = true;
        return { ...tab, hibernated: false };
      }
      return tab;
    }
    if (!tab.hibernated) {
      changed = true;
      return { ...tab, hibernated: true };
    }
    return tab;
  });

  return changed ? next : list;
}

/**
 * Hibernate mounted inactive tabs that have been idle too long.
 *
 * @param {ExploreTab[]} tabs
 * @param {string} activeTabId
 * @param {{ idleMs?: number; now?: number }} [opts]
 * @returns {ExploreTab[]}
 */
export function hibernateIdleExploreTabs(tabs, activeTabId, opts = {}) {
  const list = Array.isArray(tabs) ? tabs : [];
  const idleMs = Math.max(1_000, Number(opts.idleMs) || EXPLORE_TAB_IDLE_HIBERNATE_MS);
  const now = Number(opts.now) || Date.now();
  const activeId = String(activeTabId ?? "").trim();

  let changed = false;
  const next = list.map((tab) => {
    if (!tab || !String(tab.url ?? "").trim()) return tab;
    if (tab.hibernated || tab.id === activeId) return tab;
    if (now - (Number(tab.lastActiveAt) || 0) < idleMs) return tab;
    changed = true;
    return { ...tab, hibernated: true };
  });

  return changed ? next : list;
}
