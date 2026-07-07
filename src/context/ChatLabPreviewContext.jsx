import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const PREVIEW_DEVICE_KEY = "openstudio_chat_preview_device";

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
 *   close: () => void;
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
 * }>} */
export const ChatLabPreviewContext = createContext(null);

export function useChatLabPreview() {
  return useContext(ChatLabPreviewContext);
}

export function ChatLabPreviewProvider({ children }) {
  const { t } = useI18n();
  const iframeRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const webviewRef = useRef(/** @type {HTMLElement | null} */ (null));
  const blobRevokeRef = useRef(/** @type {string | null} */ (null));
  /** @type {import("react").MutableRefObject<Set<string>>} */
  const artifactBlobUrlsRef = useRef(new Set());
  const artifactLoadGenRef = useRef(0);

  /** @type {import("react").MutableRefObject<Set<(data: unknown) => void>>} */
  const subscribedRef = useRef(new Set());

  const [session, setSession] = useState(/** @type {ChatLabPreviewSession | null} */ (null));
  const [artifactsPanel, setArtifactsPanel] = useState(/** @type {ArtifactsPanelState | null} */ (null));
  const [deviceMode, setDeviceModeState] = useState(readPreviewDeviceMode);
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);

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

  const close = useCallback(() => {
    revokeBlob();
    revokeArtifactBlobs();
    setSession(null);
    setArtifactsPanel(null);
  }, [revokeArtifactBlobs, revokeBlob]);

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
     */
    (src, title, opts = {}) => {
      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
      setSession({
        kind: "iframe",
        src,
        title,
        frameKey: newPreviewFrameKey(),
        sandbox: opts.sandbox,
        externalUrl: opts.externalUrl ?? src,
        useWebview: Boolean(opts.useWebview),
      });
    },
    [revokeArtifactBlobs, revokeBlob],
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
    },
    [revokeArtifactBlobs, revokeBlob],
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
    },
    [revokeArtifactBlobs, revokeBlob],
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
    },
    [revokeArtifactBlobs, revokeBlob],
  );

  const navigatePreviewTo = useCallback(
    /**
     * @param {string} url
     * @param {string} [title]
     */
    (url, title) => {
      const nextUrl = String(url ?? "").trim();
      if (!nextUrl) return;
      const label = String(title ?? nextUrl).trim() || nextUrl;
      setSession((prev) => {
        if (prev?.kind === "iframe" && prev.useWebview) {
          return {
            ...prev,
            src: nextUrl,
            externalUrl: nextUrl,
            title: label,
            frameKey: newPreviewFrameKey(),
          };
        }
        return {
          kind: "iframe",
          src: nextUrl,
          title: label,
          frameKey: newPreviewFrameKey(),
          sandbox:
            "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
          externalUrl: nextUrl,
          useWebview: true,
        };
      });
      revokeArtifactBlobs();
      setArtifactsPanel(null);
      revokeBlob();
    },
    [revokeArtifactBlobs, revokeBlob],
  );

  const openFromHref = useCallback(
    /**
     * @param {string} href
     * @param {string} [linkLabel]
     * @returns {boolean}
     */
    (href, linkLabel) => {
      if (!isPreviewInterceptableHref(href)) return false;

      if (linkOpenMode === "external") {
        return openChatLabExternalUrl(href);
      }

      const kind = previewKindFromHref(href);
      if (!kind) return false;
      const title = String(linkLabel ?? "").trim() || href;

      if (kind === "blob" || href.startsWith("data:")) {
        openIframe(href, title, { externalUrl: null, sandbox: "allow-scripts allow-downloads" });
        return true;
      }

      if (kind === "sheet" || kind === "slides") {
        const abs = absoluteHttpUrlMaybe(href);
        if (abs) {
          const viewer = officeEmbedViewerUrl(abs);
          if (viewer) {
            openIframe(viewer, title, {
              externalUrl: abs,
              sandbox: "allow-scripts allow-same-origin allow-popups",
            });
            return true;
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
        openIframe(resolved, title, {
          externalUrl: resolved,
          sandbox: "allow-scripts allow-downloads allow-popups",
        });
        return true;
      }

      if (kind === "web") {
        openIframe(resolved, title, {
          externalUrl: resolved,
          sandbox:
            "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
          useWebview: true,
        });
        return true;
      }

      return false;
    },
    [linkOpenMode, openIframe, openPlaceholder, t],
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

  const value = useMemo(
    () => ({
      session,
      artifactsPanel,
      iframeRef,
      webviewRef,
      close,
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
    }),
    [
      session,
      artifactsPanel,
      close,
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
    ],
  );

  return <ChatLabPreviewContext.Provider value={value}>{children}</ChatLabPreviewContext.Provider>;
}
