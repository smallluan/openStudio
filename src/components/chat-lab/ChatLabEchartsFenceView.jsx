import { useEffect, useMemo, useRef, useState } from "react";
import { resolveChartFenceOption } from "../../chat/chatLabChartDsl.js";
import { ensureBuiltInMapsRegistered } from "../../chat/chatLabEchartsMaps.js";

/** @type {Map<string, string>} */
const CHART_ERROR_CACHE = new Map();

const MIN_RESIZE_HEIGHT_PX = 200;

/** @param {"light" | "dark"} theme @param {string} label @param {string} code */
function chartCacheKey(theme, label, code) {
  return `${theme}\u0000${label}\u0000${code}`;
}

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
 * @param {{
 *   code: string;
 *   label: string;
 *   theme: "light" | "dark";
 *   active?: boolean;
 * }} props
 */
export default function ChatLabEchartsFenceView({ code, label, theme, active = true }) {
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const chartRef = useRef(/** @type {import("echarts").ECharts | null} */ (null));
  const cacheKey = useMemo(() => chartCacheKey(theme, label, code), [theme, label, code]);
  const [error, setError] = useState(() => CHART_ERROR_CACHE.get(cacheKey) ?? "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
  }, [cacheKey]);

  useEffect(() => {
    if (!active) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const resolved = resolveChartFenceOption(code, label, theme);
    if (!resolved.ok) {
      if (resolved.pending) {
        CHART_ERROR_CACHE.delete(cacheKey);
        setError("");
        setLoading(true);
        return undefined;
      }
      CHART_ERROR_CACHE.set(cacheKey, resolved.error);
      setError(resolved.error);
      setLoading(false);
      return undefined;
    }

    CHART_ERROR_CACHE.delete(cacheKey);
    setError("");

    let cancelled = false;
    let resizeObserver = /** @type {ResizeObserver | null} */ (null);
    /** @type {import("echarts/core").EChartsType | null} */
    let echartsModule = null;

    void import("../../chat/chatLabEchartsRuntime.js")
      .then(async (mod) => {
        if (cancelled) return;
        echartsModule = mod.default;
        await ensureBuiltInMapsRegistered(echartsModule, resolved.option);
        if (cancelled) return;
        if (chartRef.current) {
          echartsModule.dispose(chartRef.current);
          chartRef.current = null;
        }
        const instance = echartsModule.init(container, theme === "dark" ? "dark" : undefined, {
          renderer: "canvas",
        });
        chartRef.current = instance;
        instance.setOption(resolved.option, { notMerge: true, lazyUpdate: false });
        setLoading(false);
        resizeChartWhenReady(instance);

        resizeObserver = new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect;
          if (!rect || rect.width < 20 || rect.height < MIN_RESIZE_HEIGHT_PX) return;
          instance.resize();
        });
        resizeObserver.observe(container);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = String(err?.message ?? err ?? "ECharts render failed");
          CHART_ERROR_CACHE.set(cacheKey, message);
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (chartRef.current && echartsModule) {
        echartsModule.dispose(chartRef.current);
        chartRef.current = null;
      }
    };
  }, [active, cacheKey, code, label, theme]);

  useEffect(() => {
    if (!active || !chartRef.current) return undefined;
    resizeChartWhenReady(chartRef.current);
    return undefined;
  }, [active]);

  if (error) {
    return <p className="chat-lab__code-render-error">{error}</p>;
  }

  return (
    <div className="chat-lab__echarts-render">
      {loading ? <div className="chat-lab__code-render-loading" aria-hidden /> : null}
      <div ref={containerRef} className="chat-lab__echarts-render__canvas" aria-hidden={false} />
    </div>
  );
}
