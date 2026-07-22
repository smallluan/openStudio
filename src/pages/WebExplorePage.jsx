import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import htmlwanderHero from "../assets/images/htmlwander.png";
import {
  ArrowLeft,
  Bot,
  Check,
  Code,
  ExternalLink,
  Layers,
  Monitor,
  Plus,
  RefreshCw,
  Replace,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { Button, Input } from "@open-studio/udesign";
import { useOutletContext } from "react-router-dom";
import ChatLabPreviewWebFrame from "../components/chat-lab/ChatLabPreviewWebFrame.jsx";
import WebExploreChatFloat from "../components/web-explore/WebExploreChatFloat.jsx";
import WebExploreRedirectModal from "../components/web-explore/WebExploreRedirectModal.jsx";
import WebExplorePageScriptModal from "../components/web-explore/WebExplorePageScriptModal.jsx";
import { openChatLabExternalUrl } from "../chat/chatLabLinkOpenPreference.js";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "../ui/cn.js";
import {
  EXPLORE_TAB_IDLE_HIBERNATE_MS,
  createExploreTab as createExploreTabRow,
  hibernateIdleExploreTabs,
  reconcileExploreTabLifecycle,
  touchExploreTab,
} from "../web-explore/exploreTabLifecycle.js";
import { collectPresetUrls, presetTitleFromUrls } from "../web-explore/exploreUrlPresetsStore.js";
import {
  createExploreRedirectGroup,
  hasActiveExploreRedirectRules,
  normalizeExploreRedirectGroups,
  serializeExploreRedirectGroups,
} from "../web-explore/exploreRedirectOverride.js";
import { useExploreUrlPresets } from "../web-explore/useExploreUrlPresets.js";
import {
  serializeExploreTabPageScripts,
} from "../web-explore/explorePageScript.js";

/**
 * @typedef {{
 *   id: string;
 *   url: string;
 *   frameKey: string;
 *   lastActiveAt: number;
 *   hibernated: boolean;
 *   pageScript?: import("../web-explore/explorePageScript.js").ExploreTabPageScript | null;
 * }} ExploreTab
 *
 * @typedef {{
 *   iframe: { current: HTMLIFrameElement | null };
 *   webview: { current: HTMLElement | null };
 * }} ExploreTabHostRefs
 */

const IDLE_SWEEP_MS = 30_000;

/**
 * @param {string} raw
 */
function normalizeExploreUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("about:")) return s;
  return `https://${s}`;
}

/**
 * @param {string} url
 */
function explorePageTitle(url) {
  const s = String(url ?? "").trim();
  if (!s || s.startsWith("about:")) return "";
  try {
    return new URL(s).hostname.replace(/^www\./i, "");
  } catch {
    return s;
  }
}

/** @param {string} [url] @param {import("../web-explore/explorePageScript.js").ExploreTabPageScript | null} [pageScript] @returns {ExploreTab} */
function createExploreTab(url = "", pageScript = null) {
  return { ...createExploreTabRow(normalizeExploreUrl(url)), pageScript: pageScript ?? null };
}

/**
 * @param {ExploreTab[]} tabs
 * @param {string} activeTabId
 */
function withLifecycle(tabs, activeTabId) {
  return reconcileExploreTabLifecycle(tabs, activeTabId);
}

export default function WebExplorePage() {
  const { t } = useI18n();
  const featureCards = useMemo(
    () => [
      { id: "automation", icon: Bot },
      { id: "session", icon: ShieldCheck },
      { id: "combos", icon: Layers },
    ],
    [],
  );
  const { collapsePrimaryRail } = useOutletContext() ?? {};
  const landingInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const barInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const viewportRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const iframeRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const webviewRef = useRef(/** @type {HTMLElement | null} */ (null));
  const tabHostRefsRef = useRef(/** @type {Map<string, ExploreTabHostRefs>} */ (new Map()));
  const openSeqRef = useRef(0);
  const tabsRef = useRef(/** @type {ExploreTab[]} */ ([]));
  const activeTabIdRef = useRef("");
  const activePresetIdRef = useRef("");
  const redirectGroupsRef = useRef(/** @type {import("../web-explore/exploreRedirectOverride.js").ExploreRedirectGroup[]} */ ([]));
  const [draft, setDraft] = useState("");
  const [tabs, setTabs] = useState(/** @type {ExploreTab[]} */ ([]));
  const [activeTabId, setActiveTabId] = useState("");
  const [activePresetId, setActivePresetId] = useState("");
  const [redirectGroups, setRedirectGroups] = useState(
    /** @type {import("../web-explore/exploreRedirectOverride.js").ExploreRedirectGroup[]} */ ([]),
  );
  const [redirectModalOpen, setRedirectModalOpen] = useState(false);
  const [pageScriptModalTabId, setPageScriptModalTabId] = useState("");
  const [tabContextMenu, setTabContextMenu] = useState(
    /** @type {{ tabId: string; x: number; y: number } | null} */ (null),
  );
  const [landingKey, setLandingKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState(/** @type {"desktop" | "mobile"} */ ("desktop"));
  const [saveComboDone, setSaveComboDone] = useState(false);
  const { presets, savePreset, deletePreset } = useExploreUrlPresets();
  const inElectron = typeof window !== "undefined" && Boolean(window.studioBridge);

  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  activePresetIdRef.current = activePresetId;
  redirectGroupsRef.current = redirectGroups;

  /** @param {string} tabId */
  const ensureTabHostRefs = useCallback((tabId) => {
    const id = String(tabId ?? "").trim();
    let refs = tabHostRefsRef.current.get(id);
    if (!refs) {
      refs = { iframe: { current: null }, webview: { current: null } };
      tabHostRefsRef.current.set(id, refs);
    }
    return refs;
  }, []);

  // Point chat/automation hosts at the visible live frame.
  useLayoutEffect(() => {
    const refs = tabHostRefsRef.current.get(activeTabId);
    iframeRef.current = refs?.iframe.current ?? null;
    webviewRef.current = refs?.webview.current ?? null;
  }, [activeTabId, tabs]);

  useEffect(() => {
    const live = new Set(tabs.map((tab) => tab.id));
    for (const id of [...tabHostRefsRef.current.keys()]) {
      if (!live.has(id)) tabHostRefsRef.current.delete(id);
    }
  }, [tabs]);

  // Soft-sleep: mute audio on inactive mounted tabs (hibernated tabs are unmounted).
  useEffect(() => {
    for (const [id, refs] of tabHostRefsRef.current) {
      const node = refs.webview.current;
      if (!node || typeof /** @type {any} */ (node).setAudioMuted !== "function") continue;
      try {
        /** @type {import("electron").WebviewTag} */
        const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
        wv.setAudioMuted(id !== activeTabId);
      } catch {
        /* ignore */
      }
    }
  }, [activeTabId, tabs]);

  // Idle hibernation sweep — discard warm-cache tabs that stayed unused.
  useEffect(() => {
    if (!tabs.length) return undefined;
    const timer = window.setInterval(() => {
      setTabs((prev) => {
        const idled = hibernateIdleExploreTabs(prev, activeTabIdRef.current, {
          idleMs: EXPLORE_TAB_IDLE_HIBERNATE_MS,
        });
        if (idled === prev) return prev;
        return withLifecycle(idled, activeTabIdRef.current);
      });
    }, IDLE_SWEEP_MS);
    return () => window.clearInterval(timer);
  }, [tabs.length > 0]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const activeUrl = activeTab?.url ?? "";
  const browsing = tabs.length > 0;
  const savableComboUrls = useMemo(
    () => collectPresetUrls(tabs.map((tab) => tab.url)),
    [tabs],
  );
  const canSaveCombo = savableComboUrls.length > 0;
  const redirectActive = useMemo(() => hasActiveExploreRedirectRules(redirectGroups), [redirectGroups]);

  useEffect(() => {
    if (!tabContextMenu) return undefined;
    const close = () => setTabContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [tabContextMenu]);

  const syncRedirectOverrides = useCallback(async () => {
    if (!inElectron) return null;
    const bridge = window.studioBridge;
    if (typeof bridge?.setPreviewRequestOverrides !== "function") return null;
    return bridge.setPreviewRequestOverrides({
      groups: serializeExploreRedirectGroups(redirectGroupsRef.current),
    });
  }, [inElectron]);

  useLayoutEffect(() => {
    if (!inElectron || redirectModalOpen) return undefined;
    void syncRedirectOverrides();
    return undefined;
  }, [inElectron, redirectGroups, redirectModalOpen, syncRedirectOverrides]);

  useEffect(() => {
    if (!inElectron || !redirectModalOpen) return undefined;
    const timer = window.setTimeout(() => {
      void syncRedirectOverrides();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [inElectron, redirectGroups, redirectModalOpen, syncRedirectOverrides]);

  const refreshPreviewDevCacheIfNeeded = useCallback(async () => {
    if (!inElectron || !hasActiveExploreRedirectRules(redirectGroupsRef.current)) return;
    const bridge = window.studioBridge;
    if (typeof bridge?.refreshPreviewDevCache === "function") {
      await bridge.refreshPreviewDevCache();
    }
  }, [inElectron]);

  const reloadActiveFrameIgnoringCache = useCallback(async () => {
    if (!activeUrl) return;
    await refreshPreviewDevCacheIfNeeded();
    const id = activeTabIdRef.current;
    if (activeTab?.hibernated || (!webviewRef.current && !iframeRef.current)) {
      if (!id) return;
      setTabs((prev) =>
        withLifecycle(
          prev.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  hibernated: false,
                  lastActiveAt: Date.now(),
                  frameKey: `explore-${tab.id}-${Date.now()}`,
                }
              : tab,
          ),
          id,
        ),
      );
      return;
    }
    if (inElectron) {
      const node = webviewRef.current;
      if (node) {
        try {
          /** @type {import("electron").WebviewTag} */
          const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
          if (typeof wv.reloadIgnoringCache === "function") {
            wv.reloadIgnoringCache();
          } else {
            wv.reload?.();
          }
          return;
        } catch {
          /* fallthrough */
        }
      }
    }
    const iframe = iframeRef.current;
    if (iframe) {
      try {
        const bust = activeUrl.includes("?") ? "&" : "?";
        iframe.src = `${activeUrl}${bust}_os_cache_bust=${Date.now()}`;
        return;
      } catch {
        /* fallthrough */
      }
    }
    if (!id) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id ? { ...tab, frameKey: `explore-${tab.id}-${Date.now()}` } : tab,
      ),
    );
  }, [activeTab?.hibernated, activeUrl, inElectron, refreshPreviewDevCacheIfNeeded]);

  const focusBarInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      try {
        barInputRef.current?.focus?.();
        barInputRef.current?.select?.();
      } catch {
        /* ignore */
      }
    });
  }, []);

  /** @param {() => void} apply */
  const withRailCollapsedIfNeeded = useCallback(
    async (apply) => {
      const seq = ++openSeqRef.current;
      const firstOpen = tabsRef.current.length === 0;
      if (firstOpen && typeof collapsePrimaryRail === "function") {
        await collapsePrimaryRail();
        if (seq !== openSeqRef.current) return;
      }
      apply();
    },
    [collapsePrimaryRail],
  );

  /**
   * Open / navigate. From landing or "+" creates a tab; address-bar submit updates the active tab.
   * @param {string} raw
   * @param {{ asNewTab?: boolean; remount?: boolean }} [opts]
   */
  const commitUrl = useCallback(
    async (raw, opts = {}) => {
      const next = normalizeExploreUrl(raw);
      if (!next) return;
      const asNewTab = Boolean(opts.asNewTab);
      const remount = opts.remount !== false;
      setDraft(next);
      await withRailCollapsedIfNeeded(() => {
        if (!tabsRef.current.length) {
          setActivePresetId("");
          setRedirectGroups([]);
        }
        if (!tabsRef.current.length || asNewTab) {
          const tab = createExploreTab(next);
          setTabs((prev) => withLifecycle([...prev, tab], tab.id));
          setActiveTabId(tab.id);
          return;
        }
        const id = activeTabIdRef.current;
        setTabs((prev) =>
          withLifecycle(
            prev.map((tab) => {
              if (tab.id !== id) return tab;
              return {
                ...tab,
                url: next,
                lastActiveAt: Date.now(),
                hibernated: false,
                frameKey: remount ? `explore-${tab.id}-${Date.now()}` : tab.frameKey,
              };
            }),
            id,
          ),
        );
      });
    },
    [withRailCollapsedIfNeeded],
  );

  const handleSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      void commitUrl(draft);
    },
    [commitUrl, draft],
  );

  const handleBackToLanding = useCallback(() => {
    openSeqRef.current += 1;
    setTabs([]);
    setActiveTabId("");
    setActivePresetId("");
    setRedirectGroups([]);
    setDraft("");
    setLandingKey((k) => k + 1);
  }, []);

  const handleAddTab = useCallback(() => {
    void withRailCollapsedIfNeeded(() => {
      const tab = createExploreTab("");
      setTabs((prev) => withLifecycle([...prev, tab], tab.id));
      setActiveTabId(tab.id);
      setDraft("");
      focusBarInput();
    });
  }, [focusBarInput, withRailCollapsedIfNeeded]);

  const handleRemoveTab = useCallback((options) => {
    const id = String(options?.value ?? "").trim();
    if (!id) return;
    const prev = tabsRef.current;
    const idx = prev.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const next = prev.filter((tab) => tab.id !== id);
    if (!next.length) {
      openSeqRef.current += 1;
      setTabs([]);
      setActiveTabId("");
      setActivePresetId("");
      setRedirectGroups([]);
      setDraft("");
      setLandingKey((k) => k + 1);
      return;
    }
    if (activeTabIdRef.current === id) {
      const fallback = next[Math.min(idx, next.length - 1)];
      setActiveTabId(fallback.id);
      setDraft(fallback.url);
      setTabs(withLifecycle(touchExploreTab(next, fallback.id), fallback.id));
      return;
    }
    setTabs(withLifecycle(next, activeTabIdRef.current));
  }, []);

  const handleActivateTab = useCallback((value) => {
    const id = String(value ?? "").trim();
    if (!id) return;
    const tab = tabsRef.current.find((row) => row.id === id);
    if (!tab) return;
    setActiveTabId(id);
    setDraft(tab.url);
    // Wake hibernated tabs and rebalance the warm cache (LRU discard).
    setTabs((prev) => withLifecycle(touchExploreTab(prev, id), id));
  }, []);

  const handleNavigate = useCallback((tabId, url) => {
    const id = String(tabId ?? "").trim();
    const next = normalizeExploreUrl(url);
    if (!id || !next) return;
    setTabs((prev) =>
      withLifecycle(
        prev.map((tab) =>
          tab.id === id
            ? { ...tab, url: next, lastActiveAt: Date.now(), hibernated: false }
            : tab,
        ),
        activeTabIdRef.current,
      ),
    );
    if (activeTabIdRef.current === id) setDraft(next);
  }, []);

  // Guest window.open is denied in main and forwarded here — open in a new tab when browsing.
  useEffect(() => {
    if (!inElectron) return undefined;
    const subscribe = window.studioBridge?.onOpenPreviewUrl;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((payload) => {
      const next = normalizeExploreUrl(payload?.url);
      if (!next) return;
      if (tabsRef.current.length > 0) {
        void commitUrl(next, { asNewTab: true });
        return;
      }
      void commitUrl(next);
    });
  }, [commitUrl, inElectron]);

  const handleReload = useCallback(() => {
    if (!activeUrl) return;
    if (redirectActive && inElectron) {
      void reloadActiveFrameIgnoringCache();
      return;
    }
    const id = activeTabIdRef.current;
    // Hibernated active (shouldn't happen) or missing host → remount.
    if (activeTab?.hibernated || (!webviewRef.current && !iframeRef.current)) {
      if (!id) return;
      setTabs((prev) =>
        withLifecycle(
          prev.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  hibernated: false,
                  lastActiveAt: Date.now(),
                  frameKey: `explore-${tab.id}-${Date.now()}`,
                }
              : tab,
          ),
          id,
        ),
      );
      return;
    }
    if (inElectron) {
      const node = webviewRef.current;
      if (node) {
        try {
          /** @type {import("electron").WebviewTag} */
          const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
          wv.reload?.();
          return;
        } catch {
          /* fallthrough */
        }
      }
    }
    const iframe = iframeRef.current;
    if (iframe) {
      try {
        iframe.src = activeUrl;
        return;
      } catch {
        /* fallthrough */
      }
    }
    if (!id) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id ? { ...tab, frameKey: `explore-${tab.id}-${Date.now()}` } : tab,
      ),
    );
  }, [activeTab?.hibernated, activeUrl, inElectron, redirectActive, reloadActiveFrameIgnoringCache]);

  const handleOpenExternal = useCallback(() => {
    if (!activeUrl || activeUrl.startsWith("about:")) return;
    openChatLabExternalUrl(activeUrl, { forceExternal: true });
  }, [activeUrl]);

  /**
   * @param {string[]} urls
   * @param {string} [presetId]
   */
  const openUrlPreset = useCallback(
    async (urls, presetId) => {
      const list = collectPresetUrls(urls);
      if (!list.length) return;
      const nextPresetId = String(presetId ?? "").trim();
      const preset = presets.find((row) => row.id === nextPresetId);
      const groups = normalizeExploreRedirectGroups(preset?.redirectGroups);
      if (inElectron && hasActiveExploreRedirectRules(groups)) {
        const bridge = window.studioBridge;
        if (typeof bridge?.setPreviewRequestOverrides === "function") {
          await bridge.setPreviewRequestOverrides({
            groups: serializeExploreRedirectGroups(groups),
          });
        }
        if (typeof bridge?.refreshPreviewDevCache === "function") {
          await bridge.refreshPreviewDevCache();
        }
      }
      await withRailCollapsedIfNeeded(() => {
        const nextTabs = list.map((url, index) =>
          createExploreTab(url, preset?.tabPageScripts?.[index] ?? null),
        );
        const activeId = nextTabs[0].id;
        setTabs(withLifecycle(nextTabs, activeId));
        setActiveTabId(activeId);
        setActivePresetId(nextPresetId);
        setRedirectGroups(groups);
        setDraft(list[0]);
      });
    },
    [inElectron, presets, withRailCollapsedIfNeeded],
  );

  const persistCombo = useCallback(
    (tabsOverride) => {
      const tabRows = tabsOverride ?? tabsRef.current;
      const urls = collectPresetUrls(tabRows.map((tab) => tab.url));
      if (!urls.length) return null;
      const scripts = tabRows.map((tab) => tab.pageScript ?? null);
      const row = savePreset(
        urls,
        activePresetIdRef.current || undefined,
        redirectGroupsRef.current,
        serializeExploreTabPageScripts(scripts),
      );
      if (row?.id) setActivePresetId(row.id);
      return row;
    },
    [savePreset],
  );

  const handleSaveCombo = useCallback(() => {
    const row = persistCombo();
    if (!row) return;
    setSaveComboDone(true);
    window.setTimeout(() => setSaveComboDone(false), 2000);
  }, [persistCombo]);

  /** @param {string} tabId */
  const handleTabContextMenu = useCallback((tabId, e) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenPageScriptModal = useCallback((tabId) => {
    setTabContextMenu(null);
    setPageScriptModalTabId(String(tabId ?? "").trim());
  }, []);

  const handleClosePageScriptModal = useCallback(() => {
    setPageScriptModalTabId("");
  }, []);

  /** @param {import("../web-explore/explorePageScript.js").ExploreTabPageScript | null} script */
  const handleSavePageScript = useCallback(
    (script) => {
      const tabId = String(pageScriptModalTabId ?? "").trim();
      if (!tabId) return;
      const nextTabs = tabsRef.current.map((tab) =>
        tab.id === tabId
          ? { ...tab, pageScript: script, frameKey: `explore-${tab.id}-${Date.now()}` }
          : tab,
      );
      setTabs(nextTabs);
      persistCombo(nextTabs);
      setPageScriptModalTabId("");
    },
    [pageScriptModalTabId, persistCombo],
  );

  const pageScriptModalTab = useMemo(
    () => tabs.find((tab) => tab.id === pageScriptModalTabId) ?? null,
    [pageScriptModalTabId, tabs],
  );
  const pageScriptModalIndex = useMemo(
    () => (pageScriptModalTab ? tabs.findIndex((tab) => tab.id === pageScriptModalTab.id) : -1),
    [pageScriptModalTab, tabs],
  );

  const handleOpenDevTools = useCallback(() => {
    const node = webviewRef.current;
    if (!node) return;
    try {
      /** @type {import("electron").WebviewTag} */
      const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
      wv.openDevTools?.();
    } catch {
      /* ignore */
    }
  }, []);

  const handleOpenRedirectModal = useCallback(() => {
    if (redirectGroupsRef.current.length === 0) {
      setRedirectGroups([createExploreRedirectGroup(t("webExplorePage.redirectDefaultGroupName"))]);
    }
    setRedirectModalOpen(true);
  }, [t]);

  const handleCloseRedirectModal = useCallback(() => {
    setRedirectModalOpen(false);
    if (!hasActiveExploreRedirectRules(redirectGroupsRef.current)) return;
    window.setTimeout(() => {
      void syncRedirectOverrides().then(() => reloadActiveFrameIgnoringCache());
    }, 0);
  }, [reloadActiveFrameIgnoringCache, syncRedirectOverrides]);

  if (!browsing) {
    return (
      <div className="web-explore-page">
        <div className="web-explore-page__landing" aria-label={t("nav.webExplore")}>
          <div className="web-explore-page__hero" aria-hidden>
            <img
              className="web-explore-page__hero-img"
              src={htmlwanderHero}
              alt=""
            />
          </div>
          <section className="web-explore-page__features" aria-label={t("webExplorePage.featuresAria")}>
            {featureCards.map(({ id, icon: Icon }) => (
              <article key={id} className="web-explore-page__feature-card">
                <div className="web-explore-page__feature-head">
                  <span className="web-explore-page__feature-icon" aria-hidden>
                    <Icon size={18} strokeWidth={1.9} />
                  </span>
                  <h2 className="web-explore-page__feature-title">{t(`webExplorePage.features.${id}.title`)}</h2>
                </div>
                <p className="web-explore-page__feature-desc">{t(`webExplorePage.features.${id}.description`)}</p>
              </article>
            ))}
          </section>
          <form key={landingKey} className="web-explore-page__form" onSubmit={handleSubmit}>
            <Input
              ref={landingInputRef}
              block
              align="center"
              size="large"
              autofocus
              autocomplete="off"
              spellCheck={false}
              className="web-explore-page__input"
              value={draft}
              onChange={setDraft}
              placeholder={t("webExplorePage.urlPlaceholder")}
              aria-label={t("webExplorePage.urlInputAria")}
              suffix={
                <Button
                  type="submit"
                  theme="primary"
                  size="small"
                  className="web-explore-page__input-submit"
                >
                  {t("webExplorePage.startExplore")}
                </Button>
              }
            />
          </form>
          {presets.length > 0 ? (
            <section className="web-explore-page__saved" aria-label={t("webExplorePage.savedCombosAria")}>
              <h2 className="web-explore-page__saved-title">{t("webExplorePage.savedCombosTitle")}</h2>
              <ul className="web-explore-page__saved-list">
                {presets.map((preset) => {
                  const title = presetTitleFromUrls(preset.urls);
                  const tabCount = preset.urls.length;
                  return (
                    <li key={preset.id} className="web-explore-page__saved-item">
                      <button
                        type="button"
                        className="web-explore-page__saved-open"
                        title={t("webExplorePage.openCombo")}
                        aria-label={t("webExplorePage.openCombo")}
                        onClick={() => void openUrlPreset(preset.urls, preset.id)}
                      >
                        <span className="web-explore-page__saved-open-icon" aria-hidden>
                          <Layers size={15} strokeWidth={1.85} />
                        </span>
                        <span className="web-explore-page__saved-open-main">
                          <span className="web-explore-page__saved-open-title">{title}</span>
                          <span className="web-explore-page__saved-open-meta">
                            {t("webExplorePage.comboTabCount", { count: tabCount })}
                          </span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="text"
                        shape="square"
                        size="small"
                        className="web-explore-page__saved-delete"
                        title={t("webExplorePage.deleteCombo")}
                        aria-label={t("webExplorePage.deleteCombo")}
                        onClick={() => deletePreset(preset.id)}
                      >
                        <X size={14} strokeWidth={2.1} aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="web-explore-page web-explore-page--active">
      <header className="web-explore-page__bar">
        <Button
          type="button"
          variant="text"
          shape="square"
          size="small"
          className="web-explore-page__back"
          onClick={handleBackToLanding}
          title={t("webExplorePage.backToStart")}
          aria-label={t("webExplorePage.backToStart")}
        >
          <ArrowLeft size={16} strokeWidth={2.1} aria-hidden />
        </Button>
        <form className="web-explore-page__bar-form" onSubmit={handleSubmit}>
          <Input
            ref={barInputRef}
            block
            borderless
            autocomplete="off"
            spellCheck={false}
            size="small"
            className="web-explore-page__bar-input"
            value={draft}
            onChange={setDraft}
            placeholder={t("webExplorePage.urlPlaceholder")}
            aria-label={t("webExplorePage.urlPlaceholder")}
          />
        </form>
        <div className="web-explore-page__bar-actions">
          <div
            className="web-explore-page__device-toggle"
            role="group"
            aria-label={t("chatLab.previewDeviceModeAria")}
          >
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className={cn(
                "web-explore-page__bar-btn",
                "web-explore-page__device-btn",
                deviceMode === "desktop" && "web-explore-page__device-btn--active",
              )}
              onClick={() => setDeviceMode("desktop")}
              title={t("chatLab.previewDeviceDesktop")}
              aria-label={t("chatLab.previewDeviceDesktop")}
              aria-pressed={deviceMode === "desktop"}
            >
              <Monitor size={15} strokeWidth={1.75} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className={cn(
                "web-explore-page__bar-btn",
                "web-explore-page__device-btn",
                deviceMode === "mobile" && "web-explore-page__device-btn--active",
              )}
              onClick={() => setDeviceMode("mobile")}
              title={t("chatLab.previewDeviceMobile")}
              aria-label={t("chatLab.previewDeviceMobile")}
              aria-pressed={deviceMode === "mobile"}
            >
              <Smartphone size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className={cn(
              "web-explore-page__bar-btn",
              redirectActive && "web-explore-page__bar-btn--redirect-active",
            )}
            onClick={handleOpenRedirectModal}
            title={t("webExplorePage.redirectButton")}
            aria-label={t("webExplorePage.redirectButton")}
            aria-pressed={redirectActive}
          >
            <Replace size={15} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className={cn(
              "web-explore-page__bar-btn",
              saveComboDone && "web-explore-page__bar-btn--saved",
            )}
            onClick={handleSaveCombo}
            disabled={!canSaveCombo}
            title={
              saveComboDone ? t("webExplorePage.saveComboDone") : t("webExplorePage.saveCombo")
            }
            aria-label={
              saveComboDone ? t("webExplorePage.saveComboDone") : t("webExplorePage.saveCombo")
            }
          >
            {saveComboDone ? (
              <Check size={15} strokeWidth={2.1} aria-hidden />
            ) : (
              <Layers size={15} strokeWidth={1.75} aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="web-explore-page__bar-btn"
            onClick={handleReload}
            disabled={!activeUrl}
            title={t("chatLab.previewReload")}
            aria-label={t("chatLab.previewReload")}
          >
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="web-explore-page__bar-btn"
            onClick={handleOpenExternal}
            disabled={!activeUrl || activeUrl.startsWith("about:")}
            title={t("chatLab.previewOpenExternal")}
            aria-label={t("chatLab.previewOpenExternal")}
          >
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
          </Button>
          {inElectron ? (
            <Button
              type="button"
              variant="text"
              shape="square"
              size="small"
              className="web-explore-page__bar-btn"
              onClick={handleOpenDevTools}
              disabled={!activeUrl || Boolean(activeTab?.hibernated)}
              title={t("chatLab.previewOpenDevTools")}
              aria-label={t("chatLab.previewOpenDevTools")}
            >
              <Code size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="web-explore-page__tabs" aria-label={t("webExplorePage.tabsAria")}>
        <div className="web-explore-page__tabs-row">
          <div className="web-explore-page__tabs-list" role="tablist">
            {tabs.map((tab) => {
              const labelText = tab.url || t("webExplorePage.newTab");
              const selected = tab.id === activeTabId;
              const hibernated = Boolean(tab.hibernated && tab.url);
              const hasPageScript = Boolean(tab.pageScript?.code?.trim());
              return (
                <div
                  key={tab.id}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  aria-selected={selected}
                  title={hibernated ? t("webExplorePage.tabHibernatedHint") : labelText}
                  className={cn(
                    "web-explore-page__tab",
                    selected && "web-explore-page__tab--active",
                    hibernated && "web-explore-page__tab--hibernated",
                    hasPageScript && "web-explore-page__tab--has-script",
                  )}
                  onClick={() => handleActivateTab(tab.id)}
                  onContextMenu={(e) => handleTabContextMenu(tab.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleActivateTab(tab.id);
                    }
                  }}
                >
                  <span className="web-explore-page__tab-label">{labelText}</span>
                  <button
                    type="button"
                    className="web-explore-page__tab-close"
                    title={t("webExplorePage.closeTab")}
                    aria-label={t("webExplorePage.closeTab")}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTab({ value: tab.id });
                    }}
                  >
                    <X size={12} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="web-explore-page__tab-add"
            onClick={handleAddTab}
            title={t("webExplorePage.newTab")}
            aria-label={t("webExplorePage.newTab")}
          >
            <Plus size={14} strokeWidth={2.1} aria-hidden />
          </Button>
        </div>
      </div>

      <div ref={viewportRef} className={cn("web-explore-page__viewport", "chat-lab-preview-dock__body")}>
        <div className="web-explore-page__frame-stack">
          {tabs.map((tab) => {
            const preLoadScript = tab.pageScript?.code ?? "";
            const active = tab.id === activeTabId;
            if (!tab.url) {
              if (!active) return null;
              return (
                <div
                  key={tab.id}
                  className="web-explore-page__frame-slot web-explore-page__frame-slot--active"
                >
                  <div className="web-explore-page__empty-tab">
                    <p>{t("webExplorePage.emptyTabHint")}</p>
                  </div>
                </div>
              );
            }
            // Hibernated tabs keep URL in the strip but drop the frame (Chromium-style discard).
            if (tab.hibernated) return null;
            const hostRefs = ensureTabHostRefs(tab.id);
            return (
              <div
                key={tab.id}
                className={cn(
                  "web-explore-page__frame-slot",
                  active && "web-explore-page__frame-slot--active",
                )}
                aria-hidden={!active}
              >
                <ChatLabPreviewWebFrame
                  src={tab.url}
                  title={explorePageTitle(tab.url) || t("webExplorePage.newTab")}
                  frameKey={tab.frameKey}
                  useWebview={inElectron}
                  deviceMode={deviceMode}
                  preLoadScript={preLoadScript}
                  iframeRef={hostRefs.iframe}
                  webviewRefFromContext={hostRefs.webview}
                  onNavigate={(url) => handleNavigate(tab.id, url)}
                  className="web-explore-page__frame"
                />
              </div>
            );
          })}
        </div>
        {activeUrl ? (
          <WebExploreChatFloat
            activeUrl={activeUrl}
            pageTitle={explorePageTitle(activeUrl)}
            inElectron={inElectron}
            boundaryRef={viewportRef}
            webviewRef={webviewRef}
            iframeRef={iframeRef}
            onNavigate={(url) => handleNavigate(activeTabId, url)}
          />
        ) : null}
      </div>
      <WebExploreRedirectModal
        open={redirectModalOpen}
        groups={redirectGroups}
        inElectron={inElectron}
        onChange={setRedirectGroups}
        onClose={handleCloseRedirectModal}
      />
      {tabContextMenu ? (
        <div
          className="web-explore-page__tab-menu"
          style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="web-explore-page__tab-menu-item"
            role="menuitem"
            onClick={() => handleOpenPageScriptModal(tabContextMenu.tabId)}
          >
            {t("webExplorePage.pageScriptMenu")}
          </button>
        </div>
      ) : null}
      <WebExplorePageScriptModal
        open={Boolean(pageScriptModalTabId)}
        tabIndex={Math.max(0, pageScriptModalIndex)}
        tabUrl={pageScriptModalTab?.url ?? ""}
        script={pageScriptModalTab?.pageScript ?? null}
        inElectron={inElectron}
        onSave={handleSavePageScript}
        onClose={handleClosePageScriptModal}
      />
    </div>
  );
}
