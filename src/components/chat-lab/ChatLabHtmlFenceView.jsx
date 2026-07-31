import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useI18n } from "../../context/I18nContext.jsx";
import {
  INLINE_HTML_FENCE_MESSAGE_CHANNEL,
  INLINE_HTML_FENCE_SANDBOX,
  wrapHtmlFenceForInlineSrcDoc,
} from "../../chat/chatLabDocumentPreview.js";
import { analyzeHtmlFenceBody } from "../../chat/chatLabHtmlFenceBody.js";
import {
  HTML_FENCE_DEFAULT_RESERVED_PX,
  HTML_FENCE_ERROR_RESERVED_PX,
  normalizeHtmlFenceHeightPx,
} from "../../chat/chatLabHtmlFenceHeights.js";
import { readInlineHtmlThemeTokensFromDocument } from "../../chat/chatLabInlineHtmlTheme.js";
import { useDebouncedValue } from "../../ui/useDebouncedValue.js";

const STREAM_DEBOUNCE_MS = 320;
const MIN_FRAME_HEIGHT_PX = 1;

/**
 * @param {{
 *   code: string;
 *   theme?: "light" | "dark";
 *   active?: boolean;
 *   streaming?: boolean;
 *   reservedHeight?: number | null;
 *   onHeightMeasured?: (height: number) => void;
 *   onLayoutReady?: () => void;
 * }} props
 */
export default function ChatLabHtmlFenceView({
  code,
  theme = "light",
  active = true,
  streaming = false,
  reservedHeight = null,
  onHeightMeasured,
  onLayoutReady,
}) {
  const { t } = useI18n();
  const debouncedCode = useDebouncedValue(code, streaming ? STREAM_DEBOUNCE_MS : 0);
  const analysis = useMemo(() => analyzeHtmlFenceBody(debouncedCode), [debouncedCode]);
  const structuralError = !streaming && !analysis.ok && !analysis.empty;
  const themeTokens = useMemo(() => readInlineHtmlThemeTokensFromDocument(), [theme]);
  const srcDoc = useMemo(() => {
    if (analysis.empty || structuralError) return "";
    return wrapHtmlFenceForInlineSrcDoc(analysis.body, theme, themeTokens);
  }, [analysis.body, analysis.empty, structuralError, theme, themeTokens]);

  const seedHeight = useMemo(() => {
    if (structuralError) {
      return normalizeHtmlFenceHeightPx(reservedHeight) ?? HTML_FENCE_ERROR_RESERVED_PX;
    }
    return normalizeHtmlFenceHeightPx(reservedHeight) ?? HTML_FENCE_DEFAULT_RESERVED_PX;
  }, [reservedHeight, structuralError]);

  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const iframeRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const reportedHeightRef = useRef(/** @type {number | null} */ (null));
  const layoutReadyRef = useRef(false);
  const contentKeyRef = useRef("");
  const [visible, setVisible] = useState(false);
  const [frameHeight, setFrameHeight] = useState(seedHeight);
  const [loading, setLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState("");

  const renderFailed = structuralError || Boolean(runtimeError);

  const notifyLayoutReady = useCallback(() => {
    if (layoutReadyRef.current) return;
    layoutReadyRef.current = true;
    onLayoutReady?.();
  }, [onLayoutReady]);

  useEffect(() => {
    const contentKey = debouncedCode;
    if (contentKeyRef.current !== contentKey) {
      contentKeyRef.current = contentKey;
      layoutReadyRef.current = false;
      reportedHeightRef.current = normalizeHtmlFenceHeightPx(reservedHeight);
      setFrameHeight(seedHeight);
      setRuntimeError("");
    }
    setLoading(Boolean(srcDoc) && !renderFailed);
  }, [debouncedCode, srcDoc, seedHeight, reservedHeight, renderFailed]);

  useEffect(() => {
    if (streaming) return;
    if (analysis.empty) {
      notifyLayoutReady();
      return;
    }
    if (renderFailed) {
      notifyLayoutReady();
    }
  }, [analysis.empty, renderFailed, streaming, notifyLayoutReady]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const reportMeasuredHeight = useCallback(
    (raw) => {
      const px = normalizeHtmlFenceHeightPx(raw);
      if (!px || streaming || !onHeightMeasured) return;
      if (reportedHeightRef.current === px) return;
      reportedHeightRef.current = px;
      onHeightMeasured(px);
    },
    [onHeightMeasured, streaming],
  );

  useEffect(() => {
    if (streaming || !onHeightMeasured || analysis.empty) return;
    if (!renderFailed) return;
    reportMeasuredHeight(HTML_FENCE_ERROR_RESERVED_PX);
  }, [analysis.empty, renderFailed, streaming, onHeightMeasured, reportMeasuredHeight]);

  useEffect(() => {
    const onMessage = (ev) => {
      const data = ev.data;
      if (!data || data.channel !== INLINE_HTML_FENCE_MESSAGE_CHANNEL) return;

      const frameWin = iframeRef.current?.contentWindow;
      if (frameWin && ev.source !== frameWin) return;

      if (data.type === "resize") {
        const raw = Number(data.height);
        if (!Number.isFinite(raw) || raw <= 0) return;
        const rounded = Math.max(MIN_FRAME_HEIGHT_PX, Math.round(raw));
        setFrameHeight(rounded);
        setLoading(false);
        reportMeasuredHeight(rounded);
        notifyLayoutReady();
        return;
      }

      if (data.type === "error") {
        const msg = String(data.message ?? "").trim();
        if (msg) {
          setRuntimeError(msg);
          setLoading(false);
          notifyLayoutReady();
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [notifyLayoutReady, reportMeasuredHeight]);

  const onIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const hasCode = Boolean(String(code ?? "").trim());
  const showGenerating = streaming && hasCode;
  const shouldMountFrame = active && visible && Boolean(srcDoc) && !streaming && !renderFailed;

  return (
    <div ref={rootRef} className="chat-lab__html-fence" data-html-fence-failed={renderFailed ? "true" : undefined}>
      {showGenerating ? (
        <div
          className="chat-lab__html-fence__placeholder chat-lab__html-fence__placeholder--generating"
          aria-busy="true"
          role="status"
        >
          <span className="chat-lab__echarts-render__spinner" aria-hidden />
          <span className="chat-lab__html-fence__placeholder-label">{t("chatLab.htmlFenceGenerating")}</span>
        </div>
      ) : null}
      {analysis.empty && !streaming ? (
        <div className="chat-lab__html-fence__placeholder">
          <span className="chat-lab__html-fence__placeholder-label">{t("chatLab.htmlFenceEmpty")}</span>
        </div>
      ) : null}
      {renderFailed && !showGenerating ? (
        <div className="chat-lab__html-fence__failed" role="alert">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden className="chat-lab__html-fence__failed-icon" />
          <span className="chat-lab__html-fence__failed-label">{t("chatLab.htmlFenceRenderFailed")}</span>
        </div>
      ) : null}
      {shouldMountFrame ? (
        <iframe
          ref={iframeRef}
          className="chat-lab__html-fence__frame"
          title={t("chatLab.previewTitleHtml")}
          sandbox={INLINE_HTML_FENCE_SANDBOX}
          srcDoc={srcDoc}
          style={{ height: `${frameHeight}px` }}
          scrolling="no"
          loading="lazy"
          onLoad={onIframeLoad}
        />
      ) : null}
      {shouldMountFrame && loading ? (
        <div className="chat-lab__html-fence__mask" aria-hidden>
          <span className="chat-lab__echarts-render__spinner" />
          <span className="chat-lab__html-fence__placeholder-label">{t("chatLab.htmlFenceLoading")}</span>
        </div>
      ) : null}
    </div>
  );
}
