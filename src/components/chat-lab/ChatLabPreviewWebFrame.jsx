import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../ui/cn.js";
import { PREVIEW_MOBILE_USER_AGENT } from "../../chat/chatLabDocumentPreview.js";
import { useI18n } from "../../context/I18nContext.jsx";
import ChatLabPreviewMobileAssistiveBall from "./ChatLabPreviewMobileAssistiveBall.jsx";

const WEBVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals";

const FRAME_STYLE = {
  display: "flex",
  width: "100%",
  height: "100%",
  minHeight: 0,
  flex: "1 1 auto",
};

/** Chromium ERR_ABORTED — fired when a navigation is superseded (redirect); not a real failure. */
const NET_ERROR_ABORTED = -3;

/** @param {number} code */
function isBenignWebviewLoadError(code) {
  return code === NET_ERROR_ABORTED;
}

/**
 * @param {{
 *   src: string;
 *   title: string;
 *   frameKey: string;
 *   sandbox?: string;
 *   useWebview?: boolean;
 *   deviceMode: "desktop" | "mobile";
 *   iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *   onNavigate?: (url: string) => void;
 *   className?: string;
 * }} props
 */
export default function ChatLabPreviewWebFrame({
  src,
  title,
  frameKey,
  sandbox,
  useWebview = false,
  deviceMode,
  iframeRef,
  onNavigate,
  className,
}) {
  const { t } = useI18n();
  const mountKey = `${frameKey}:${deviceMode}:${src}`;
  const webviewRef = useRef(/** @type {HTMLElement | null} */ (null));
  const shellRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [webviewNode, setWebviewNode] = useState(/** @type {HTMLElement | null} */ (null));
  const electronWebview = useWebview && typeof window !== "undefined" && Boolean(window.studioBridge);
  const [failed, setFailed] = useState(false);
  const [failDetail, setFailDetail] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);

  const syncWebviewBackState = useCallback(() => {
    const node = webviewRef.current;
    if (!node) {
      setCanGoBack(false);
      return;
    }
    /** @type {import("electron").WebviewTag} */
    const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
    try {
      setCanGoBack(Boolean(wv.canGoBack?.()));
    } catch {
      setCanGoBack(false);
    }
  }, []);

  const handleMobileBack = useCallback(() => {
    if (electronWebview) {
      const node = webviewRef.current;
      if (!node) return;
      /** @type {import("electron").WebviewTag} */
      const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
      try {
        if (wv.canGoBack?.()) wv.goBack();
      } catch {
        /* ignore */
      }
      return;
    }
    const frame = iframeRef?.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.history.back();
    } catch {
      /* cross-origin */
    }
  }, [electronWebview, iframeRef]);

  useEffect(() => {
    setFailed(false);
    setFailDetail("");
    setCanGoBack(false);
  }, [src, frameKey, deviceMode]);

  useEffect(() => {
    if (!electronWebview || !src || !webviewNode) return;

    /** @type {import("electron").WebviewTag} */
    const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (webviewNode));
    let disposed = false;

    /** @param {Event & { url?: string; preventDefault?: () => void }} e */
    const onNewWindow = (e) => {
      e.preventDefault?.();
      const url = String(e.url ?? "").trim();
      if (url) onNavigate?.(url);
    };

    /** @param {Event & { isMainFrame?: boolean; errorDescription?: string; errorCode?: number }} e */
    const onFailLoad = (e) => {
      if (disposed || e.isMainFrame === false) return;
      const code = Number(e.errorCode);
      if (isBenignWebviewLoadError(code)) return;
      setFailed(true);
      setFailDetail(String(e.errorDescription || e.errorCode || ""));
    };

    /** @param {Event} _e */
    const onFinishLoad = () => {
      if (!disposed) {
        setFailed(false);
        setFailDetail("");
        syncWebviewBackState();
      }
    };

    /** @param {Event} _e */
    const onDidNavigate = () => {
      if (!disposed) syncWebviewBackState();
    };

    wv.addEventListener("new-window", onNewWindow);
    wv.addEventListener("did-fail-load", onFailLoad);
    wv.addEventListener("did-finish-load", onFinishLoad);
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);

    return () => {
      disposed = true;
      wv.removeEventListener("new-window", onNewWindow);
      wv.removeEventListener("did-fail-load", onFailLoad);
      wv.removeEventListener("did-finish-load", onFinishLoad);
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
    };
  }, [electronWebview, src, frameKey, deviceMode, onNavigate, syncWebviewBackState, webviewNode]);

  useEffect(() => {
    setWebviewNode(null);
  }, [mountKey]);

  const frameClass = cn("chat-lab-preview-dock__frame border-0", className);
  const mobileShell = deviceMode === "mobile";

  const errorOverlay = failed ? (
    <div className="chat-lab-preview-dock__frame-status chat-lab-preview-dock__frame-status--error" role="alert">
      <p>{t("chatLab.previewWebLoadFailed")}</p>
      {failDetail ? <p className="chat-lab-preview-dock__frame-status-detail">{failDetail}</p> : null}
    </div>
  ) : null;

  const showMobileAssistive = mobileShell && /^https?:\/\//i.test(src);

  const frameShell = (frameNode) => (
    <div
      ref={shellRef}
      className={cn(
        "chat-lab-preview-dock__frame-shell",
        mobileShell && "chat-lab-preview-dock__frame-shell--mobile",
      )}
    >
      {errorOverlay}
      {showMobileAssistive ? (
        <ChatLabPreviewMobileAssistiveBall
          shellRef={shellRef}
          onBack={handleMobileBack}
          canGoBack={canGoBack}
          label={t("chatLab.previewMobileAssistive")}
        />
      ) : null}
      {frameNode}
    </div>
  );

  if (electronWebview) {
    return (
      <div
        className={cn(
          "chat-lab-preview-dock__viewport",
          mobileShell && "chat-lab-preview-dock__viewport--mobile",
        )}
      >
        {frameShell(
          <webview
            ref={(node) => {
              webviewRef.current = node;
              setWebviewNode(node);
            }}
            key={mountKey}
            src={src}
            partition="persist:openstudio-preview"
            allowpopups="true"
            {...(deviceMode === "mobile" ? { useragent: PREVIEW_MOBILE_USER_AGENT } : {})}
            webpreferences="contextIsolation=yes,javascript=yes"
            className={frameClass}
            style={FRAME_STYLE}
            title={title}
          />,
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "chat-lab-preview-dock__viewport",
        mobileShell && "chat-lab-preview-dock__viewport--mobile",
      )}
    >
      {frameShell(
        <iframe
          ref={iframeRef}
          className={frameClass}
          style={FRAME_STYLE}
          title={title}
          key={mountKey}
          src={src}
          sandbox={sandbox ?? WEBVIEW_SANDBOX}
          onError={() => {
            setFailed(true);
            setFailDetail("");
          }}
        />,
      )}
    </div>
  );
}
