import { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon } from "tdesign-icons-react";
import { cn } from "../../ui/cn.js";
import { PREVIEW_MOBILE_USER_AGENT } from "../../chat/chatLabDocumentPreview.js";
import { useI18n } from "../../context/I18nContext.jsx";
import ChatLabPreviewMobileAssistiveBall from "./ChatLabPreviewMobileAssistiveBall.jsx";

const WEBVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals";

/** iframe sizing — block is fine. */
const IFRAME_FRAME_STYLE = {
  display: "block",
  width: "100%",
  height: "100%",
  minHeight: 0,
  flex: "1 1 auto",
};

/**
 * Electron `<webview>` must stay `display:flex` (or inline-flex).
 * Overriding to `block` breaks the internal guest iframe fill — content clips to a strip.
 */
const WEBVIEW_FRAME_STYLE = {
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
 * @param {string} a
 * @param {string} b
 */
function previewUrlsMatch(a, b) {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    const u1 = new URL(left);
    const u2 = new URL(right);
    const norm = (u) => {
      const path = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.protocol}//${u.host}${path}${u.search}${u.hash}`;
    };
    return norm(u1) === norm(u2);
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   src: string;
 *   title: string;
 *   frameKey: string;
 *   sandbox?: string;
 *   useWebview?: boolean;
 *   deviceMode: "desktop" | "mobile";
 *   isActiveFrame?: boolean;
 *   iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *   webviewRefFromContext?: import("react").RefObject<HTMLElement | null>;
 *   onNavigate?: (url: string) => void;
 *   onWebviewHostChange?: (node: HTMLElement | null) => void;
 *   preLoadScript?: string;
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
  isActiveFrame = true,
  iframeRef,
  webviewRefFromContext,
  onNavigate,
  onWebviewHostChange,
  preLoadScript = "",
  className,
}) {
  const { t } = useI18n();
  // Do NOT include `src` — address-bar sync after in-page clicks would remount mid-navigation.
  const mountKey = `${frameKey}:${deviceMode}`;
  const webviewRef = useRef(/** @type {HTMLElement | null} */ (null));
  const shellRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const onNavigateRef = useRef(onNavigate);
  const onWebviewHostChangeRef = useRef(onWebviewHostChange);
  const isActiveFrameRef = useRef(isActiveFrame);
  const lastRequestedHttpUrlRef = useRef("");
  const failRecoverRef = useRef(
    /** @type {{ url: string; count: number; remounted: boolean }} */ ({ url: "", count: 0, remounted: false }),
  );
  onNavigateRef.current = onNavigate;
  onWebviewHostChangeRef.current = onWebviewHostChange;
  isActiveFrameRef.current = isActiveFrame;
  const [recoverNonce, setRecoverNonce] = useState(0);
  const [debuggerPaused, setDebuggerPaused] = useState(false);
  const [debuggerResuming, setDebuggerResuming] = useState(false);
  const effectiveMountKey = `${mountKey}:${recoverNonce}`;
  const mountKeyRef = useRef(effectiveMountKey);
  const preLoadAppliedRef = useRef("");

  useEffect(() => {
    const bridge = /** @type {{
      onDebuggerPause?: (fn: (data: unknown) => void) => () => void;
    }} */ (window).studioBridge;
    if (typeof bridge?.onDebuggerPause !== "function") return undefined;
    return bridge.onDebuggerPause((data) => {
      const evt = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data) : {};
      const paused = evt.paused === true || evt.debuggerPaused === true || evt.hit === true;
      setDebuggerPaused(paused);
      if (!paused) setDebuggerResuming(false);
    });
  }, []);

  const handleDebuggerResume = useCallback(async () => {
    if (debuggerResuming) return;
    const bridge = /** @type {{ resumeDebugger?: () => Promise<unknown> }} */ (window).studioBridge;
    if (typeof bridge?.resumeDebugger !== "function") return;
    setDebuggerResuming(true);
    try {
      await bridge.resumeDebugger();
    } catch {
      setDebuggerResuming(false);
    }
  }, [debuggerResuming]);
  const mountSrcRef = useRef(src);
  if (mountKeyRef.current !== effectiveMountKey) {
    mountKeyRef.current = effectiveMountKey;
    mountSrcRef.current = src;
    preLoadAppliedRef.current = "";
  }
  const [webviewNode, setWebviewNode] = useState(/** @type {HTMLElement | null} */ (null));
  const electronWebview = useWebview && typeof window !== "undefined" && Boolean(window.studioBridge);
  const [failed, setFailed] = useState(false);
  const [failDetail, setFailDetail] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);

  // When a background Web Explore tab becomes visible, reclaim main-process activeGuest.
  useEffect(() => {
    if (!isActiveFrame || !electronWebview || !webviewNode) return;
    try {
      /** @type {import("electron").WebviewTag} */
      const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (webviewNode));
      const id = typeof wv.getWebContentsId === "function" ? wv.getWebContentsId() : 0;
      if (id) window.studioBridge?.setActivePreviewGuest?.(id);
    } catch {
      /* ignore */
    }
  }, [electronWebview, isActiveFrame, webviewNode]);

  useEffect(() => {
    const next = String(src ?? "").trim();
    if (/^https?:\/\//i.test(next)) lastRequestedHttpUrlRef.current = next;
  }, [src]);

  const focusWebview = useCallback(() => {
    const node = webviewRef.current;
    if (!node) return;
    try {
      /** @type {import("electron").WebviewTag} */
      const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
      wv.focus?.();
    } catch {
      /* ignore */
    }
  }, []);

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
  }, [effectiveMountKey]);

  useEffect(() => {
    if (!electronWebview || !webviewNode) return;

    /** @type {import("electron").WebviewTag} */
    const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (webviewNode));
    let disposed = false;

    /** @param {Event & { url?: string; preventDefault?: () => void }} e */
    const onNewWindow = (e) => {
      e.preventDefault?.();
      const url = String(e.url ?? "").trim();
      if (!url) return;
      try {
        if (typeof wv.loadURL === "function") wv.loadURL(url);
        else onNavigateRef.current?.(url);
      } catch {
        onNavigateRef.current?.(url);
      }
    };

    /** @param {Event & { isMainFrame?: boolean; errorDescription?: string; errorCode?: number; validatedURL?: string }} e */
    const onFailLoad = (e) => {
      if (disposed) return;
      const code = Number(e.errorCode);
      if (isBenignWebviewLoadError(code)) return;
      const failedUrl = String(e.validatedURL ?? "").trim();
      const fromChromeError = failedUrl.startsWith("chrome-error://");
      const shouldTreatAsMain =
        e.isMainFrame !== false ||
        fromChromeError ||
        /^https?:\/\//i.test(failedUrl);
      if (!shouldTreatAsMain) return;

      if (fromChromeError) {
        const target = String(lastRequestedHttpUrlRef.current ?? "").trim();
        if (target) {
          if (failRecoverRef.current.url !== target) {
            failRecoverRef.current = { url: target, count: 0, remounted: false };
          }
          if (failRecoverRef.current.count < 1) {
            failRecoverRef.current.count += 1;
            // Chromium sometimes stays in chrome-error:// and blocks in-page redirects.
            // Retry one explicit top-level load to recover from transient failures.
            window.setTimeout(() => {
              if (disposed) return;
              try {
                wv.loadURL(target);
              } catch {
                /* ignore */
              }
            }, 120);
          } else if (!failRecoverRef.current.remounted) {
            failRecoverRef.current.remounted = true;
            // If a direct reload still lands on chrome-error://, recreate the guest once.
            setRecoverNonce((v) => v + 1);
          }
        }
      }
      setFailed(true);
      setFailDetail(String(e.errorDescription || e.errorCode || failedUrl || ""));
    };

    /** @param {Event} _e */
    const onFinishLoad = () => {
      if (!disposed) {
        setFailed(false);
        setFailDetail("");
        syncWebviewBackState();
      }
    };

    /** @param {Event & { url?: string }} e */
    const onDidNavigate = (e) => {
      if (disposed) return;
      syncWebviewBackState();
      const url = String(e.url ?? "").trim();
      if (/^https?:\/\//i.test(url)) {
        lastRequestedHttpUrlRef.current = url;
        failRecoverRef.current = { url, count: 0, remounted: false };
      }
      if (url) onNavigateRef.current?.(url);
    };

    /** Notify main which guest is active for browser_debug / browser_screenshot. */
    const publishActiveGuest = () => {
      if (!isActiveFrameRef.current) return;
      try {
        const id = typeof wv.getWebContentsId === "function" ? wv.getWebContentsId() : 0;
        if (id) window.studioBridge?.setActivePreviewGuest?.(id);
      } catch {
        /* ignore */
      }
    };
    publishActiveGuest();

    wv.addEventListener("new-window", onNewWindow);
    wv.addEventListener("did-fail-load", onFailLoad);
    wv.addEventListener("did-finish-load", onFinishLoad);
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("dom-ready", publishActiveGuest);

    const unsubscribeDevTools = window.studioBridge?.onOpenWebviewDevTools?.(() => {
      try {
        wv.openDevTools?.();
      } catch {
        /* ignore */
      }
    });

    return () => {
      disposed = true;
      wv.removeEventListener("new-window", onNewWindow);
      wv.removeEventListener("did-fail-load", onFailLoad);
      wv.removeEventListener("did-finish-load", onFinishLoad);
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("dom-ready", publishActiveGuest);
      unsubscribeDevTools?.();
    };
  }, [electronWebview, effectiveMountKey, syncWebviewBackState, webviewNode]);

  /** Register CDP pre-document script (Web Explore tab presets). Electron only. */
  useEffect(() => {
    if (!electronWebview || !webviewNode) return undefined;

    /** @type {import("electron").WebviewTag} */
    const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (webviewNode));
    let disposed = false;

    const applyPreLoadScript = async () => {
      if (disposed) return;
      const code = String(preLoadScript ?? "").trim();
      const guestId = typeof wv.getWebContentsId === "function" ? wv.getWebContentsId() : 0;
      if (!guestId) return;
      const bridge = /** @type {{ applyGuestPreloadScript?: (p: unknown) => Promise<unknown> }} */ (
        window
      ).studioBridge;
      if (typeof bridge?.applyGuestPreloadScript !== "function") return;
      try {
        await bridge.applyGuestPreloadScript({ webContentsId: guestId, code });
      } catch {
        return;
      }
      if (disposed) return;
      if (code && preLoadAppliedRef.current !== code) {
        preLoadAppliedRef.current = code;
        try {
          wv.reload?.();
        } catch {
          /* ignore */
        }
        return;
      }
      if (!code) preLoadAppliedRef.current = "";
    };

    const onDomReady = () => {
      void applyPreLoadScript();
    };

    wv.addEventListener("dom-ready", onDomReady);
    void applyPreLoadScript();

    return () => {
      disposed = true;
      wv.removeEventListener("dom-ready", onDomReady);
    };
  }, [electronWebview, webviewNode, preLoadScript, effectiveMountKey]);

  /**
   * Parent `src` updates (address bar / window.open IPC) must not rewrite the `src` attribute
   * (that remounts navigation). Drive intentional navigations through loadURL when the guest
   * is not already at that URL (e.g. after did-navigate address sync).
   */
  useEffect(() => {
    if (!electronWebview || !webviewNode || !src) return;

    /** @type {import("electron").WebviewTag} */
    const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (webviewNode));

    let current = "";
    try {
      current = String(wv.getURL?.() ?? "").trim();
    } catch {
      return;
    }
    // Still loading initial `src` attribute — only intervene if parent already asked for another URL.
    if (!current || current === "about:blank") {
      if (src && !previewUrlsMatch(src, mountSrcRef.current)) {
        try {
          wv.loadURL(src);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (previewUrlsMatch(current, src)) return;
    try {
      wv.loadURL(src);
    } catch {
      /* ignore */
    }
  }, [electronWebview, webviewNode, src, effectiveMountKey]);

  useEffect(() => {
    return () => {
      setWebviewNode(null);
      if (webviewRefFromContext) {
        webviewRefFromContext.current = null;
      }
      onWebviewHostChangeRef.current?.(null);
    };
  }, [effectiveMountKey, webviewRefFromContext]);

  /** Electron `<webview>` ignores flex/% height — pin pixel size to the shell box. */
  useEffect(() => {
    if (!electronWebview || !webviewNode) return;
    const shell = shellRef.current;
    if (!shell) return;

    /** @type {import("electron").WebviewTag} */
    const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (webviewNode));

    const syncSize = () => {
      const { width, height } = shell.getBoundingClientRect();
      const w = Math.max(0, Math.round(width));
      const h = Math.max(0, Math.round(height));
      if (w <= 0 || h <= 0) return;
      // Keep flex display while pinning guest surface to shell pixels.
      wv.style.display = "flex";
      wv.style.width = `${w}px`;
      wv.style.height = `${h}px`;
    };

    syncSize();
    const rafId = window.requestAnimationFrame(syncSize);

    /** @type {ResizeObserver | null} */
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(syncSize);
      ro.observe(shell);
      const viewport = shell.parentElement;
      if (viewport) ro.observe(viewport);
    }
    window.addEventListener("resize", syncSize);
    wv.addEventListener("dom-ready", syncSize);
    wv.addEventListener("did-finish-load", syncSize);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener("resize", syncSize);
      wv.removeEventListener("dom-ready", syncSize);
      wv.removeEventListener("did-finish-load", syncSize);
    };
  }, [electronWebview, webviewNode, effectiveMountKey]);

  const frameClass = cn("chat-lab-preview-dock__frame border-0", className);
  const mobileShell = deviceMode === "mobile";

  const errorOverlay = failed ? (
    <div className="chat-lab-preview-dock__frame-status chat-lab-preview-dock__frame-status--error" role="alert">
      <p>{t("chatLab.previewWebLoadFailed")}</p>
      {failDetail ? <p className="chat-lab-preview-dock__frame-status-detail">{failDetail}</p> : null}
    </div>
  ) : null;

  const debuggerOverlay = debuggerPaused ? (
    <div className="chat-lab-preview-dock__debugger-mask" role="status" aria-live="polite">
      <div className="chat-lab-preview-dock__debugger-bar">
        <button
          type="button"
          className="chat-lab-preview-dock__debugger-resume"
          aria-label={t("chatLab.previewDebuggerResume")}
          title={t("chatLab.previewDebuggerResume")}
          disabled={debuggerResuming}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleDebuggerResume();
          }}
        >
          <PlayIcon className="chat-lab-preview-dock__debugger-resume-icon" />
        </button>
        <span className="chat-lab-preview-dock__debugger-bar-text">{t("chatLab.previewDebuggerPaused")}</span>
      </div>
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
      onMouseDown={electronWebview ? focusWebview : undefined}
    >
      {errorOverlay}
      {debuggerOverlay}
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
              if (webviewRefFromContext) {
                webviewRefFromContext.current = node;
              }
              onWebviewHostChangeRef.current?.(node);
            }}
            key={effectiveMountKey}
            src={mountSrcRef.current}
            partition="persist:openstudio-preview"
            allowpopups="true"
            {...(deviceMode === "mobile" ? { useragent: PREVIEW_MOBILE_USER_AGENT } : {})}
            webpreferences="contextIsolation=yes,javascript=yes"
            className={frameClass}
            style={WEBVIEW_FRAME_STYLE}
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
          style={IFRAME_FRAME_STYLE}
          title={title}
          key={effectiveMountKey}
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
