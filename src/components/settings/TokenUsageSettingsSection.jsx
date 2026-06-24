import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import echarts from "../../chat/chatLabEchartsRuntime.js";
import { getChatLabEchartsTheme } from "../../chat/chatLabEchartsTheme.js";
import {
  formatTokenCount,
  formatUsageTimestamp,
} from "../../chat/chatStreamUsageMeta.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { cn } from "../../ui/cn.js";

/** @typedef {"trend" | "daily" | "model" | "conversation"} UsageChartMode */
/** @typedef {"7d" | "30d" | "all"} UsageRange */

/**
 * @param {{
 *   options: Array<{ value: string; label: string }>;
 *   value: string;
 *   onChange: (v: string) => void;
 *   ariaLabel: string;
 * }} props
 */
function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-0.5 rounded-xl border border-[color-mix(in_srgb,var(--os-border)_80%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-subtle)_92%,transparent)] p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[0.65rem] px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
              active
                ? "bg-[var(--os-bg-elevated)] text-[var(--os-text)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * @param {{ label: string; input: number; output: number; total: number }} props
 */
function SummaryCard({ label, input, output, total }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--os-border)_84%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_96%,var(--os-bg-subtle))] px-4 py-3.5">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--os-text-faint)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--os-text)] tabular-nums">
        {formatTokenCount(total)}
      </p>
      <p className="mt-1 text-[0.8125rem] text-[var(--os-text-muted)] tabular-nums">
        {t("settings.usage.inOut", {
          input: formatTokenCount(input),
          output: formatTokenCount(output),
        })}
      </p>
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
    left: 36,
    right: 16,
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
      xAxis: { type: "category", data: stats.daily.labels, ...axis, splitLine: { show: false } },
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

  if (mode === "conversation" && stats?.byConversation?.length) {
    const rows = stats.byConversation.slice(0, 10).reverse();
    return {
      ...base,
      grid: { ...grid, left: 8, right: 24 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", ...axis },
      yAxis: {
        type: "category",
        data: rows.map((r) => (r.conversationTitle || r.conversationId).slice(0, 18)),
        ...axis,
        splitLine: { show: false },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 16,
          data: rows.map((r) => r.totalTokens),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
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
  const [records, setRecords] = useState(/** @type {unknown[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState("");

  const reload = useCallback(async () => {
    if (!bridge?.getTokenUsageStats || !bridge?.getTokenUsageRecords) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [statsRes, recordsRes] = await Promise.all([
        bridge.getTokenUsageStats({ range }),
        bridge.getTokenUsageRecords({
          limit: 60,
          ...(selectedConversationId ? { conversationId: selectedConversationId } : {}),
        }),
      ]);
      if (statsRes?.ok) setStats(statsRes.stats);
      if (recordsRes?.ok) setRecords(Array.isArray(recordsRes.records) ? recordsRes.records : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [bridge, range, selectedConversationId]);

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
      { value: "conversation", label: t("settings.usage.chartConversation") },
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
    setSelectedConversationId("");
    void reload();
  };

  return (
    <div className="token-usage-settings mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          ariaLabel={t("settings.usage.rangeAria")}
          options={rangeOptions}
          value={range}
          onChange={(v) => setRange(v === "7d" || v === "all" ? v : "30d")}
        />
        <button
          type="button"
          onClick={() => void onReset()}
          className="rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium text-[var(--os-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_88%,transparent)] hover:text-[var(--os-text)]"
        >
          {t("settings.usage.reset")}
        </button>
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

      <div className="overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--os-border)_88%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_96%,var(--os-bg-subtle))] px-4 py-4 sm:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.9375rem] font-semibold tracking-tight text-[var(--os-text)]">
            {t("settings.usage.chartTitle")}
          </p>
          <SegmentedControl
            ariaLabel={t("settings.usage.chartAria")}
            options={chartOptions}
            value={chartMode}
            onChange={(v) =>
              setChartMode(v === "daily" || v === "model" || v === "conversation" ? v : "trend")
            }
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

      <div className="overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--os-border)_88%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_96%,var(--os-bg-subtle))]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-[0.9375rem] font-semibold tracking-tight text-[var(--os-text)]">
              {t("settings.usage.recordsTitle")}
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-[var(--os-text-muted)]">
              {t("settings.usage.recordsHint")}
            </p>
          </div>
          {selectedConversationId ? (
            <button
              type="button"
              onClick={() => setSelectedConversationId("")}
              className="rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
            >
              {t("settings.usage.clearFilter")}
            </button>
          ) : null}
        </div>

        <div className="max-h-[320px] overflow-y-auto overscroll-contain">
          {records.length === 0 ? (
            <p className="px-4 py-10 text-center text-[0.875rem] text-[var(--os-text-muted)] sm:px-5">
              {t("settings.usage.noRecords")}
            </p>
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-left text-[0.8125rem]">
              <thead className="sticky top-0 z-[1] bg-[color-mix(in_srgb,var(--os-bg-elevated)_98%,var(--os-bg-subtle))]">
                <tr className="text-[var(--os-text-faint)]">
                  <th className="px-4 py-2.5 font-medium sm:px-5">{t("settings.usage.colContent")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("settings.usage.colModel")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">{t("settings.usage.input")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">{t("settings.usage.output")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">{t("settings.usage.total")}</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">{t("settings.usage.colTime")}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => {
                  const r = /** @type {Record<string, unknown>} */ (row);
                  const preview =
                    typeof r.userContentPreview === "string" && r.userContentPreview.trim()
                      ? r.userContentPreview.trim()
                      : typeof r.conversationTitle === "string" && r.conversationTitle.trim()
                        ? r.conversationTitle.trim()
                        : t("settings.usage.untitledTurn");
                  const model =
                    typeof r.modelLabel === "string" && r.modelLabel.trim()
                      ? r.modelLabel.trim()
                      : typeof r.modelId === "string"
                        ? r.modelId
                        : "—";
                  const conversationId =
                    typeof r.conversationId === "string" ? r.conversationId : "";
                  return (
                    <tr
                      key={String(r.id ?? r.streamId ?? preview)}
                      className="border-t border-[color-mix(in_srgb,var(--os-border)_60%,transparent)] hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_70%,transparent)]"
                    >
                      <td className="max-w-[14rem] px-4 py-3 sm:px-5">
                        <button
                          type="button"
                          onClick={() => conversationId && setSelectedConversationId(conversationId)}
                          className={cn(
                            "block w-full truncate text-left",
                            conversationId
                              ? "cursor-pointer text-[var(--os-text)] hover:underline"
                              : "cursor-default text-[var(--os-text-muted)]",
                          )}
                          title={preview}
                        >
                          {preview}
                        </button>
                      </td>
                      <td className="max-w-[8rem] truncate px-3 py-3 text-[var(--os-text-muted)]" title={model}>
                        {model}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                        {formatTokenCount(Number(r.inputTokens) || 0)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                        {formatTokenCount(Number(r.outputTokens) || 0)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium text-[var(--os-text)]">
                        {formatTokenCount(Number(r.totalTokens) || 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--os-text-faint)] sm:px-5">
                        {formatUsageTimestamp(Number(r.timestamp) || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
