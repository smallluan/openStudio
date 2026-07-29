/** @typedef {"light" | "dark"} ChatLabDocTheme */

import { getChatLabEchartsTheme, resolveChartBackgroundColor } from "./chatLabEchartsTheme.js";
import { validateBuiltInMapSupport } from "./chatLabEchartsMaps.js";
import { parseLenientEchartsJson, parseStreamingEchartsJson } from "./chatLabEchartsJson.js";
import { unsupportedSeriesTypes } from "./chatLabEchartsChartRegistry.js";
import { looksLikeMarkdownTableBlock } from "./chatLabMarkdownTableChart.js";
import { sanitizeChartFenceCode } from "./chatLabMarkdownChartFenceRepair.js";

/** @typedef {{ ok: true; option: Record<string, unknown>; partial?: boolean }} ChartParseOk */
/** @typedef {{ ok: false; error: string; pending?: boolean; markdownTable?: boolean }} ChartParseErr */

const ECHARTS_FENCE_LANGS = new Set(["chart", "echarts"]);

/**
 * @param {string} source
 * @returns {ChartParseOk | ChartParseErr}
 */
export function parseEchartsJson(source) {
  const parsed = parseLenientEchartsJson(source);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error || "Chart option could not be parsed",
    };
  }
  return { ok: true, option: parsed.value };
}

/**
 * @param {Record<string, unknown>} option
 * @param {ChatLabDocTheme} theme
 */
export function mergeThemeIntoEchartsOption(option, theme) {
  const themePack = getChatLabEchartsTheme(theme);
  return {
    ...themePack.base,
    ...option,
    backgroundColor: resolveChartBackgroundColor(option.backgroundColor),
    textStyle: {
      ...themePack.base.textStyle,
      ...(option.textStyle && typeof option.textStyle === "object"
        ? option.textStyle
        : {}),
    },
  };
}

/**
 * @param {string} code
 * @param {string} label
 * @param {ChatLabDocTheme} theme
 * @param {{ streaming?: boolean }} [opts]
 * @returns {ChartParseOk | ChartParseErr}
 */
export function resolveChartFenceOption(code, label, theme, opts = {}) {
  const streaming = Boolean(opts.streaming);
  const lang = String(label ?? "").trim().toLowerCase();
  if (!ECHARTS_FENCE_LANGS.has(lang)) {
    return { ok: false, error: `Unsupported chart fence: ${label}` };
  }

  const rawTrimmed = String(code ?? "").trim();
  const sanitized = sanitizeChartFenceCode(code);
  const trimmed = String(sanitized ?? "").trim();

  if (looksLikeMarkdownTableBlock(rawTrimmed) || looksLikeMarkdownTableBlock(trimmed)) {
    return {
      ok: false,
      error: "Chart block contains a markdown table",
      markdownTable: true,
    };
  }

  if (trimmed && !trimmed.startsWith("{")) {
    return {
      ok: false,
      error:
        "已不支持 chart 简写语法。请使用 ```echarts``` 代码块，并提供完整的 ECharts option 对象（以 `{` 开头）。",
    };
  }

  const parsed = streaming
    ? parseStreamingEchartsJson(trimmed, { streaming: true })
    : parseEchartsJson(trimmed);
  if (!parsed.ok) return parsed;

  const mapErr = validateBuiltInMapSupport(parsed.option);
  if (mapErr) {
    return streaming ? { ok: false, pending: true, error: mapErr } : { ok: false, error: mapErr };
  }
  const missingTypes = unsupportedSeriesTypes(parsed.option);
  if (missingTypes.length) {
    const err = `暂不支持的图表类型：${missingTypes.join("、")}`;
    return streaming ? { ok: false, pending: true, error: err } : { ok: false, error: err };
  }
  return {
    ok: true,
    option: mergeThemeIntoEchartsOption(parsed.option, theme),
    ...(parsed.partial ? { partial: true } : {}),
  };
}
