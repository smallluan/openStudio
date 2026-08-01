import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  CHAT_LAB_PREVIEW_MESSAGE_CHANNEL,
  newPreviewFrameKey,
  officeEmbedViewerUrl,
  previewKindFromHref,
  absoluteHttpUrlMaybe,
  isPreviewInterceptableHref,
} from "../chat/chatLabDocumentPreview.js";
import { artifactPayloadFromReadResult } from "../chat/chatLabArtifactFilePayload.js";
import { mergeArtifactsIntoPreviewTree, buildArtifactSidebarTree, resolvePreviewTreeMode, defaultArtifactViewMode } from "../chat/chatLabPreviewFileTree.js";
import { useI18n } from "./I18nContext.jsx";
import { artifactPreviewKindFromPath } from "../chat/chatLabArtifactPreviewKind.js";
import {
  LINK_OPEN_MODE_EVENT,
  normalizeLinkOpenMode,
  openChatLabExternalUrl,
  readLinkOpenModeLocal,
  writeLinkOpenModeLocal,
} from "../chat/chatLabLinkOpenPreference.js";
import { getSession, upsertSession } from "../chat/chatSessionsStore.js";
import {
  captureSidebarPreviewSnapshot,
  composeChatLabPreviewContextBlock,
} from "../chat/chatLabPreviewSnapshot.js";
import { runSidebarPreviewAutomation } from "../chat/chatLabPreviewAutomation.js";
import {
  advancePageGeneration,
  stepsIncludeNavigation,
} from "../chat/chatLabBrowserObservation.js";

const PREVIEW_DEVICE_KEY = "openstudio_chat_preview_device";
const PREVIEW_TAB_MAX = 16;
const WEB_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals";

/**
 * @param {string} url
 */
function normalizePreviewTabUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const base = typeof window !== "undefined" ? window.location.href : "https://localhost/";
    const u = new URL(raw, base);
    u.hash = "";
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${host}${pathname}${u.search}`;
  } catch {
    return raw;
  }
}

/**
 * @param {string} a
 * @param {string} b
 */
function previewTabUrlsMatch(a, b) {
  const na = normalizePreviewTabUrl(a);
  const nb = normalizePreviewTabUrl(b);
  return Boolean(na) && na === nb;
}

/**
 * Wait for the Electron guest to expose a usable document before reporting
 * browser_open success. The renderer ref can exist before the guest finishes
 * mounting, so checking only `webviewRef.current` is not sufficient.
 *
 * @param {HTMLElement | null} node
 * @param {string} expectedUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ready: boolean; url?: string; error?: string }>}
 */
function waitForPreviewWebviewReady(node, expectedUrl, timeoutMs = 15000) {
  if (!node || typeof /** @type {any} */ (node).addEventListener !== "function") {
    return Promise.resolve({ ready: false, error: "webview_unavailable" });
  }
  /** @type {import("electron").WebviewTag} */
  const webview = /** @type {import("electron").WebviewTag} */ (node);
  const target = String(expectedUrl ?? "").trim();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      webview.removeEventListener("dom-ready", onReady);
      webview.removeEventListener("did-finish-load", onReady);
      webview.removeEventListener("did-fail-load", onFail);
      resolve(result);
    };
    const readUrl = () => {
      try {
        return String(webview.getURL?.() ?? "").trim();
      } catch {
        return "";
      }
    };
    const onReady = () => {
      const url = readUrl();
      if (!url || url === "about:blank" || (target && !previewTabUrlsMatch(url, target) && webview.isLoading?.())) {
        return;
      }
      finish({ ready: true, url });
    };
    const onFail = (event) => {
      if (Number(event?.errorCode) === -3) return;
      finish({
        ready: false,
        url: readUrl(),
        error: String(event?.errorDescription ?? event?.errorCode ?? "webview_load_failed"),
      });
    };
    const timer = window.setTimeout(() => {
      finish({ ready: false, url: readUrl(), error: "webview_ready_timeout" });
    }, timeoutMs);
    webview.addEventListener("dom-ready", onReady);
    webview.addEventListener("did-finish-load", onReady);
    webview.addEventListener("did-fail-load", onFail);
    onReady();
  });
}

/**
 * @param {string} tabId
 */
function previewFrameKeyForTab(tabId) {
  const id = String(tabId ?? "").trim();
  return id ? `pvframe-${id}` : newPreviewFrameKey();
}

/**
 * @param {PreviewWebTab[]} prevTabs
 * @param {string} nextUrl
 * @param {string} label
 * @param {{ externalUrl?: string | null; sandbox?: string; useWebview?: boolean }} opts
 * @param {number} now
 * @param {boolean} inElectron
 * @returns {{ tabs: PreviewWebTab[]; targetTab: PreviewWebTab }}
 */
function planWebPreviewTabUpdate(prevTabs, nextUrl, label, opts, now, inElectron) {
  const base = Array.isArray(prevTabs) ? prevTabs : [];
  const dupIdx = base.findIndex(
    (tab) =>
      previewTabUrlsMatch(tab.src, nextUrl) ||
      previewTabUrlsMatch(tab.externalUrl ?? "", nextUrl),
  );
  if (dupIdx >= 0) {
    const updated = {
      ...base[dupIdx],
      title: label,
      lastVisitedAt: now,
      useWebview: base[dupIdx].useWebview || (opts.useWebview !== false && inElectron),
      ...(opts.externalUrl ? { externalUrl: opts.externalUrl } : {}),
      ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
    };
    const next = [...base];
    next[dupIdx] = updated;
    return { tabs: next, targetTab: updated };
  }

  const tabId = `pvtab_${now.toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const row = {
    id: tabId,
    src: nextUrl,
    title: label,
    externalUrl: opts.externalUrl ?? nextUrl,
    sandbox: opts.sandbox ?? WEB_PREVIEW_SANDBOX,
    useWebview: opts.useWebview !== false && inElectron,
    frameKey: previewFrameKeyForTab(tabId),
    lastVisitedAt: now,
  };
  const appended = [...base, row];
  const tabs =
    appended.length <= PREVIEW_TAB_MAX ? appended : appended.slice(appended.length - PREVIEW_TAB_MAX);
  return { tabs, targetTab: row };
}

/** @returns {"desktop" | "mobile"} */
function readPreviewDeviceMode() {
  try {
    const raw = window.localStorage.getItem(PREVIEW_DEVICE_KEY);
    if (raw === "mobile" || raw === "desktop") return raw;
  } catch {
    /* ignore */
  }
  return "desktop";
}

/**
 * @typedef {{
 *   id: string;
 *   src: string;
 *   title: string;
 *   externalUrl?: string | null;
 *   sandbox?: string;
 *   useWebview?: boolean;
 *   frameKey?: string;
 *   lastVisitedAt: number;
 * }} PreviewWebTab
 *
 * @typedef {{
 *   tabs: PreviewWebTab[];
 *   activeTabId: string;
 * }} PreviewWebState
 *
 * @param {string | undefined} conversationId
 * @returns {PreviewWebState}
 */
function readStoredPreviewWebState(conversationId) {
  const cid = String(conversationId ?? "").trim();
  if (!cid) return { tabs: [], activeTabId: "" };
  const rec = getSession(cid);
  const stored = rec?.previewState;
  if (!stored || !Array.isArray(stored.tabs)) return { tabs: [], activeTabId: "" };
  /** @type {PreviewWebTab[]} */
  const tabs = [];
  const seen = new Set();
  for (const row of stored.tabs) {
    if (!row || typeof row !== "object") continue;
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 96) : "";
    const src = typeof row.url === "string" ? row.url.trim() : "";
    if (!id || !src || seen.has(id)) continue;
    seen.add(id);
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : src;
    const inElectron = typeof window !== "undefined" && Boolean(window.studioBridge);
    const useWebview = Boolean(row.useWebview) || (inElectron && /^https?:\/\//i.test(src));
    tabs.push({
      id,
      src,
      title,
      externalUrl: typeof row.externalUrl === "string" ? row.externalUrl : src,
      sandbox: typeof row.sandbox === "string" ? row.sandbox : undefined,
      useWebview,
      frameKey:
        typeof row.frameKey === "string" && row.frameKey.trim()
          ? row.frameKey.trim()
          : previewFrameKeyForTab(id),
      lastVisitedAt:
        typeof row.lastVisitedAt === "number" && Number.isFinite(row.lastVisitedAt)
          ? row.lastVisitedAt
          : 0,
    });
    if (tabs.length >= PREVIEW_TAB_MAX) break;
  }
  if (!tabs.length) return { tabs: [], activeTabId: "" };
  const activeTabId = String(stored.activeTabId ?? "").trim();
  const fallbackId = tabs.reduce((best, tab) => (tab.lastVisitedAt > best.lastVisitedAt ? tab : best), tabs[0]).id;
  return {
    tabs,
    activeTabId: tabs.some((t) => t.id === activeTabId) ? activeTabId : fallbackId,
  };
}

/**
 * @param {PreviewWebTab[]} tabs
 * @param {string} activeTabId
 */
function toPersistedPreviewWebState(tabs, activeTabId) {
  if (!Array.isArray(tabs) || tabs.length === 0) return undefined;
  return {
    tabs: tabs.slice(0, PREVIEW_TAB_MAX).map((tab) => ({
      id: tab.id,
      url: tab.src,
      title: tab.title,
      ...(tab.externalUrl ? { externalUrl: tab.externalUrl } : {}),
      ...(tab.sandbox ? { sandbox: tab.sandbox } : {}),
      ...(tab.useWebview ? { useWebview: true } : {}),
      ...(tab.frameKey ? { frameKey: tab.frameKey } : {}),
      ...(tab.lastVisitedAt ? { lastVisitedAt: tab.lastVisitedAt } : {}),
    })),
    ...(activeTabId ? { activeTabId } : {}),
  };
}

/**
 * @param {PreviewWebTab} tab
 * @returns {ChatLabPreviewSession}
 */
function sessionFromWebTab(tab) {
  return {
    kind: "iframe",
    src: tab.src,
    title: tab.title,
    frameKey: tab.frameKey || previewFrameKeyForTab(tab.id),
    ...(tab.sandbox ? { sandbox: tab.sandbox } : {}),
    externalUrl: tab.externalUrl ?? tab.src,
    useWebview: Boolean(tab.useWebview),
  };
}

/**
 * @typedef {{
 *   kind: "iframe";
 *   src: string;
 *   title: string;
 *   frameKey: string;
 *   sandbox?: string;
 *   externalUrl?: string | null;
 *   useWebview?: boolean;
 * }} ChatLabPreviewIframe
 *
 * @typedef {{
 *   kind: "srcdoc";
 *   html: string;
 *   title: string;
 *   frameKey: string;
 *   sandbox?: string;
 * }} ChatLabPreviewSrcDoc
 *
 * @typedef {{
 *   kind: "placeholder";
 *   title: string;
 *   body: string;
 *   frameKey: string;
 * }} ChatLabPreviewPlaceholder
 *
 * @typedef {ChatLabPreviewIframe | ChatLabPreviewSrcDoc | ChatLabPreviewPlaceholder} ChatLabPreviewSession
 *
 * @typedef {import("../chat/chatLabSessionArtifacts.js").SessionArtifact} SessionArtifact
 *
 * @typedef {{
 *   files: SessionArtifact[];
 *   selectedPath: string | null;
 *   viewMode: "render" | "source";
 *   loading: boolean;
 *   error: string | null;
 *   payload: import("../chat/chatLabArtifactFilePayload.js").ArtifactFilePayload | null;
 *   tree: import("../chat/chatLabPreviewFileTree.js").PreviewTreeNode[];
 *   treeMode: import("../chat/chatLabPreviewFileTree.js").PreviewTreeMode;
 * }} ArtifactsPanelState
 */

/** @type {import("react").Context<null | {
 *   session: ChatLabPreviewSession | null;
 *   artifactsPanel: ArtifactsPanelState | null;
 *   iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *   webviewRef: import("react").RefObject<HTMLElement | null>;
 *   dockOpen: boolean;
 *   close: () => void;
 *   openDock: () => boolean;
 *   toggleDock: () => void;
 *   openIframe: (src: string, title: string, opts?: { externalUrl?: string | null; sandbox?: string; useWebview?: boolean }) => void;
 *   openSrcDoc: (html: string, title: string, opts?: { sandbox?: string }) => void;
 *   openBlob: (blob: Blob, title: string) => void;
 *   openPlaceholder: (title: string, body: string) => void;
 *   openFromHref: (href: string, linkLabel?: string) => boolean;
 *   openFromMarkdownLink: (href: string, linkLabel: string) => boolean;
 *   navigatePreviewTo: (url: string, title?: string) => void;
 *   deviceMode: "desktop" | "mobile";
 *   setDeviceMode: (mode: "desktop" | "mobile") => void;
 *   openFromWorkspacePath: (inputPath: string, title?: string) => Promise<void>;
 *   openArtifactsPanel: (files: SessionArtifact[], selectPath?: string, opts?: { treeMode?: import("../chat/chatLabPreviewFileTree.js").PreviewTreeMode }) => void;
 *   selectArtifact: (path: string) => void;
 *   setArtifactViewMode: (mode: "render" | "source") => void;
 *   postToPreview: (payload: unknown, targetOrigin?: string) => void;
 *   subscribeFrameMessages: (fn: (data: unknown) => void) => () => void;
 *   previewTabs: PreviewWebTab[];
 *   activePreviewTabId: string;
 *   activatePreviewTab: (tabId: string) => void;
 *   captureSidebarContextBlock: () => Promise<string>;
 *   runSidebarAutomation: (steps: import("../chat/chatLabPreviewAutomation.js").SidebarAutomationStep[] | unknown) => Promise<unknown>;
 *   executeSidebarActionTool: (args: { steps?: unknown; retainPriorPageDom?: boolean }) => Promise<unknown>;
 *   executeBrowserOpenTool: (args: { url?: string; title?: string }) => Promise<unknown>;
 * }>} */
export const ChatLabPreviewContext = createContext(null);

export function useChatLabPreview() {
  return useContext(ChatLabPreviewContext);
}

/**
 * @param {{
 *   conversationId: string;
 *   children: import("react").ReactNode;
 *   externalPreviewRefs?: {
 *     iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *     webviewRef: import("react").RefObject<HTMLElement | null>;
 *   };
 *   externalSession?: ChatLabPreviewSession | null;
 *   externalNavigatePreviewTo?: (url: string) => void;
 *   embedPreview?: boolean;
 * }} props
 */
export function ChatLabPreviewProvider({
  conversationId,
  children,
  externalPreviewRefs,
  externalSession,
  externalNavigatePreviewTo,
  embedPreview = false,
}) {
  const { t } = useI18n();
  const restoredWebState = useMemo(
    () => (embedPreview ? { tabs: [], activeTabId: "" } : readStoredPreviewWebState(conversationId)),
    [conversationId, embedPreview],
  );
  const internalIframeRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const internalWebviewRef = useRef(/** @type {HTMLElement | null} */ (null));
  const iframeRef = externalPreviewRefs?.iframeRef ?? internalIframeRef;
  const webviewRef = externalPreviewRefs?.webviewRef ?? internalWebviewRef;
  const externalSessionRef = useRef(externalSession ?? null);
  externalSessionRef.current = externalSession ?? null;
  const blobRevokeRef = useRef(/** @type {string | null} */ (null));
  /** @type {import("react").MutableRefObject<Set<string>>} */
  const artifactBlobUrlsRef = useRef(new Set());
  const artifactLoadGenRef = useRef(0);

  /** @type {import("react").MutableRefObject<Set<(data: unknown) => void>>} */
  const subscribedRef = useRef(new Set());

  // Tabs may restore per conversation; the dock must NOT auto-open on switch.
  // Visibility is only for: user toggle (header) or agent/tool open paths.
  const [session, setSession] = useState(
    /** @type {ChatLabPreviewSession | null} */ (embedPreview && externalSession ? externalSession : null),
  );
  const [dockOpen, setDockOpen] = useState(Boolean(embedPreview && externalSession));
  const [artifactsPanel, setArtifactsPanel] = useState(/** @type {ArtifactsPanelState | null} */ (null));
  const [previewTabs, setPreviewTabs] = useState(restoredWebState.tabs);
  const [activePreviewTabId, setActivePreviewTabId] = useState(restoredWebState.activeTabId);
  const previewTabsRef = useRef(previewTabs);
  const activePreviewTabIdRef = useRef(activePreviewTabId);
  const dockOpenRef = useRef(dockOpen);
  /** @type {import("react").MutableRefObject<import("../chat/chatLabPreviewSnapshot.js").SidebarPreviewInteractiveElement[]>} */
  const lastInventoryRef = useRef([]);
  /** Tracks page generations so OpenClaw can strip stale DOM from prior browser_action results. */
  const pageGenerationStateRef = useRef({ pageGeneration: 0, lastUrl: "" });
  previewTabsRef.current = previewTabs;
  activePreviewTabIdRef.current = activePreviewTabId;
  dockOpenRef.current = dockOpen;
  const [deviceMode, setDeviceModeState] = useState(readPreviewDeviceMode);
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);

  useEffect(() => {
    if (embedPreview) return;
    const next = readStoredPreviewWebState(conversationId);
    setPreviewTabs(next.tabs);
    setActivePreviewTabId(next.activeTabId);
    setSession(null);
    setArtifactsPanel(null);
    setDockOpen(false);
    lastInventoryRef.current = [];
    pageGenerationStateRef.current = { pageGeneration: 0, lastUrl: "" };
  }, [conversationId, embedPreview]);

  useEffect(() => {
    if (!embedPreview || !externalSession) return;
    setSession(externalSession);
    setDockOpen(true);
  }, [embedPreview, externalSession]);

  useEffect(() => {
    let cancelled = false;
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (cancelled || !c || typeof c !== "object") return;
        if (c.chatLabLinkOpenMode === "external" || c.chatLabLinkOpenMode === "sidebar") {
          const mode = normalizeLinkOpenMode(c.chatLabLinkOpenMode);
          setLinkOpenMode(mode);
          writeLinkOpenModeLocal(mode);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    /** @param {Event} e */
    const onModeChange = (e) => {
      const detail = /** @type {CustomEvent<{ mode?: string }>} */ (e).detail;
      setLinkOpenMode(normalizeLinkOpenMode(detail?.mode));
    };
    window.addEventListener(LINK_OPEN_MODE_EVENT, onModeChange);
    return () => window.removeEventListener(LINK_OPEN_MODE_EVENT, onModeChange);
  }, []);

  const setDeviceMode = useCallback((mode) => {
    const next = mode === "mobile" ? "mobile" : "desktop";
    setDeviceModeState(next);
    try {
      window.localStorage.setItem(PREVIEW_DEVICE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const revokeBlob = useCallback(() => {
    const u = blobRevokeRef.current;
    if (u) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
    blobRevokeRef.current = null;
  }, []);

  const revokeArtifactBlobs = useCallback(() => {
    for (const u of artifactBlobUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
    artifactBlobUrlsRef.current.clear();
  }, []);

  const dispatchDockFocus = useCallback((detail = {}) => {
    try {
      window.dispatchEvent(
        new CustomEvent("openstudio-preview-dock-focus", {
          detail: detail && typeof detail === "object" ? detail : {},
        }),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const revealDock = useCallback(
    (detail = {}) => {
      setDockOpen(true);
      dispatchDockFocus(detail);
    },
    [dispatchDockFocus],
  );

  const showWebPreviewAtUrl = useCallback(
    /**
     * @param {string} url
     * @param {string} [title]
     * @param {{ externalUrl?: string | null; sandbox?: string; useWebview?: boolean }} [opts]
     * @returns {boolean}
     */
    (url, title, opts = {}) => {
      const nextUrl = String(url ?? "").trim();
      if (!nextUrl) return false;
      const label = String(title ?? nextUrl).trim() || nextUrl;
      // Web Explore: navigate the visible tab — never create a hidden Chat Lab sidebar session.
      if (embedPreview && externalNavigatePreviewTo) {
        externalNavigatePreviewTo(nextUrl);
        const base = externalSessionRef.current;
        setSession(
          base
            ? { ...base, src: nextUrl, externalUrl: nextUrl, title: label || base.title }
            : {
                kind: "iframe",
                src: nextUrl,
                title: label,
                frameKey: "web-explore-active",
                externalUrl: nextUrl,
                useWebview: true,
              },
        );
        setDockOpen(true);
        return true;
      }
      const now = Date.now();
      const inElectron = typeof window !== "undefined" && Boolean(window.studioBridge);
      const plan = planWebPreviewTabUpdate(
        previewTabsRef.current,
        nextUrl,
        label,
        opts,
        now,
        inElectron,
      );

      setPreviewTabs(plan.tabs);

      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
      setActivePreviewTabId(plan.targetTab.id);
      setSession(sessionFromWebTab(plan.targetTab));
      revealDock({ url: nextUrl, title: label, source: "showWebPreviewAtUrl" });
      return true;
    },
    [embedPreview, externalNavigatePreviewTo, revealDock, revokeArtifactBlobs, revokeBlob],
  );

  const upsertWebPreviewTab = useCallback(
    (src, title, opts = {}, mode = "new") => {
      const nextSrc = String(src ?? "").trim();
      if (!nextSrc) return "";
      const nextTitle = String(title ?? "").trim() || nextSrc;
      const now = Date.now();
      let resolvedId = "";
      setPreviewTabs((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const currentActive = String(activePreviewTabId ?? "").trim();
        const activeIdx = base.findIndex((tab) => tab.id === currentActive);

        if (mode === "new") {
          const dupIdx = base.findIndex(
            (tab) =>
              previewTabUrlsMatch(tab.src, nextSrc) ||
              previewTabUrlsMatch(tab.externalUrl ?? "", nextSrc),
          );
          if (dupIdx >= 0) {
            const next = [...base];
            next[dupIdx] = {
              ...next[dupIdx],
              title: nextTitle,
              lastVisitedAt: now,
              ...(opts.externalUrl ? { externalUrl: opts.externalUrl } : {}),
              ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
              ...(opts.useWebview ? { useWebview: true } : {}),
            };
            resolvedId = next[dupIdx].id;
            return next;
          }
        }

        const nextTabId = `pvtab_${now.toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
        const idx = mode === "active" ? activeIdx : -1;
        /** @type {PreviewWebTab} */
        const row = {
          id: idx >= 0 ? base[idx].id : nextTabId,
          src: nextSrc,
          title: nextTitle,
          externalUrl: opts.externalUrl ?? nextSrc,
          sandbox: opts.sandbox,
          useWebview: Boolean(opts.useWebview),
          frameKey: idx >= 0 ? base[idx].frameKey || previewFrameKeyForTab(base[idx].id) : previewFrameKeyForTab(nextTabId),
          lastVisitedAt: now,
        };
        resolvedId = row.id;
        if (idx >= 0) {
          const next = [...base];
          next[idx] = row;
          return next;
        }
        const appended = [...base, row];
        if (appended.length <= PREVIEW_TAB_MAX) return appended;
        return appended.slice(appended.length - PREVIEW_TAB_MAX);
      });
      if (resolvedId) setActivePreviewTabId(resolvedId);
      return resolvedId;
    },
    [activePreviewTabId],
  );

  const activatePreviewTab = useCallback((tabId) => {
    const id = String(tabId ?? "").trim();
    if (!id) return;
    /** @type {PreviewWebTab | null} */
    let targetTab = null;
    setPreviewTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const updated = { ...next[idx], lastVisitedAt: Date.now() };
      next[idx] = updated;
      targetTab = updated;
      return next;
    });
    if (!targetTab) return;
    setActivePreviewTabId(id);
    setArtifactsPanel(null);
    revokeBlob();
    setSession(sessionFromWebTab(targetTab));
    revealDock({ source: "activate_tab", url: targetTab.src, title: targetTab.title });
  }, [revealDock, revokeBlob]);

  useEffect(() => {
    if (embedPreview) return;
    const cid = String(conversationId ?? "").trim();
    if (!cid) return;
    const rec = getSession(cid);
    if (!rec) return;
    const nextPreviewState = toPersistedPreviewWebState(previewTabs, activePreviewTabId);
    const prevRaw = rec.previewState ? JSON.stringify(rec.previewState) : "";
    const nextRaw = nextPreviewState ? JSON.stringify(nextPreviewState) : "";
    if (prevRaw === nextRaw) return;
    upsertSession(cid, rec.title || "…", rec.messages, { previewState: nextPreviewState ?? null });
  }, [activePreviewTabId, conversationId, embedPreview, previewTabs]);

  const close = useCallback(() => {
    revokeBlob();
    revokeArtifactBlobs();
    setSession(null);
    setArtifactsPanel(null);
    setDockOpen(false);
  }, [revokeArtifactBlobs, revokeBlob]);

  /**
   * Manually open the right preview dock (header toggle). Restores the last tab if any.
   * @returns {boolean}
   */
  const openDock = useCallback(() => {
    const tabs = previewTabsRef.current;
    const activeId = String(activePreviewTabIdRef.current ?? "").trim();
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
    if (active) {
      setActivePreviewTabId(active.id);
      setArtifactsPanel(null);
      revokeBlob();
      setSession(sessionFromWebTab(active));
      revealDock({ source: "user_toggle", url: active.src, title: active.title });
      return true;
    }
    return showWebPreviewAtUrl("about:blank", "New tab", {
      externalUrl: "about:blank",
      useWebview: true,
    });
  }, [revealDock, revokeBlob, showWebPreviewAtUrl]);

  const toggleDock = useCallback(() => {
    if (dockOpenRef.current) {
      close();
      return;
    }
    openDock();
  }, [close, openDock]);

  const fetchPreviewTree = useCallback(async (anchorPath, files) => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    const listDir =
      bridge && typeof bridge.listWorkspacePreviewDirectory === "function"
        ? bridge.listWorkspacePreviewDirectory
        : undefined;
    if (!listDir) return mergeArtifactsIntoPreviewTree(files, []);
    try {
      const r = await listDir(anchorPath, { maxDepth: 4 });
      if (r && r.ok && Array.isArray(r.entries)) {
        return mergeArtifactsIntoPreviewTree(files, r.entries);
      }
    } catch {
      /* ignore */
    }
    return mergeArtifactsIntoPreviewTree(files, []);
  }, []);

  const resolvePanelTree = useCallback(
    async (path, files, existingTree, treeMode) => {
      if (existingTree.length) return existingTree;
      if (treeMode === "directory") return fetchPreviewTree(path, files);
      return buildArtifactSidebarTree(files, treeMode);
    },
    [fetchPreviewTree],
  );

  const loadArtifactAtPath = useCallback(
    /**
     * @param {string} inputPath
     * @param {SessionArtifact[]} files
     * @param {"render"|"source"} viewMode
     * @param {import("../chat/chatLabPreviewFileTree.js").PreviewTreeNode[]} [existingTree]
     * @param {import("../chat/chatLabPreviewFileTree.js").PreviewTreeMode} [treeMode]
     */
    async (inputPath, files, viewMode, existingTree = [], treeMode = "file-only") => {
      const path = String(inputPath ?? "").trim();
      const gen = ++artifactLoadGenRef.current;
      const initialTree = existingTree.length ? existingTree : buildArtifactSidebarTree(files, treeMode);
      setArtifactsPanel({
        files,
        selectedPath: path,
        viewMode,
        loading: true,
        error: null,
        payload: null,
        tree: initialTree,
        treeMode,
      });
      setSession(null);
      setDockOpen(true);
      revokeBlob();

      const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
      const read =
        bridge && typeof bridge.readWorkspacePreviewFile === "function"
          ? bridge.readWorkspacePreviewFile
          : undefined;
      const maybeOpenOffice =
        bridge && typeof bridge.maybeOpenWorkspaceOfficeFileExternally === "function"
          ? bridge.maybeOpenWorkspaceOfficeFileExternally
          : undefined;

      if (!read && !maybeOpenOffice) {
        if (gen !== artifactLoadGenRef.current) return;
        const tree = await resolvePanelTree(path, files, existingTree, treeMode);
        if (gen !== artifactLoadGenRef.current) return;
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: "workspace_needs_app",
          payload: null,
          tree,
          treeMode,
        });
        return;
      }

      if (maybeOpenOffice) {
        try {
          const xr = await maybeOpenOffice(path);
          if (gen !== artifactLoadGenRef.current) return;
          if (xr && typeof xr === "object" && xr.opened) {
            close();
            return;
          }
        } catch {
          /* fall through to read */
        }
      }

      if (!read) {
        if (gen !== artifactLoadGenRef.current) return;
        const tree = await resolvePanelTree(path, files, existingTree, treeMode);
        if (gen !== artifactLoadGenRef.current) return;
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: "workspace_needs_app",
          payload: null,
          tree,
          treeMode,
        });
        return;
      }

      let r;
      try {
        r = await read(path);
      } catch (e) {
        if (gen !== artifactLoadGenRef.current) return;
        const msg = String(e?.message ?? e);
        const tree = await resolvePanelTree(path, files, existingTree, treeMode);
        if (gen !== artifactLoadGenRef.current) return;
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: /No handler registered/i.test(msg) ? "ipc_missing" : msg,
          payload: null,
          tree,
          treeMode,
        });
        return;
      }

      if (gen !== artifactLoadGenRef.current) return;
      const tree = await resolvePanelTree(path, files, existingTree, treeMode);
      if (gen !== artifactLoadGenRef.current) return;
      revokeArtifactBlobs();
      const built = artifactPayloadFromReadResult(path, r);
      if ("error" in built) {
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: built.error,
          payload: null,
          tree,
          treeMode,
        });
        return;
      }
      if (built.blobUrl) artifactBlobUrlsRef.current.add(built.blobUrl);
      const resolvedPath = String(built.path ?? path).trim() || path;
      const filesWithResolved = files.map((f) =>
        f.path === path ? { ...f, path: resolvedPath, label: f.label || resolvedPath.split(/[/\\]/).pop() || f.label } : f,
      );
      setArtifactsPanel({
        files: filesWithResolved,
        selectedPath: resolvedPath,
        viewMode,
        loading: false,
        error: null,
        payload: built,
        tree,
        treeMode,
      });
    },
    [close, resolvePanelTree, revokeArtifactBlobs, revokeBlob],
  );

  const openArtifactsPanel = useCallback(
    /**
     * @param {SessionArtifact[]} files
     * @param {string} [selectPath]
     * @param {{ treeMode?: import("../chat/chatLabPreviewFileTree.js").PreviewTreeMode }} [opts]
     */
    (files, selectPath, opts) => {
      const list = Array.isArray(files) ? files.filter((f) => f?.path) : [];
      if (!list.length) return;
      const treeMode = resolvePreviewTreeMode(list, opts?.treeMode);
      const pick =
        selectPath && list.some((f) => f.path === selectPath) ? selectPath : list[list.length - 1].path;
      const viewMode = defaultArtifactViewMode(pick);
      const tree = treeMode === "directory" ? [] : buildArtifactSidebarTree(list, treeMode);
      void loadArtifactAtPath(pick, list, viewMode, tree, treeMode);
    },
    [loadArtifactAtPath],
  );

  const selectArtifact = useCallback(
    (path) => {
      if (!artifactsPanel) return;
      const pick = String(path ?? "").trim();
      if (!pick) return;
      const viewMode = artifactsPanel.viewMode;
      const tree = artifactsPanel.tree ?? [];
      const treeMode = artifactsPanel.treeMode ?? "file-only";
      const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
      const hasFile = artifactsPanel.files.some((f) => norm(f.path) === norm(pick));
      if (!hasFile && treeMode !== "directory") return;
      const files = hasFile
        ? artifactsPanel.files
        : [
            ...artifactsPanel.files,
            {
              path: pick,
              label: pick.split(/[/\\]/).pop() || pick,
              op: /** @type {const} */ ("viewed"),
              messageId: "",
              seq: 0,
              previewKind: artifactPreviewKindFromPath(pick),
            },
          ];
      void loadArtifactAtPath(pick, files, viewMode, tree, treeMode);
    },
    [artifactsPanel, loadArtifactAtPath],
  );

  const setArtifactViewMode = useCallback((mode) => {
    setArtifactsPanel((prev) => (prev ? { ...prev, viewMode: mode } : prev));
  }, []);

  const openIframe = useCallback(
    /**
     * @param {string} src
     * @param {string} title
     * @param {{ externalUrl?: string | null; sandbox?: string; useWebview?: boolean }} [opts]
     * @returns {boolean}
     */
    (src, title, opts = {}) => {
      const nextSrc = String(src ?? "").trim();
      if (!nextSrc) return false;
      const label = String(title ?? "").trim() || nextSrc;
      const inElectron = typeof window !== "undefined" && Boolean(window.studioBridge);
      const wantsWebview =
        opts.useWebview !== false && /^https?:\/\//i.test(nextSrc) && inElectron;
      const tabId = upsertWebPreviewTab(
        nextSrc,
        label,
        {
          ...opts,
          useWebview: wantsWebview,
          sandbox: opts.sandbox ?? (wantsWebview ? WEB_PREVIEW_SANDBOX : opts.sandbox),
        },
        "new",
      );
      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
      const stableId = tabId || `pvtab_${Date.now().toString(36)}`;
      setActivePreviewTabId(stableId);
      setSession(
        sessionFromWebTab({
          id: stableId,
          src: nextSrc,
          title: label,
          externalUrl: opts.externalUrl ?? nextSrc,
          sandbox: opts.sandbox ?? (wantsWebview ? WEB_PREVIEW_SANDBOX : undefined),
          useWebview: wantsWebview,
          frameKey: previewFrameKeyForTab(stableId),
          lastVisitedAt: Date.now(),
        }),
      );
      revealDock({ source: "openIframe", url: nextSrc, title: label });
      return true;
    },
    [revealDock, revokeArtifactBlobs, revokeBlob, upsertWebPreviewTab],
  );

  const openSrcDoc = useCallback(
    /**
     * @param {string} html
     * @param {string} title
     * @param {{ sandbox?: string }} [opts]
     */
    (html, title, opts = {}) => {
      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
      setSession({
        kind: "srcdoc",
        html,
        title,
        frameKey: newPreviewFrameKey(),
        sandbox: opts.sandbox ?? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals",
      });
      revealDock({ source: "openSrcDoc", title });
    },
    [revealDock, revokeArtifactBlobs, revokeBlob],
  );

  const openBlob = useCallback(
    (blob, title) => {
      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
      const url = URL.createObjectURL(blob);
      blobRevokeRef.current = url;
      const mime = String(blob.type ?? "");
      const sandbox =
        mime === "application/pdf" || mime.endsWith("pdf")
          ? "allow-scripts allow-downloads"
          : undefined;
      setSession({
        kind: "iframe",
        src: url,
        title,
        frameKey: newPreviewFrameKey(),
        sandbox,
        externalUrl: null,
      });
      revealDock({ source: "openBlob", title });
    },
    [revealDock, revokeArtifactBlobs, revokeBlob],
  );

  const openPlaceholder = useCallback(
    (title, body) => {
      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
      setSession({
        kind: "placeholder",
        title,
        body,
        frameKey: newPreviewFrameKey(),
      });
      revealDock({ source: "openPlaceholder", title });
    },
    [revealDock, revokeArtifactBlobs, revokeBlob],
  );

  const navigatePreviewToInternal = useCallback(
    /**
     * @param {string} url
     * @param {string} [title]
     */
    (url, title) => {
      const nextUrl = String(url ?? "").trim();
      if (!nextUrl) return;
      const label = String(title ?? nextUrl).trim() || nextUrl;
      const dupTab = previewTabs.find(
        (tab) =>
          tab.id !== activePreviewTabId &&
          (previewTabUrlsMatch(tab.src, nextUrl) || previewTabUrlsMatch(tab.externalUrl ?? "", nextUrl)),
      );
      if (dupTab) {
        showWebPreviewAtUrl(nextUrl, label);
        return;
      }
      const activeId = String(activePreviewTabId ?? "").trim();
      const activeTab = previewTabs.find((tab) => tab.id === activeId);
      if (activeTab) {
        const sandbox = activeTab.sandbox ?? WEB_PREVIEW_SANDBOX;
        const useWebview = activeTab.useWebview ?? true;
        const now = Date.now();
        const updated = {
          ...activeTab,
          src: nextUrl,
          title: label,
          externalUrl: nextUrl,
          sandbox,
          useWebview,
          lastVisitedAt: now,
        };
        setPreviewTabs((prev) => prev.map((tab) => (tab.id === activeId ? updated : tab)));
        revokeArtifactBlobs();
        setArtifactsPanel(null);
        revokeBlob();
        setActivePreviewTabId(activeId);
        setSession(sessionFromWebTab(updated));
        revealDock({ source: "navigate", url: nextUrl, title: label });
        return;
      }
      showWebPreviewAtUrl(nextUrl, label, { useWebview: true });
    },
    [activePreviewTabId, previewTabs, revealDock, revokeArtifactBlobs, revokeBlob, showWebPreviewAtUrl],
  );

  const navigatePreviewTo = useCallback(
    /**
     * @param {string} url
     * @param {string} [title]
     */
    (url, title) => {
      if (embedPreview && externalNavigatePreviewTo) {
        const nextUrl = String(url ?? "").trim();
        if (nextUrl) externalNavigatePreviewTo(nextUrl);
        return;
      }
      navigatePreviewToInternal(url, title);
    },
    [embedPreview, externalNavigatePreviewTo, navigatePreviewToInternal],
  );

  const openFromHref = useCallback(
    /**
     * @param {string} href
     * @param {string} [linkLabel]
     * @returns {boolean}
     */
    (href, linkLabel) => {
      if (!isPreviewInterceptableHref(href)) return false;

      if (readLinkOpenModeLocal() === "external") {
        return openChatLabExternalUrl(href);
      }

      const kind = previewKindFromHref(href);
      if (!kind) return false;
      const title = String(linkLabel ?? "").trim() || href;

      if (kind === "blob" || href.startsWith("data:")) {
        return openIframe(href, title, { externalUrl: null, sandbox: "allow-scripts allow-downloads" });
      }

      if (kind === "sheet" || kind === "slides") {
        const abs = absoluteHttpUrlMaybe(href);
        if (abs) {
          const viewer = officeEmbedViewerUrl(abs);
          if (viewer) {
            return openIframe(viewer, title, {
              externalUrl: abs,
              sandbox: "allow-scripts allow-same-origin allow-popups",
            });
          }
        }
        openPlaceholder(title, t("chatLab.previewOfficeNeedsPublicUrl"));
        return true;
      }

      let resolved;
      try {
        resolved = new URL(href, window.location.href).href;
      } catch {
        return false;
      }

      if (kind === "pdf" || kind === "html") {
        return openIframe(resolved, title, {
          externalUrl: resolved,
          sandbox: "allow-scripts allow-downloads allow-popups",
        });
      }

      if (kind === "web") {
        return showWebPreviewAtUrl(resolved, title, {
          externalUrl: resolved,
          sandbox: WEB_PREVIEW_SANDBOX,
          useWebview: true,
        });
      }

      return false;
    },
    [openIframe, openPlaceholder, showWebPreviewAtUrl, t],
  );

  const openFromMarkdownLink = useCallback(
    (href, linkLabel) => openFromHref(href, linkLabel),
    [openFromHref],
  );

  const openFromWorkspacePath = useCallback(
    /**
     * @param {string} inputPath
     * @param {string} [title]
     */
    async (inputPath, title) => {
      const path = String(inputPath ?? "").trim();
      const label = String(title ?? path).trim() || path;
      openArtifactsPanel(
        [
          {
            path,
            label,
            op: "modified",
            messageId: "",
            seq: 0,
            previewKind: artifactPreviewKindFromPath(path),
          },
        ],
        path,
        { treeMode: "file-only" },
      );
    },
    [openArtifactsPanel],
  );

  const postToPreview = useCallback((payload, targetOrigin = "*") => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        { channel: CHAT_LAB_PREVIEW_MESSAGE_CHANNEL, v: 1, payload },
        targetOrigin,
      );
    } catch {
      /* ignore */
    }
  }, []);

  const subscribeFrameMessages = useCallback((fn) => {
    const set = subscribedRef.current;
    set.add(fn);
    return () => set.delete(fn);
  }, []);

  useEffect(() => {
    /** @param {MouseEvent} e */
    function onClickCapture(e) {
      if (!(e.target instanceof Element)) return;
      const anchor = e.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.dataset.previewBypass === "true") return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = anchor.getAttribute("href");
      if (!href || !openFromHref(href, anchor.textContent ?? "")) return;
      e.preventDefault();
      e.stopPropagation();
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [openFromHref]);

  useEffect(() => {
    const originalOpen = window.open.bind(window);
    window.open = function openInPreviewDock(url, target, features) {
      if (typeof url === "string") {
        const trimmed = url.trim();
        if (linkOpenMode === "external" && /^https?:\/\//i.test(trimmed)) {
          openChatLabExternalUrl(trimmed);
          return null;
        }
        if (linkOpenMode === "sidebar" && openFromHref(trimmed, trimmed)) return null;
      }
      return originalOpen(url, target, features);
    };
    /** @param {string} url */
    window.__openStudioOpenExternal = (url) => {
      openChatLabExternalUrl(String(url), { forceExternal: true });
    };
    return () => {
      window.open = originalOpen;
      delete window.__openStudioOpenExternal;
    };
  }, [linkOpenMode, openFromHref]);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    const subscribe =
      bridge && typeof bridge.onOpenPreviewUrl === "function" ? bridge.onOpenPreviewUrl : undefined;
    if (!subscribe) return undefined;
    return subscribe((payload) => {
      const url = String(payload?.url ?? "").trim();
      if (!url) return;
      if (linkOpenMode === "external") {
        openChatLabExternalUrl(url);
        return;
      }
      openFromHref(url, url);
    });
  }, [linkOpenMode, openFromHref]);

  useEffect(() => {
    function onMessage(ev) {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (/** @type {{channel?: string}} */ (data).channel !== CHAT_LAB_PREVIEW_MESSAGE_CHANNEL) return;
      const iframeWin = iframeRef.current?.contentWindow;
      if (iframeWin && ev.source !== iframeWin) return;
      const payload = "payload" in data ? /** @type {{payload: unknown}} */ (data).payload : data;
      for (const fn of subscribedRef.current) {
        try {
          fn(payload);
        } catch {
          /* ignore subscriber errors */
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const openWebviewDevTools = useCallback(() => {
    const node = webviewRef.current;
    if (!node) return false;
    try {
      /** @type {import("electron").WebviewTag} */
      const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
      wv.openDevTools?.();
      return true;
    } catch {
      return false;
    }
  }, []);

  const captureSidebarContextBlock = useCallback(async () => {
    if (!embedPreview && linkOpenMode === "external") return "";
    const captureSession = embedPreview ? externalSessionRef.current ?? session : session;
    if (!captureSession) return "";
    try {
      const snap = await captureSidebarPreviewSnapshot({
        session: captureSession,
        webviewRef,
        iframeRef,
        previewTabs,
        activePreviewTabId,
        artifactsPanel,
        forceSidebar: embedPreview,
      });
      if (!snap && embedPreview && captureSession?.src) {
        lastInventoryRef.current = [];
        return composeChatLabPreviewContextBlock(
          t,
          {
            ok: true,
            url: String(captureSession.src ?? "").trim(),
            title: String(captureSession.title ?? captureSession.src ?? "").trim(),
            text: "",
            tabCount: 1,
            partial: true,
          },
          { webExploreMode: true },
        );
      }
      lastInventoryRef.current = Array.isArray(snap?.elements) ? snap.elements : [];
      return composeChatLabPreviewContextBlock(t, snap, { webExploreMode: embedPreview });
    } catch {
      return "";
    }
  }, [
    activePreviewTabId,
    artifactsPanel,
    embedPreview,
    iframeRef,
    linkOpenMode,
    previewTabs,
    session,
    t,
    webviewRef,
  ]);

  const runSidebarAutomation = useCallback(
    async (steps, opts = {}) => {
      if (!embedPreview && linkOpenMode === "external") {
        return { ok: false, error: "external_mode", steps: [] };
      }
      const captureSession = embedPreview ? externalSessionRef.current ?? session : session;
      /** Prefer a fresh inventory so refs match the page about to be acted on. */
      let elements = lastInventoryRef.current;
      try {
        const snap = await captureSidebarPreviewSnapshot({
          session: captureSession,
          webviewRef,
          iframeRef,
          previewTabs,
          activePreviewTabId,
          artifactsPanel,
          forceSidebar: embedPreview,
        });
        if (Array.isArray(snap?.elements) && snap.elements.length) {
          elements = snap.elements;
          lastInventoryRef.current = snap.elements;
        }
      } catch {
        /* keep last inventory */
      }
      return runSidebarPreviewAutomation({
        steps,
        session: captureSession,
        webviewRef,
        iframeRef,
        previewTabs,
        activePreviewTabId,
        artifactsPanel,
        navigatePreviewTo: (url, title) => {
          // Commit dock/session before the automation delay so the sidebar is visible
          // for the user and webview can mount before click/type steps.
          flushSync(() => {
            navigatePreviewTo(url, title);
          });
        },
        t,
        forceSidebar: embedPreview,
        elements,
        onStepComplete: opts.onStepComplete,
        stopOnFailure: opts.stopOnFailure,
      });
    },
    [
      activePreviewTabId,
      artifactsPanel,
      embedPreview,
      iframeRef,
      linkOpenMode,
      navigatePreviewTo,
      previewTabs,
      session,
      t,
      webviewRef,
    ],
  );

  /**
   * Native OpenClaw `browser_action` tool entry: run steps, then return fresh observation.
   * @param {{ steps?: unknown, retainPriorPageDom?: boolean }} args
   */
  const executeSidebarActionTool = useCallback(
    async (args = {}) => {
      // Agent browser tools should make the dock visible when acting on a page.
      // Web Explore embeds the live viewport — skip Chat Lab tab restore there.
      if (!embedPreview) {
        flushSync(() => {
          if (dockOpenRef.current && session) return;
          const tabs = previewTabsRef.current;
          const activeId = String(activePreviewTabIdRef.current ?? "").trim();
          const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
          if (active) {
            setActivePreviewTabId(active.id);
            setArtifactsPanel(null);
            revokeBlob();
            setSession(sessionFromWebTab(active));
            revealDock({ source: "browser_action", url: active.src, title: active.title });
          }
        });
        if (!dockOpenRef.current) {
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
      const steps = args?.steps;
      const retainPriorPageDom = args?.retainPriorPageDom === true;
      const runResult = await runSidebarAutomation(steps, { stopOnFailure: true });
      let observation = null;
      try {
        const captureSession = embedPreview ? externalSessionRef.current ?? session : session;
        const snap = await captureSidebarPreviewSnapshot({
          session: captureSession,
          webviewRef,
          iframeRef,
          previewTabs,
          activePreviewTabId,
          artifactsPanel,
          forceSidebar: embedPreview,
        });
        if (snap) {
          if (Array.isArray(snap.elements)) lastInventoryRef.current = snap.elements;
          const forceBump =
            stepsIncludeNavigation(steps) || stepsIncludeNavigation(runResult?.steps);
          const gen = advancePageGeneration(pageGenerationStateRef.current, {
            url: snap.url ?? "",
            forceBump,
          });
          pageGenerationStateRef.current = {
            pageGeneration: gen.pageGeneration,
            lastUrl: gen.lastUrl,
          };
          observation = {
            ok: snap.ok !== false,
            url: snap.url ?? "",
            title: snap.title ?? "",
            text: String(snap.text ?? "").slice(0, 4000),
            elements: Array.isArray(snap.elements) ? snap.elements : [],
            partial: Boolean(snap.partial),
            loginHint: Boolean(snap.loginHint),
            canvasHint: Boolean(snap.canvasHint),
            pageGeneration: gen.pageGeneration,
            pageChanged: gen.pageChanged,
            ...(retainPriorPageDom ? { retainPriorPageDom: true } : {}),
          };
        }
      } catch (e) {
        observation = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          elements: [],
        };
      }
      const pageChanged = Boolean(observation && /** @type {any} */ (observation).pageChanged);
      const hint = pageChanged
        ? "Page changed — prior page element refs are invalid. Use this observation.elements[].ref only (older DOM is stripped from model context unless retainPriorPageDom=true). For file upload, use set_files with absolute paths. Call again for the next short batch (max 5 steps). When done, answer the user in natural language."
        : "Use observation.elements[].ref (or selector) for the next browser_action call. For file upload, use set_files with absolute paths — do NOT click buttons that open the native OS file picker. Call again for the next short batch (max 5 steps). When done, answer the user in natural language.";
      return {
        ok: Boolean(runResult?.ok),
        error: runResult?.error,
        stopReason: runResult?.stopReason,
        stoppedAt: runResult?.stoppedAt,
        steps: Array.isArray(runResult?.steps) ? runResult.steps : [],
        observation,
        ...(retainPriorPageDom ? { retainPriorPageDom: true } : {}),
        hint,
      };
    },
    [
      activePreviewTabId,
      artifactsPanel,
      embedPreview,
      iframeRef,
      previewTabs,
      revealDock,
      revokeBlob,
      runSidebarAutomation,
      session,
      webviewRef,
    ],
  );

  const executeBrowserOpenTool = useCallback(
    async (args = {}) => {
      // Web Explore: do not open a hidden/new preview — agent must use the visible tab
      // (`browser_action` navigate) or ask the user to change the address bar.
      if (embedPreview) {
        return {
          ok: false,
          error: "web_explore_no_browser_open",
          message:
            "browser_open is not available in Web Explore. Stay on the current main-viewport tab: use browser_action with a navigate step to change URL, or ask the user to open/switch tabs in the address bar.",
        };
      }
      const rawUrl = String(args?.url ?? "").trim();
      if (!rawUrl) {
        return { ok: false, error: "missing_url", message: "url is required" };
      }
      const title = String(args?.title ?? rawUrl).trim() || rawUrl;
      // Agent tool must always open the Chat Lab preview panel.
      // Do not honor the markdown "open links externally" preference here.
      let resolved;
      try {
        resolved = new URL(rawUrl, typeof window !== "undefined" ? window.location.href : "https://local.invalid/").href;
      } catch {
        return { ok: false, error: "invalid_url", url: rawUrl, message: "Could not parse URL" };
      }
      if (!/^https?:\/\//i.test(resolved)) {
        return { ok: false, error: "unsupported_url", url: rawUrl, message: "Only http(s) URLs can open in the preview panel" };
      }
      let opened = false;
      flushSync(() => {
        opened = showWebPreviewAtUrl(resolved, title, {
          externalUrl: resolved,
          sandbox: WEB_PREVIEW_SANDBOX,
          useWebview: true,
        });
      });
      if (!opened) {
        return { ok: false, error: "open_failed", url: resolved, message: "Could not open URL in preview panel" };
      }
      dispatchDockFocus({ url: resolved, title, source: "browser_open" });
      const readiness = await waitForPreviewWebviewReady(webviewRef.current, resolved);
      if (!readiness.ready) {
        return {
          ok: false,
          error: readiness.error ?? "webview_not_ready",
          url: readiness.url ?? resolved,
          title,
          dockOpen: true,
          message:
            "The preview panel opened, but the page did not become ready for browser_action. Retry after the page finishes loading.",
        };
      }
      return {
        ok: true,
        url: resolved,
        title,
        dockOpen: true,
        ready: true,
        message: "URL opened and finished loading in the Open Studio right preview panel. browser_action can continue.",
      };
    },
    [dispatchDockFocus, embedPreview, showWebPreviewAtUrl, webviewRef],
  );

  const closePreviewTab = useCallback(
    (tabId) => {
      const id = String(tabId ?? "").trim();
      if (!id) return;
      setPreviewTabs((prev) => {
        const idx = prev.findIndex((tab) => tab.id === id);
        if (idx < 0) return prev;
        const next = prev.filter((tab) => tab.id !== id);
        if (!next.length) {
          setActivePreviewTabId("");
          setSession(null);
          setDockOpen(false);
          return next;
        }
        const currentActiveId = String(activePreviewTabId ?? "").trim();
        if (currentActiveId === id) {
          const fallback = next[Math.min(idx, next.length - 1)];
          setActivePreviewTabId(fallback.id);
          setSession(sessionFromWebTab(fallback));
        }
        return next;
      });
    },
    [activePreviewTabId],
  );

  const value = useMemo(
    () => ({
      session,
      artifactsPanel,
      iframeRef,
      webviewRef,
      dockOpen,
      close,
      openDock,
      toggleDock,
      openIframe,
      openSrcDoc,
      openBlob,
      openPlaceholder,
      openFromHref,
      openFromMarkdownLink,
      navigatePreviewTo,
      deviceMode,
      setDeviceMode,
      openFromWorkspacePath,
      openArtifactsPanel,
      selectArtifact,
      setArtifactViewMode,
      postToPreview,
      subscribeFrameMessages,
      openWebviewDevTools,
      previewTabs,
      activePreviewTabId,
      activatePreviewTab,
      closePreviewTab,
      linkOpenMode,
      embedPreview,
      captureSidebarContextBlock,
      runSidebarAutomation,
      executeSidebarActionTool,
      executeBrowserOpenTool,
    }),
    [
      session,
      artifactsPanel,
      dockOpen,
      close,
      openDock,
      toggleDock,
      openIframe,
      openSrcDoc,
      openBlob,
      openPlaceholder,
      openFromHref,
      openFromMarkdownLink,
      navigatePreviewTo,
      deviceMode,
      setDeviceMode,
      openFromWorkspacePath,
      openArtifactsPanel,
      selectArtifact,
      setArtifactViewMode,
      postToPreview,
      subscribeFrameMessages,
      embedPreview,
      openWebviewDevTools,
      linkOpenMode,
      previewTabs,
      activePreviewTabId,
      activatePreviewTab,
      closePreviewTab,
      captureSidebarContextBlock,
      runSidebarAutomation,
      executeSidebarActionTool,
      executeBrowserOpenTool,
    ],
  );

  return <ChatLabPreviewContext.Provider value={value}>{children}</ChatLabPreviewContext.Provider>;
}
