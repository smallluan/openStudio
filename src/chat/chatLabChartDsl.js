/** @typedef {"light" | "dark"} ChatLabDocTheme */

import { getChatLabEchartsTheme } from "./chatLabEchartsTheme.js";
import { validateBuiltInMapSupport } from "./chatLabEchartsMaps.js";

/** @typedef {{ ok: true; option: Record<string, unknown> }} ChartParseOk */
/** @typedef {{ ok: false; error: string; pending?: boolean }} ChartParseErr */

const CHART_TYPES = new Set(["bar", "line", "pie", "scatter"]);

/**
 * @param {string} raw
 */
function normalizeChartType(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (CHART_TYPES.has(s)) return s;
  if (/\bpie\b/.test(s)) return "pie";
  if (/\bline\b/.test(s)) return "line";
  if (/\bscatter\b/.test(s)) return "scatter";
  if (/\bbar\b/.test(s)) return "bar";
  return "bar";
}

/**
 * @param {string} raw
 */
function parseScalar(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("[") || s.startsWith("{") || s.startsWith('"') || /^-?\d/.test(s)) {
    try {
      return JSON.parse(s);
    } catch {
      if (s.startsWith("[") && s.endsWith("]")) {
        const inner = s.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(",").map((item) => {
          const t = item.trim();
          if (
            (t.startsWith('"') && t.endsWith('"'))
            || (t.startsWith("'") && t.endsWith("'"))
          ) {
            return t.slice(1, -1);
          }
          const num = Number(t);
          return Number.isFinite(num) && String(num) === t ? num : t;
        });
      }
    }
  }
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * @param {string} line
 */
function isListItemLine(line) {
  return /^\s*-\s+/.test(String(line ?? ""));
}

/**
 * @param {string} line
 * @param {{ allowIndented?: boolean }} [opts]
 */
function isTopLevelKeyLine(line, opts = {}) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed.startsWith("#") || isListItemLine(line)) return false;
  if (!opts.allowIndented && /^\s/.test(String(line ?? ""))) return false;
  return /^[\w-]+\s*:/.test(trimmed);
}

/**
 * @param {string} line
 * @returns {{ key: string; valPart: string } | null}
 */
function parseKeyValueLine(line) {
  const trimmed = String(line ?? "").trim();
  const m = /^([\w-]+)\s*:\s*(.*)$/.exec(trimmed);
  if (!m) return null;
  return { key: m[1], valPart: m[2].trim() };
}

/**
 * @param {string[]} lines
 * @param {number} startIdx
 * @returns {{ items: Record<string, unknown>[]; nextIdx: number }}
 */
function parseSeriesList(lines, startIdx) {
  /** @type {Record<string, unknown>[]} */
  const items = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = String(line ?? "").trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (isTopLevelKeyLine(line)) break;

    const itemMatch = /^\s*-\s+(.+)$/.exec(line);
    if (!itemMatch) break;

    /** @type {Record<string, unknown>} */
    const item = {};
    const firstKv = parseKeyValueLine(itemMatch[1]);
    if (firstKv) {
      item[firstKv.key] = parseScalar(firstKv.valPart);
    } else {
      item.value = parseScalar(itemMatch[1]);
    }
    i++;

    while (i < lines.length) {
      const sub = lines[i];
      if (!String(sub ?? "").trim()) {
        i++;
        continue;
      }
      if (isListItemLine(sub)) break;
      if (isTopLevelKeyLine(sub)) break;
      const subKv = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(String(sub).trim());
      if (!subKv) break;
      item[subKv[1]] = parseScalar(subKv[2]);
      i++;
    }

    items.push(item);
  }

  return { items, nextIdx: i };
}

/**
 * @param {string} source
 * @returns {{ ok: true; spec: Record<string, unknown> } | ChartParseErr}
 */
export function parseChartDsl(source) {
  const trimmedSource = String(source ?? "").trim();
  if (trimmedSource.startsWith("{")) {
    const json = parseEchartsJson(trimmedSource);
    if (json.ok) {
      return { ok: true, spec: { __echartsOption: json.option } };
    }
    return json;
  }

  const lines = String(source ?? "").split(/\r?\n/);
  /** @type {Record<string, unknown>} */
  const spec = {};
  let i = 0;

  while (i < lines.length) {
    const trimmed = String(lines[i] ?? "").trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const typeWord = /^type\s+(bar|line|pie|scatter)\b/i.exec(trimmed);
    if (typeWord) {
      spec.type = typeWord[1].toLowerCase();
      i++;
      continue;
    }

    if (/^type\s*$/i.test(trimmed)) {
      i++;
      while (i < lines.length && !String(lines[i] ?? "").trim()) i++;
      if (i >= lines.length) {
        return { ok: false, error: "Missing chart type after `type` line (use `type: bar`)" };
      }
      spec.type = normalizeChartType(lines[i]);
      i++;
      continue;
    }

    const topKv = parseKeyValueLine(trimmed);
    if (!topKv) {
      return {
        ok: false,
        error: `Invalid chart line: ${trimmed} (use \`type: bar\`, not a lone \`type\` line)`,
      };
    }

    const { key, valPart } = topKv;

    if (key === "type") {
      spec.type = normalizeChartType(valPart || "bar");
      i++;
      continue;
    }

    if (valPart === "" && (key === "series" || key === "data")) {
      i++;
      const { items, nextIdx } = parseSeriesList(lines, i);
      spec[key] = items;
      i = nextIdx;
      continue;
    }

    spec[key] = parseScalar(valPart);
    i++;
  }

  if (!spec.type) spec.type = "bar";
  return { ok: true, spec };
}

/**
 * @param {string} text
 */
function looksLikeIncompleteJson(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (!t.startsWith("{") && !t.startsWith("[")) return false;

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (let idx = 0; idx < t.length; idx++) {
    const ch = t[idx];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }

  return inString || braces > 0 || brackets > 0;
}

/**
 * @param {string} source
 * @returns {ChartParseOk | ChartParseErr}
 */
export function parseEchartsJson(source) {
  const text = String(source ?? "").trim();
  if (!text) {
    return { ok: false, error: "Empty chart option", pending: true };
  }
  if (looksLikeIncompleteJson(text)) {
    return { ok: false, error: "Chart JSON is still loading…", pending: true };
  }
  try {
    const option = JSON.parse(text);
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return { ok: false, error: "ECharts option must be a JSON object" };
    }
    return { ok: true, option: /** @type {Record<string, unknown>} */ (option) };
  } catch (err) {
    const message = String(err?.message ?? err ?? "Invalid JSON");
    if (/unexpected end of json input|unterminated string/i.test(message)) {
      return { ok: false, error: "Chart JSON is incomplete or truncated", pending: true };
    }
    return { ok: false, error: message };
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * @param {unknown} data
 * @param {unknown[] | undefined} xValues
 * @returns {unknown[]}
 */
function normalizeScatterSeriesData(data, xValues) {
  if (!Array.isArray(data) || !data.length) return [];

  if (
    data.every((item) => Array.isArray(item) && item.length >= 2)
    || data.every((item) => item && typeof item === "object" && Array.isArray(/** @type {{ value?: unknown[] }} */ (item).value))
  ) {
    return data;
  }

  if (Array.isArray(xValues) && xValues.length) {
    return xValues.map((xVal, idx) => {
      const y = asFiniteNumber(data[idx]) ?? 0;
      const xNum = asFiniteNumber(xVal);
      return [xNum ?? idx, y];
    });
  }

  return data.map((yVal, idx) => [idx, asFiniteNumber(yVal) ?? 0]);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function asObjectArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

/**
 * @param {Record<string, unknown>} spec
 * @param {ChatLabDocTheme} theme
 */
export function chartSpecToEchartsOption(spec, theme) {
  if (spec.__echartsOption && typeof spec.__echartsOption === "object") {
    return mergeThemeIntoEchartsOption(
      /** @type {Record<string, unknown>} */ (spec.__echartsOption),
      theme,
    );
  }

  const type = normalizeChartType(spec.type);
  const themePack = getChatLabEchartsTheme(theme);
  const titleText = spec.title != null && String(spec.title).trim()
    ? String(spec.title).trim()
    : "";
  const title = titleText
    ? { text: titleText, left: "center", top: 6 }
    : undefined;

  if (type === "pie") {
    /** @type {{ name: string; value: number }[]} */
    let pieData = [];
    const dataItems = asObjectArray(spec.data);
    if (dataItems.length) {
      pieData = dataItems.map((item) => ({
        name: String(item.name ?? item.label ?? ""),
        value: Number(item.value ?? item.y ?? 0),
      }));
    } else if (Array.isArray(spec.labels) && Array.isArray(spec.values)) {
      pieData = spec.labels.map((label, idx) => ({
        name: String(label),
        value: Number(spec.values[idx] ?? 0),
      }));
    } else {
      const categories = Array.isArray(spec.x) ? spec.x : [];
      const series = asObjectArray(spec.series);
      const first = series[0];
      const values = Array.isArray(first?.data) ? first.data : [];
      pieData = categories.map((label, idx) => ({
        name: String(label),
        value: Number(values[idx] ?? 0),
      }));
    }

    return {
      ...themePack.base,
      title,
      tooltip: { trigger: "item" },
      legend: pieData.length > 1 ? { top: title ? 28 : 8, type: "scroll" } : undefined,
      series: [
        {
          type: "pie",
          radius: ["36%", "62%"],
          center: ["50%", title ? "56%" : "52%"],
          data: pieData,
          emphasis: {
            itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.12)" },
          },
        },
      ],
    };
  }

  const categories = Array.isArray(spec.x) ? spec.x.map(String) : [];
  let seriesArr = asObjectArray(spec.series);
  if (!seriesArr.length && Array.isArray(spec.values)) {
    seriesArr = [{ name: "", data: spec.values }];
  }
  if (
    type === "scatter"
    && !seriesArr.length
    && Array.isArray(spec.x)
    && Array.isArray(spec.y)
  ) {
    seriesArr = [{ name: "", data: normalizeScatterSeriesData(spec.y, spec.x) }];
  }

  const echartsType = type === "line" || type === "scatter" ? type : "bar";
  const xValues = Array.isArray(spec.x) ? spec.x : undefined;
  const echartsSeries = seriesArr.map((entry) => {
    const rawData = Array.isArray(entry.data) ? entry.data : [];
    const data = echartsType === "scatter"
      ? normalizeScatterSeriesData(rawData, xValues)
      : rawData;
    return {
      name: String(entry.name ?? ""),
      type: echartsType,
      data,
      ...(echartsType === "line" ? { smooth: true } : {}),
    };
  });

  const hasLegend = echartsSeries.some((s) => String(s.name).trim());
  const gridTop = titleText
    ? (hasLegend ? 72 : 52)
    : (hasLegend ? 36 : 28);

  return {
    ...themePack.base,
    title,
    tooltip: { trigger: echartsType === "scatter" ? "item" : "axis" },
    legend: hasLegend
      ? { top: titleText ? 34 : 8, left: "center", type: "scroll" }
      : undefined,
    grid: {
      left: "3%",
      right: "4%",
      bottom: 16,
      top: gridTop,
      containLabel: true,
    },
    xAxis: {
      type: echartsType === "scatter" ? "value" : "category",
      data: echartsType === "scatter" ? undefined : categories,
      boundaryGap: echartsType === "bar",
    },
    yAxis: {
      type: "value",
      name: spec.y != null && String(spec.y).trim() ? String(spec.y) : undefined,
    },
    series: echartsSeries,
  };
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
 * @returns {ChartParseOk | ChartParseErr}
 */
export function resolveChartFenceOption(code, label, theme) {
  const lang = String(label ?? "").trim().toLowerCase();
  if (lang === "echarts") {
    const parsed = parseEchartsJson(code);
    if (!parsed.ok) return parsed;
    const mapErr = validateBuiltInMapSupport(parsed.option);
    if (mapErr) return { ok: false, error: mapErr };
    return { ok: true, option: mergeThemeIntoEchartsOption(parsed.option, theme) };
  }
  if (lang === "chart") {
    const parsed = parseChartDsl(code);
    if (!parsed.ok) return parsed;
    const option = chartSpecToEchartsOption(parsed.spec, theme);
    const mapErr = validateBuiltInMapSupport(option);
    if (mapErr) return { ok: false, error: mapErr };
    return { ok: true, option };
  }
  return { ok: false, error: `Unsupported chart fence: ${label}` };
}
