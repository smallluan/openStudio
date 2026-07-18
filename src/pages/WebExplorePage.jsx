import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Code, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { Button, Input } from "@open-studio/udesign";
import ChatLabPreviewWebFrame from "../components/chat-lab/ChatLabPreviewWebFrame.jsx";
import WebExploreChatFloat from "../components/web-explore/WebExploreChatFloat.jsx";
import { openChatLabExternalUrl } from "../chat/chatLabLinkOpenPreference.js";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "../ui/cn.js";

/**
 * @param {string} raw
 */
function normalizeExploreUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `https://${s}`;
}

/**
 * @param {string} url
 */
function explorePageTitle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export default function WebExplorePage() {
  const { t } = useI18n();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const iframeRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const webviewRef = useRef(/** @type {HTMLElement | null} */ (null));
  const [draft, setDraft] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [frameKey, setFrameKey] = useState("explore-0");
  const [landingKey, setLandingKey] = useState(0);
  const inElectron = typeof window !== "undefined" && Boolean(window.studioBridge);

  const commitUrl = useCallback((raw) => {
    const next = normalizeExploreUrl(raw);
    if (!next) return;
    setActiveUrl(next);
    setDraft(next);
    setFrameKey(`explore-${Date.now()}`);
  }, []);

  const handleSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      commitUrl(draft);
    },
    [commitUrl, draft],
  );

  const handleBackToLanding = useCallback(() => {
    setActiveUrl("");
    setDraft("");
    setLandingKey((k) => k + 1);
  }, []);

  const handleNavigate = useCallback((url) => {
    const next = normalizeExploreUrl(url);
    if (!next) return;
    setActiveUrl(next);
    setDraft(next);
  }, []);

  // Guest window.open is denied in main and forwarded here — load in the same webview.
  useEffect(() => {
    if (!inElectron) return undefined;
    const subscribe = window.studioBridge?.onOpenPreviewUrl;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((payload) => {
      const next = normalizeExploreUrl(payload?.url);
      if (!next) return;
      const node = webviewRef.current;
      if (node) {
        try {
          /** @type {import("electron").WebviewTag} */
          const wv = /** @type {import("electron").WebviewTag} */ (/** @type {unknown} */ (node));
          wv.loadURL?.(next);
          setActiveUrl(next);
          setDraft(next);
          return;
        } catch {
          /* fallthrough */
        }
      }
      setActiveUrl(next);
      setDraft(next);
      setFrameKey(`explore-${Date.now()}`);
    });
  }, [inElectron]);

  const handleReload = useCallback(() => {
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
        if (activeUrl) {
          iframe.src = activeUrl;
          return;
        }
        iframe.contentWindow?.location.reload?.();
        return;
      } catch {
        /* fallthrough */
      }
    }
    if (activeUrl) setFrameKey(`explore-${Date.now()}`);
  }, [activeUrl, inElectron]);

  const handleOpenExternal = useCallback(() => {
    if (!activeUrl) return;
    openChatLabExternalUrl(activeUrl, { forceExternal: true });
  }, [activeUrl]);

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

  if (!activeUrl) {
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
              ref={inputRef}
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
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className="web-explore-page__bar-btn"
            onClick={handleReload}
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
              title={t("chatLab.previewOpenDevTools")}
              aria-label={t("chatLab.previewOpenDevTools")}
            >
              <Code size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          ) : null}
        </div>
      </header>
      <div className={cn("web-explore-page__viewport", "chat-lab-preview-dock__body")}>
        <ChatLabPreviewWebFrame
          src={activeUrl}
          title={explorePageTitle(activeUrl)}
          frameKey={frameKey}
          useWebview={inElectron}
          deviceMode="desktop"
          iframeRef={iframeRef}
          webviewRefFromContext={webviewRef}
          onNavigate={handleNavigate}
          className="web-explore-page__frame"
        />
        <WebExploreChatFloat
          activeUrl={activeUrl}
          pageTitle={explorePageTitle(activeUrl)}
          inElectron={inElectron}
          webviewRef={webviewRef}
          iframeRef={iframeRef}
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  );
}
