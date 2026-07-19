import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Code,
  ExternalLink,
  Globe,
  Layers,
  Monitor,
  Plus,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";
import { Button, Input } from "@open-studio/udesign";
import { useOutletContext } from "react-router-dom";
import ChatLabPreviewWebFrame from "../components/chat-lab/ChatLabPreviewWebFrame.jsx";
import WebExploreChatFloat from "../components/web-explore/WebExploreChatFloat.jsx";
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
import { useExploreUrlPresets } from "../web-explore/useExploreUrlPresets.js";

/**
 * @typedef {{
 *   id: string;
 *   url: string;
 *   frameKey: string;
 *   lastActiveAt: number;
 *   hibernated: boolean;
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

/** @param {string} [url] @returns {ExploreTab} */
function createExploreTab(url = "") {
  return createExploreTabRow(normalizeExploreUrl(url));
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
  const [draft, setDraft] = useState("");
  const [tabs, setTabs] = useState(/** @type {ExploreTab[]} */ ([]));
  const [activeTabId, setActiveTabId] = useState("");
  const [activePresetId, setActivePresetId] = useState("");
  const [landingKey, setLandingKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState(/** @type {"desktop" | "mobile"} */ ("desktop"));
  const [saveComboDone, setSaveComboDone] = useState(false);
  const { presets, savePreset, deletePreset } = useExploreUrlPresets();
  const inElectron = typeof window !== "undefined" && Boolean(window.studioBridge);

  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  activePresetIdRef.current = activePresetId;

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
  }, [activeTab?.hibernated, activeUrl, inElectron]);

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
      await withRailCollapsedIfNeeded(() => {
        const nextTabs = list.map((url) => createExploreTab(url));
        const activeId = nextTabs[0].id;
        setTabs(withLifecycle(nextTabs, activeId));
        setActiveTabId(activeId);
        setActivePresetId(nextPresetId);
        setDraft(list[0]);
      });
    },
    [withRailCollapsedIfNeeded],
  );

  const handleSaveCombo = useCallback(() => {
    const urls = collectPresetUrls(tabsRef.current.map((tab) => tab.url));
    if (!urls.length) return;
    const row = savePreset(urls, activePresetIdRef.current || undefined);
    if (row?.id) setActivePresetId(row.id);
    setSaveComboDone(true);
    window.setTimeout(() => setSaveComboDone(false), 2000);
  }, [savePreset]);

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

  if (!browsing) {
    return (
      <div className="web-explore-page">
        <div className="web-explore-page__landing">
          <div className="web-explore-page__hero" aria-hidden>
            <Globe size={28} strokeWidth={1.8} />
          </div>
          <h1 className="web-explore-page__title">{t("nav.webExplore")}</h1>
          <p className="web-explore-page__hint">{t("webExplorePage.hint")}</p>
          <form key={landingKey} className="web-explore-page__form" onSubmit={handleSubmit}>
            <Input
              ref={landingInputRef}
              block
              size="large"
              autofocus
              autocomplete="off"
              spellCheck={false}
              className="web-explore-page__input"
              value={draft}
              onChange={setDraft}
              placeholder={t("webExplorePage.urlPlaceholder")}
              aria-label={t("webExplorePage.urlPlaceholder")}
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
                  )}
                  onClick={() => handleActivateTab(tab.id)}
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
    </div>
  );
}
