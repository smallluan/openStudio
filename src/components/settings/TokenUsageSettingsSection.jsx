import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { Radio, Statistic } from "tdesign-react";
import echarts from "../../chat/chatLabEchartsRuntime.js";
import { getChatLabEchartsTheme } from "../../chat/chatLabEchartsTheme.js";
import { formatTokenCount } from "../../chat/chatStreamUsageMeta.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";

/** @typedef {"trend" | "daily" | "model"} UsageChartMode */
/** @typedef {"7d" | "30d" | "all"} UsageRange */

/** @param {{ label: string; input: number; output: number; total: number }} props */
function SummaryCard({ label, input, output, total }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_94%,var(--os-bg-subtle))] px-5 py-4">
      <Statistic
        className="block w-full"
        title={label}
        value={total}
        separator=""
        format={(v) => formatTokenCount(v)}
        extra={
          <span className="text-[0.8125rem] text-[var(--os-text-muted)] tabular-nums">
            {t("settings.usage.inOut", {
              input: formatTokenCount(input),
              output: formatTokenCount(output),
            })}
          </span>
        }
      />
    </div>
  );
}

/**
 * @param {UsageChartMode} mode
 * @param {unknown} stats
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 * @param {"light" | "dark"} theme
 */
function buildChartOption(mode, stats, t, theme) {
  const { base } = getChatLabEchartsTheme(theme);
  const text = base.textStyle?.color ?? (theme === "dark" ? "#e6edf3" : "#2a2a2a");
  const grid = {
    left: 12,
    right: 12,
    top: 28,
    bottom: 28,
    containLabel: true,
  };
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: text, fontSize: 11 },
    splitLine: { lineStyle: { color: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)" } },
  };

  if (mode === "trend" && stats?.daily?.labels?.length) {
    return {
      ...base,
      grid,
      tooltip: { trigger: "axis" },
      legend: {
        top: 0,
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 8,
      },
      xAxis: { type: "category", data: stats.daily.labels, boundaryGap: false, ...axis, splitLine: { show: false } },
      yAxis: { type: "value", ...axis },
      series: [
        {
          name: t("settings.usage.input"),
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          data: stats.daily.inputTokens,
        },
        {
          name: t("settings.usage.output"),
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          data: stats.daily.outputTokens,
        },
      ],
    };
  }

  if (mode === "daily" && stats?.daily?.labels?.length) {
    return {
      ...base,
      grid,
      tooltip: { trigger: "axis" },
      legend: {
        top: 0,
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 8,
      },
      xAxis: { type: "category", data: stats.daily.labels, ...axis, splitLine: { show: false } },
      yAxis: { type: "value", ...axis },
      series: [
        {
          name: t("settings.usage.input"),
          type: "bar",
          stack: "tokens",
          barMaxWidth: 28,
          data: stats.daily.inputTokens,
        },
        {
          name: t("settings.usage.output"),
          type: "bar",
          stack: "tokens",
          barMaxWidth: 28,
          data: stats.daily.outputTokens,
        },
      ],
    };
  }

  if (mode === "model" && stats?.byModel?.length) {
    const rows = stats.byModel.slice(0, 8);
    return {
      ...base,
      tooltip: { trigger: "item" },
      legend: {
        orient: "vertical",
        right: 0,
        top: "middle",
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 8,
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          center: ["38%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          data: rows.map((r) => ({
            name: r.modelLabel || r.modelProfileId,
            value: r.totalTokens,
          })),
        },
      ],
    };
  }

  return {
    ...base,
    title: {
      text: t("settings.usage.noData"),
      left: "center",
      top: "middle",
      textStyle: { color: text, fontSize: 13, fontWeight: 500 },
    },
  };
}

/** @param {{ stats: unknown; mode: UsageChartMode; theme: "light" | "dark" }} props */
function UsageChart({ stats, mode, theme }) {
  const { t } = useI18n();
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const chartRef = useRef(/** @type {import("echarts").ECharts | null} */ (null));

  const option = useMemo(() => buildChartOption(mode, stats, t, theme), [mode, stats, t, theme]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const instance = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = instance;
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
    chartRef.current?.resize();
  }, [option]);

  return <div ref={containerRef} className="h-[240px] w-full" aria-hidden="true" />;
}

export default function TokenUsageSettingsSection() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [range, setRange] = useState(/** @type {UsageRange} */ ("30d"));
  const [chartMode, setChartMode] = useState(/** @type {UsageChartMode} */ ("trend"));
  const [stats, setStats] = useState(/** @type {unknown} */ (null));
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!bridge?.getTokenUsageStats) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const statsRes = await bridge.getTokenUsageStats({ range });
      if (statsRes?.ok) setStats(statsRes.stats);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [bridge, range]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rangeOptions = useMemo(
    () => [
      { value: "7d", label: t("settings.usage.range7d") },
      { value: "30d", label: t("settings.usage.range30d") },
      { value: "all", label: t("settings.usage.rangeAll") },
    ],
    [t],
  );

  const chartOptions = useMemo(
    () => [
      { value: "trend", label: t("settings.usage.chartTrend") },
      { value: "daily", label: t("settings.usage.chartDaily") },
      { value: "model", label: t("settings.usage.chartModel") },
    ],
    [t],
  );

  const summary = stats?.summary ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const today = stats?.today ?? summary;
  const month = stats?.month ?? summary;

  const onReset = async () => {
    if (!bridge?.resetTokenUsageStats) return;
    const ok = window.confirm(t("settings.usage.resetConfirm"));
    if (!ok) return;
    await bridge.resetTokenUsageStats();
    void reload();
  };

  return (
    <div className="token-usage-settings flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Radio.Group
          theme="button"
          variant="default-filled"
          value={range}
          options={rangeOptions}
          aria-label={t("settings.usage.rangeAria")}
          onChange={(v) => setRange(v === "7d" || v === "all" ? v : "30d")}
        />
        <Button type="button" variant="text" size="small" onClick={() => void onReset()}>
          {t("settings.usage.reset")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label={t("settings.usage.today")}
          input={today.inputTokens ?? 0}
          output={today.outputTokens ?? 0}
          total={today.totalTokens ?? 0}
        />
        <SummaryCard
          label={t("settings.usage.month")}
          input={month.inputTokens ?? 0}
          output={month.outputTokens ?? 0}
          total={month.totalTokens ?? 0}
        />
        <SummaryCard
          label={t("settings.usage.total")}
          input={summary.inputTokens ?? 0}
          output={summary.outputTokens ?? 0}
          total={summary.totalTokens ?? 0}
        />
      </div>

      <div className="px-0 py-1 sm:px-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.9375rem] font-semibold tracking-tight text-[var(--os-text)]">
            {t("settings.usage.chartTitle")}
          </p>
          <Radio.Group
            theme="button"
            variant="default-filled"
            value={chartMode}
            options={chartOptions}
            aria-label={t("settings.usage.chartAria")}
            onChange={(v) => setChartMode(v === "daily" || v === "model" ? v : "trend")}
          />
        </div>
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[var(--os-text-muted)]">
            {t("settings.usage.loading")}
          </p>
        ) : (
          <UsageChart stats={stats} mode={chartMode} theme={theme} />
        )}
      </div>
    </div>
  );
}
