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
import { useI18n } from "./I18nContext.jsx";
import { applyWorkspacePreviewReadResult } from "../chat/chatLabApplyWorkspaceRead.js";

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
 */

/** @type {import("react").Context<null | {
 *   session: ChatLabPreviewSession | null;
 *   iframeRef: import("react").RefObject<HTMLIFrameElement | null>;
 *   close: () => void;
 *   openIframe: (src: string, title: string, opts?: { externalUrl?: string | null; sandbox?: string }) => void;
 *   openSrcDoc: (html: string, title: string, opts?: { sandbox?: string }) => void;
 *   openBlob: (blob: Blob, title: string) => void;
 *   openPlaceholder: (title: string, body: string) => void;
 *   openFromMarkdownLink: (href: string, linkLabel: string) => boolean;
 *   openFromWorkspacePath: (inputPath: string, title?: string) => Promise<void>;
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

  /** @type {import("react").MutableRefObject<Set<(data: unknown) => void>>} */
  const subscribedRef = useRef(new Set());

  const [session, setSession] = useState(/** @type {ChatLabPreviewSession | null} */ (null));

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

  const close = useCallback(() => {
    revokeBlob();
    setSession(null);
  }, [revokeBlob]);

  const openIframe = useCallback(
    /**
     * @param {string} src
     * @param {string} title
     * @param {{ externalUrl?: string | null; sandbox?: string }} [opts]
     */
    (src, title, opts = {}) => {
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
    [revokeBlob],
  );

  const openSrcDoc = useCallback(
    /**
     * @param {string} html
     * @param {string} title
     * @param {{ sandbox?: string }} [opts]
     */
    (html, title, opts = {}) => {
      revokeBlob();
      setSession({
        kind: "srcdoc",
        html,
        title,
        frameKey: newPreviewFrameKey(),
        sandbox: opts.sandbox ?? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals",
      });
    },
    [revokeBlob],
  );

  const openBlob = useCallback(
    (blob, title) => {
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
    [revokeBlob],
  );

  const openPlaceholder = useCallback(
    (title, body) => {
      revokeBlob();
      setSession({
        kind: "placeholder",
        title,
        body,
        frameKey: newPreviewFrameKey(),
      });
    },
    [revokeBlob],
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
      const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
      const read =
        bridge && typeof bridge.readWorkspacePreviewFile === "function"
          ? bridge.readWorkspacePreviewFile
          : undefined;
      const maybeOpenOffice =
        bridge && typeof bridge.maybeOpenWorkspaceOfficeFileExternally === "function"
          ? bridge.maybeOpenWorkspaceOfficeFileExternally
          : undefined;
      const label = String(title ?? inputPath ?? "").trim() || String(inputPath ?? "");
      if (!read && !maybeOpenOffice) {
        openPlaceholder(label, t("chatLab.previewWorkspaceNeedsApp"));
        return;
      }

      if (maybeOpenOffice) {
        try {
          const xr = await maybeOpenOffice(inputPath);
          if (xr && typeof xr === "object" && xr.opened) {
            close();
            return;
          }
          if (xr && typeof xr === "object" && !xr.ok) {
            const detail = String(xr.message ?? "").trim() || "open_failed";
            openPlaceholder(label, t("chatLab.previewReadFailed", { detail }));
            return;
          }
        } catch (e) {
          const msg = String(e?.message ?? e);
          if (/No handler registered/i.test(msg)) {
            openPlaceholder(label, t("chatLab.previewIpcMissing"));
            return;
          }
          openPlaceholder(label, t("chatLab.previewReadFailed", { detail: msg }));
          return;
        }
      }

      if (!read) {
        openPlaceholder(label, t("chatLab.previewWorkspaceNeedsApp"));
        return;
      }

      let r;
      try {
        r = await read(inputPath);
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (/No handler registered/i.test(msg)) {
          openPlaceholder(label, t("chatLab.previewIpcMissing"));
          return;
        }
        openPlaceholder(label, t("chatLab.previewReadFailed", { detail: msg }));
        return;
      }
      applyWorkspacePreviewReadResult(r, { openSrcDoc, openBlob, openPlaceholder }, t, label);
    },
    [close, openBlob, openPlaceholder, openSrcDoc, t],
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
      iframeRef,
      close,
      openIframe,
      openSrcDoc,
      openBlob,
      openPlaceholder,
      openFromMarkdownLink,
      openFromWorkspacePath,
      postToPreview,
      subscribeFrameMessages,
    }),
    [
      session,
      close,
      openIframe,
      openSrcDoc,
      openBlob,
      openPlaceholder,
      openFromMarkdownLink,
      openFromWorkspacePath,
      postToPreview,
      subscribeFrameMessages,
    ],
  );

  return <ChatLabPreviewContext.Provider value={value}>{children}</ChatLabPreviewContext.Provider>;
}
