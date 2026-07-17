import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
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
          <Button
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
          </Button>
        );
      })}
    </div>
  );
}

/** @param {{ label: string; input: number; output: number; total: number }} props */
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

/**
 * @param {unknown} breakdown
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 */
function hasUsageBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return false;
  const b = /** @type {Record<string, unknown>} */ (breakdown);
  return (
    Number(b.estSystemTokens) > 0 ||
    Number(b.estHistoryTokens) > 0 ||
    Number(b.estUserTokens) > 0 ||
    Number(b.estGatewayOverheadTokens) > 0 ||
    Number(b.llmCallCount) > 0 ||
    Number(b.toolCallCount) > 0 ||
    Number(b.cacheReadTokens) > 0 ||
    Number(b.cacheWriteTokens) > 0
  );
}

/** @param {string} mode @param {(key: string) => string} t */
function embedModeLabel(mode, t) {
  switch (mode) {
    case "none":
      return t("settings.usage.embedModeNone");
    case "bootstrap":
      return t("settings.usage.embedModeBootstrap");
    case "incremental":
      return t("settings.usage.embedModeIncremental");
    case "full":
      return t("settings.usage.embedModeFull");
    default:
      return mode || t("settings.usage.breakdownNone");
  }
}

/**
 * @param {{ breakdown: unknown; inputTokens: number; t: (key: string, vars?: Record<string, unknown>) => string }} props
 */
function UsageBreakdownPanel({ breakdown, inputTokens, t }) {
  if (!hasUsageBreakdown(breakdown)) {
    return (
      <p className="text-[0.8125rem] text-[var(--os-text-muted)]">{t("settings.usage.breakdownNone")}</p>
    );
  }
  const b = /** @type {Record<string, unknown>} */ (breakdown);
  const num = (key) => {
    const n = Number(b[key]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const billed = Math.max(0, inputTokens);
  const userVal = num("estUserTokens");
  const sysVal = num("estSystemTokens");
  const histVal = num("estHistoryTokens");
  const studioSum = userVal + sysVal + histVal;
  const gatewayVal =
    num("estGatewayOverheadTokens") > 0
      ? num("estGatewayOverheadTokens")
      : Math.max(0, billed - Math.min(studioSum, billed));

  const billedRows = [
    { label: t("settings.usage.breakdownUser"), value: userVal, est: true },
    { label: t("settings.usage.breakdownSystem"), value: sysVal, est: true },
    { label: t("settings.usage.breakdownHistory"), value: histVal, est: true },
    { label: t("settings.usage.breakdownGateway"), value: gatewayVal, est: false },
  ].filter((r) => r.value > 0);

  const cacheRead = num("cacheReadTokens");
  const cacheWrite = num("cacheWriteTokens");
  const maxBar = Math.max(billed, 1);

  return (
    <div className="space-y-3">
      <p className="text-[0.75rem] leading-relaxed text-[var(--os-text-faint)]">
        {t("settings.usage.breakdownHint")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {num("llmCallCount") > 0 ? (
          <div className="rounded-lg bg-[color-mix(in_srgb,var(--os-bg-subtle)_80%,transparent)] px-3 py-2">
            <p className="text-[0.72rem] text-[var(--os-text-faint)]">{t("settings.usage.breakdownLlmCalls")}</p>
            <p className="text-[0.9375rem] font-semibold tabular-nums text-[var(--os-text)]">
              {num("llmCallCount")}
              {num("llmCallCount") > 1 && billed > 0
                ? ` · ~${formatTokenCount(Math.round(billed / num("llmCallCount")))}/${t("settings.usage.breakdownPerCall")}`
                : ""}
            </p>
          </div>
        ) : null}
        {num("toolCallCount") > 0 ? (
          <div className="rounded-lg bg-[color-mix(in_srgb,var(--os-bg-subtle)_80%,transparent)] px-3 py-2">
            <p className="text-[0.72rem] text-[var(--os-text-faint)]">{t("settings.usage.breakdownToolCalls")}</p>
            <p className="text-[0.9375rem] font-semibold tabular-nums text-[var(--os-text)]">
              {num("toolCallCount")}
            </p>
          </div>
        ) : null}
        {typeof b.contextEmbedMode === "string" && b.contextEmbedMode ? (
          <div className="rounded-lg bg-[color-mix(in_srgb,var(--os-bg-subtle)_80%,transparent)] px-3 py-2">
            <p className="text-[0.72rem] text-[var(--os-text-faint)]">{t("settings.usage.breakdownEmbedMode")}</p>
            <p className="text-[0.875rem] font-medium text-[var(--os-text)]">
              {embedModeLabel(String(b.contextEmbedMode), t)}
              {num("priorTurnCount") > 0
                ? ` · ${t("settings.usage.breakdownPriorTurns")} ${num("priorTurnCount")}`
                : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--os-text-faint)]">
          {t("settings.usage.breakdownBilledTitle")} · {formatTokenCount(billed)}
        </p>
        <ul className="space-y-2">
          {billedRows.map((row) => (
            <li key={row.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[0.8125rem]">
                <span className="text-[var(--os-text-muted)]">
                  {row.label}
                  {row.est ? " ~" : ""}
                </span>
                <span className="shrink-0 tabular-nums font-medium text-[var(--os-text)]">
                  {formatTokenCount(row.value)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--os-bg-subtle)_90%,transparent)]">
                <div
                  className="h-full rounded-full bg-[color-mix(in_srgb,var(--os-accent,_#6366f1)_72%,transparent)]"
                  style={{ width: `${Math.min(100, Math.round((row.value / maxBar) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {cacheRead > 0 || cacheWrite > 0 ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--os-border)_65%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-subtle)_50%,transparent)] px-3 py-2.5">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--os-text-faint)]">
            {t("settings.usage.breakdownCacheTitle")}
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--os-text-muted)]">
            {t("settings.usage.breakdownCacheHint")}
          </p>
          <ul className="mt-2 space-y-1 text-[0.8125rem] tabular-nums text-[var(--os-text)]">
            {cacheRead > 0 ? (
              <li className="flex justify-between gap-2">
                <span className="text-[var(--os-text-muted)]">{t("settings.usage.breakdownCacheRead")}</span>
                <span>{formatTokenCount(cacheRead)}</span>
              </li>
            ) : null}
            {cacheWrite > 0 ? (
              <li className="flex justify-between gap-2">
                <span className="text-[var(--os-text-muted)]">{t("settings.usage.breakdownCacheWrite")}</span>
                <span>{formatTokenCount(cacheWrite)}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
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
  const [expandedRecordId, setExpandedRecordId] = useState("");

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
        <Button
          type="button"
          onClick={() => void onReset()}
          className="rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium text-[var(--os-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_88%,transparent)] hover:text-[var(--os-text)]"
        >
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
            <Button
              type="button"
              onClick={() => setSelectedConversationId("")}
              className="rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
            >
              {t("settings.usage.clearFilter")}
            </Button>
          ) : null}
        </div>

        <div className="max-h-[320px] overflow-y-auto overscroll-contain">
          {records.length === 0 ? (
            <p className="px-4 py-10 text-center text-[0.875rem] text-[var(--os-text-muted)] sm:px-5">
              {t("settings.usage.noRecords")}
            </p>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-left text-[0.8125rem]">
              <thead className="sticky top-0 z-[1] bg-[color-mix(in_srgb,var(--os-bg-elevated)_98%,var(--os-bg-subtle))]">
                <tr className="text-[var(--os-text-faint)]">
                  <th className="px-4 py-2.5 font-medium sm:px-5">{t("settings.usage.colContent")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("settings.usage.colModel")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">{t("settings.usage.input")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">{t("settings.usage.output")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">{t("settings.usage.total")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("settings.usage.colBreakdown")}</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">{t("settings.usage.colTime")}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => {
                  const r = /** @type {Record<string, unknown>} */ (row);
                  const recordId = String(r.id ?? r.streamId ?? "");
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
                  const inputTokens = Number(r.inputTokens) || 0;
                  const breakdown = r.usageBreakdown;
                  const breakdownAvailable = hasUsageBreakdown(breakdown);
                  const expanded = expandedRecordId === recordId;
                  const b = breakdown && typeof breakdown === "object" ? /** @type {Record<string, unknown>} */ (breakdown) : {};
                  const callHint =
                    Number(b.llmCallCount) > 1
                      ? `${b.llmCallCount}×LLM`
                      : Number(b.toolCallCount) > 0
                        ? `${b.toolCallCount}×Tool`
                        : "";
                  return (
                    <Fragment key={recordId || preview}>
                      <tr
                        className="border-t border-[color-mix(in_srgb,var(--os-border)_60%,transparent)] hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_70%,transparent)]"
                      >
                        <td className="max-w-[14rem] px-4 py-3 sm:px-5">
                          <Button
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
                          </Button>
                        </td>
                        <td className="max-w-[8rem] truncate px-3 py-3 text-[var(--os-text-muted)]" title={model}>
                          {model}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                          {formatTokenCount(inputTokens)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                          {formatTokenCount(Number(r.outputTokens) || 0)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium text-[var(--os-text)]">
                          {formatTokenCount(Number(r.totalTokens) || 0)}
                        </td>
                        <td className="px-3 py-3">
                          {breakdownAvailable ? (
                            <Button
                              type="button"
                              onClick={() =>
                                setExpandedRecordId(expanded ? "" : recordId)
                              }
                              className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-[var(--os-accent,_#6366f1)] hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_80%,transparent)]"
                              aria-expanded={expanded}
                            >
                              {callHint || (expanded ? t("settings.usage.breakdownCollapse") : t("settings.usage.breakdownExpand"))}
                            </Button>
                          ) : (
                            <span className="text-[var(--os-text-faint)]">{t("settings.usage.breakdownNone")}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--os-text-faint)] sm:px-5">
                          {formatUsageTimestamp(Number(r.timestamp) || 0)}
                        </td>
                      </tr>
                      {expanded && breakdownAvailable ? (
                        <tr
                          key={`${recordId}-breakdown`}
                          className="border-t border-[color-mix(in_srgb,var(--os-border)_40%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-subtle)_55%,transparent)]"
                        >
                          <td colSpan={7} className="px-4 py-4 sm:px-5">
                            <p className="mb-2 text-[0.8125rem] font-semibold text-[var(--os-text)]">
                              {t("settings.usage.breakdownTitle")}
                            </p>
                            <UsageBreakdownPanel breakdown={breakdown} inputTokens={inputTokens} t={t} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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
