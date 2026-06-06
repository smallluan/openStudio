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
} from "../chat/chatLabDocumentPreview.js";
import { artifactPayloadFromReadResult } from "../chat/chatLabArtifactFilePayload.js";
import { useI18n } from "./I18nContext.jsx";
import { artifactPreviewKindFromPath } from "../chat/chatLabArtifactPreviewKind.js";

/**
 * @typedef {{
 *   kind: "iframe";
 *   src: string;
 *   title: string;
 *   frameKey: string;
 *   sandbox?: string;
 *   externalUrl?: string | null;
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
 * }} ArtifactsPanelState
 */

/** @type {import("react").Context<null | {
 *   session: ChatLabPreviewSession | null;
 *   artifactsPanel: ArtifactsPanelState | null;
 *   iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *   close: () => void;
 *   openIframe: (src: string, title: string, opts?: { externalUrl?: string | null; sandbox?: string }) => void;
 *   openSrcDoc: (html: string, title: string, opts?: { sandbox?: string }) => void;
 *   openBlob: (blob: Blob, title: string) => void;
 *   openPlaceholder: (title: string, body: string) => void;
 *   openFromMarkdownLink: (href: string, linkLabel: string) => boolean;
 *   openFromWorkspacePath: (inputPath: string, title?: string) => Promise<void>;
 *   openArtifactsPanel: (files: SessionArtifact[], selectPath?: string) => void;
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
  const blobRevokeRef = useRef(/** @type {string | null} */ (null));
  /** @type {import("react").MutableRefObject<Set<string>>} */
  const artifactBlobUrlsRef = useRef(new Set());
  const artifactLoadGenRef = useRef(0);

  /** @type {import("react").MutableRefObject<Set<(data: unknown) => void>>} */
  const subscribedRef = useRef(new Set());

  const [session, setSession] = useState(/** @type {ChatLabPreviewSession | null} */ (null));
  const [artifactsPanel, setArtifactsPanel] = useState(/** @type {ArtifactsPanelState | null} */ (null));

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

  const loadArtifactAtPath = useCallback(
    /**
     * @param {string} inputPath
     * @param {SessionArtifact[]} files
     * @param {"render"|"source"} viewMode
     */
    async (inputPath, files, viewMode) => {
      const path = String(inputPath ?? "").trim();
      const gen = ++artifactLoadGenRef.current;
      setArtifactsPanel({
        files,
        selectedPath: path,
        viewMode,
        loading: true,
        error: null,
        payload: null,
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
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: "workspace_needs_app",
          payload: null,
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
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: "workspace_needs_app",
          payload: null,
        });
        return;
      }

      let r;
      try {
        r = await read(path);
      } catch (e) {
        if (gen !== artifactLoadGenRef.current) return;
        const msg = String(e?.message ?? e);
        setArtifactsPanel({
          files,
          selectedPath: path,
          viewMode,
          loading: false,
          error: /No handler registered/i.test(msg) ? "ipc_missing" : msg,
          payload: null,
        });
        return;
      }

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
        });
        return;
      }
      if (built.blobUrl) artifactBlobUrlsRef.current.add(built.blobUrl);
      setArtifactsPanel({
        files,
        selectedPath: path,
        viewMode,
        loading: false,
        error: null,
        payload: built,
      });
    },
    [close, revokeArtifactBlobs, revokeBlob],
  );

  const openArtifactsPanel = useCallback(
    /**
     * @param {SessionArtifact[]} files
     * @param {string} [selectPath]
     */
    (files, selectPath) => {
      const list = Array.isArray(files) ? files.filter((f) => f?.path) : [];
      if (!list.length) return;
      const pick =
        selectPath && list.some((f) => f.path === selectPath) ? selectPath : list[list.length - 1].path;
      void loadArtifactAtPath(pick, list, "render");
    },
    [loadArtifactAtPath],
  );

  const selectArtifact = useCallback(
    (path) => {
      if (!artifactsPanel?.files?.length) return;
      const viewMode = artifactsPanel.viewMode;
      void loadArtifactAtPath(path, artifactsPanel.files, viewMode);
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
     * @param {{ externalUrl?: string | null; sandbox?: string }} [opts]
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

  const openFromMarkdownLink = useCallback(
    (href, linkLabel) => {
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
            openIframe(viewer, title, { externalUrl: abs, sandbox: "allow-scripts allow-same-origin allow-popups" });
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
        openIframe(resolved, title, { externalUrl: resolved, sandbox: "allow-scripts allow-downloads allow-popups" });
        return true;
      }

      return false;
    },
    [openIframe, openPlaceholder, t],
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

  const value = useMemo(
    () => ({
      session,
      artifactsPanel,
      iframeRef,
      close,
      openIframe,
      openSrcDoc,
      openBlob,
      openPlaceholder,
      openFromMarkdownLink,
      openFromWorkspacePath,
      openArtifactsPanel,
      selectArtifact,
      setArtifactViewMode,
      postToPreview,
      subscribeFrameMessages,
    }),
    [
      session,
      artifactsPanel,
      close,
      openIframe,
      openSrcDoc,
      openBlob,
      openPlaceholder,
      openFromMarkdownLink,
      openFromWorkspacePath,
      openArtifactsPanel,
      selectArtifact,
      setArtifactViewMode,
      postToPreview,
      subscribeFrameMessages,
    ],
  );

  return <ChatLabPreviewContext.Provider value={value}>{children}</ChatLabPreviewContext.Provider>;
}
