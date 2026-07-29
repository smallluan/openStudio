import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import {
  INLINE_HTML_FENCE_MESSAGE_CHANNEL,
  INLINE_HTML_FENCE_SANDBOX,
  wrapHtmlFenceForInlineSrcDoc,
} from "../../chat/chatLabDocumentPreview.js";
import { readInlineHtmlThemeTokensFromDocument } from "../../chat/chatLabInlineHtmlTheme.js";
import { useDebouncedValue } from "../../ui/useDebouncedValue.js";

const STREAM_DEBOUNCE_MS = 320;
const MIN_FRAME_HEIGHT_PX = 1;
const INTERSECTION_ROOT_MARGIN = "240px";

/**
 * @param {{
 *   code: string;
 *   theme?: "light" | "dark";
 *   active?: boolean;
 *   streaming?: boolean;
 * }} props
 */
export default function ChatLabHtmlFenceView({ code, theme = "light", active = true, streaming = false }) {
  const { t } = useI18n();
  const debouncedCode = useDebouncedValue(code, streaming ? STREAM_DEBOUNCE_MS : 0);
  const themeTokens = useMemo(() => readInlineHtmlThemeTokensFromDocument(), [theme]);
  const srcDoc = useMemo(
    () => wrapHtmlFenceForInlineSrcDoc(debouncedCode, theme, themeTokens),
    [debouncedCode, theme, themeTokens],
  );
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const iframeRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const [visible, setVisible] = useState(false);
  const [frameHeight, setFrameHeight] = useState(MIN_FRAME_HEIGHT_PX);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: INTERSECTION_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setFrameHeight(MIN_FRAME_HEIGHT_PX);
    setLoading(Boolean(srcDoc));
  }, [srcDoc]);

  useEffect(() => {
    const onMessage = (ev) => {
      const data = ev.data;
      if (
        !data ||
        data.channel !== INLINE_HTML_FENCE_MESSAGE_CHANNEL ||
        data.type !== "resize"
      ) {
        return;
      }
      const frameWin = iframeRef.current?.contentWindow;
      if (frameWin && ev.source !== frameWin) return;
      const raw = Number(data.height);
      if (!Number.isFinite(raw) || raw <= 0) return;
      setFrameHeight(Math.max(MIN_FRAME_HEIGHT_PX, Math.round(raw)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const onIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const hasCode = Boolean(String(code ?? "").trim());
  const showGenerating = streaming && hasCode;
  const shouldMountFrame = active && visible && Boolean(srcDoc) && !streaming;

  return (
    <div ref={rootRef} className="chat-lab__html-fence">
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
      {!srcDoc && !streaming ? (
        <div className="chat-lab__html-fence__placeholder">
          <span className="chat-lab__html-fence__placeholder-label">{t("chatLab.htmlFenceEmpty")}</span>
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
        </div>
      ) : null}
    </div>
  );
}
