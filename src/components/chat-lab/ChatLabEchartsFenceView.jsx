import { useMemo } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { resolveChartFenceOption } from "../../chat/chatLabChartDsl.js";
import { getChatLabChartBackgroundColor } from "../../chat/chatLabEchartsTheme.js";
import { ensureBuiltInMapsRegistered } from "../../chat/chatLabEchartsMaps.js";
import { ensureChartsRegistered } from "../../chat/chatLabEchartsChartRegistry.js";
import {
  chartFenceTailMarkdown,
  sanitizeChartFenceCode,
} from "../../chat/chatLabMarkdownChartFenceRepair.js";
import { repairGfmMarkdownTables } from "../../chat/chatLabMarkdownTableRepair.js";
import { cn } from "../../ui/cn.js";
import { useDebouncedValue } from "../../ui/useDebouncedValue.js";
import ChatLabChartMarkdownFallback from "./ChatLabChartMarkdownFallback.jsx";

const STREAM_DEBOUNCE_MS = 320;
const MIN_RESIZE_HEIGHT_PX = 200;

/**
 * @param {import("echarts").ECharts} instance
 */
function resizeChartWhenReady(instance) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      instance.resize();
    });
  });
}

/**
 * @typedef {{
 *   download: () => void;
 * }} ChatLabEchartsFenceHandle
 */

/**
 * @param {{
 *   code: string;
 *   label: string;
 *   theme: "light" | "dark";
 *   active?: boolean;
 *   streaming?: boolean;
 *   onStatusChange?: (status: { canDownload: boolean }) => void;
 * }} props
 * @param {import("react").Ref<ChatLabEchartsFenceHandle>} ref
 */
function ChatLabEchartsFenceView(
  { code, label, theme, active = true, streaming = false, onStatusChange },
  ref,
) {
  const { t } = useI18n();
  const debouncedCode = useDebouncedValue(code, streaming ? STREAM_DEBOUNCE_MS : 0);
  const sanitizedCode = useMemo(() => sanitizeChartFenceCode(debouncedCode), [debouncedCode]);
  const tailMarkdown = useMemo(() => {
    const tail = chartFenceTailMarkdown(debouncedCode);
    return tail ? repairGfmMarkdownTables(tail) : "";
  }, [debouncedCode]);
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const chartRef = useRef(/** @type {import("echarts").ECharts | null} */ (null));
  const echartsModuleRef = useRef(/** @type {import("echarts/core").EChartsType | null} */ (null));
  const resizeObserverRef = useRef(/** @type {ResizeObserver | null} */ (null));
  const [error, setError] = useState("");
  const [hasChart, setHasChart] = useState(false);
  const [busy, setBusy] = useState(true);
  const [markdownTableFallback, setMarkdownTableFallback] = useState(false);

  const handleDownload = useCallback(() => {
    const instance = chartRef.current;
    if (!instance) return;
    try {
      const url = instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: getChatLabChartBackgroundColor(theme),
      });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "chart.png";
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      /* ignore */
    }
  }, [theme]);

  useImperativeHandle(ref, () => ({ download: handleDownload }), [handleDownload]);

  useEffect(() => {
    if (!active) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;

    const render = async () => {
      setBusy(true);

      const resolved = resolveChartFenceOption(sanitizedCode, label, theme, { streaming });

      if (!resolved.ok) {
        if (resolved.markdownTable) {
          setMarkdownTableFallback(true);
          setError("");
          setBusy(false);
          return;
        }
        setMarkdownTableFallback(false);
        if (resolved.pending) {
          setError("");
          setBusy(false);
          return;
        }
        setError(resolved.error);
        setBusy(false);
        return;
      }

      setMarkdownTableFallback(false);

      setError("");

      try {
        if (!echartsModuleRef.current) {
          echartsModuleRef.current = (await import("../../chat/chatLabEchartsRuntime.js")).default;
        }
        const echartsModule = echartsModuleRef.current;
        await ensureBuiltInMapsRegistered(echartsModule, resolved.option);
        await ensureChartsRegistered(echartsModule, resolved.option);
        if (cancelled) return;

        if (!chartRef.current) {
          chartRef.current = echartsModule.init(container, theme === "dark" ? "dark" : undefined, {
            renderer: "canvas",
          });
          resizeObserverRef.current?.disconnect();
          resizeObserverRef.current = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect || rect.width < 20 || rect.height < MIN_RESIZE_HEIGHT_PX) return;
            chartRef.current?.resize();
          });
          resizeObserverRef.current.observe(container);
        }

        chartRef.current.setOption(resolved.option, { notMerge: true, lazyUpdate: false });
        setHasChart(true);
        resizeChartWhenReady(chartRef.current);
      } catch (err) {
        if (cancelled) return;
        const message = String(err?.message ?? err ?? "ECharts render failed");
        if (streaming) {
          setError("");
        } else {
          setError(message);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [active, sanitizedCode, label, streaming, theme]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (chartRef.current && echartsModuleRef.current) {
        echartsModuleRef.current.dispose(chartRef.current);
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!active || !chartRef.current) return undefined;
    resizeChartWhenReady(chartRef.current);
    return undefined;
  }, [active]);

  const showMask = busy || streaming || (!hasChart && !error);
  const canDownload = hasChart && !showMask && !error;

  useEffect(() => {
    onStatusChange?.({ canDownload });
  }, [canDownload, onStatusChange]);

  if (markdownTableFallback) {
    return <ChatLabChartMarkdownFallback source={debouncedCode} />;
  }

  if (error) {
    return <p className="chat-lab__code-render-error">{error}</p>;
  }

  return (
    <div className="chat-lab__echarts-render-wrap">
      <div className="chat-lab__echarts-render">
        <div className="chat-lab__echarts-render__stage">
          <div ref={containerRef} className="chat-lab__echarts-render__canvas" aria-hidden={false} />
        </div>
        {showMask ?
          <div
            className={cn(
              "chat-lab__echarts-render__mask",
              hasChart && "chat-lab__echarts-render__mask--overlay",
            )}
            role="status"
            aria-live="polite"
          >
            <span className="chat-lab__echarts-render__spinner" aria-hidden />
            <span className="chat-lab__echarts-render__mask-label">
              {hasChart ? t("chart.updating") : t("chart.generating")}
            </span>
          </div>
        : null}
      </div>
      {tailMarkdown ?
        <ChatLabChartMarkdownFallback source={tailMarkdown} />
      : null}
    </div>
  );
}

export default forwardRef(ChatLabEchartsFenceView);
