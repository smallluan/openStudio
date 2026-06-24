/** @typedef {import('echarts/core').EChartsType} EChartsCore */

/** Already registered by chatLabEchartsRuntime.js */
/** @type {Set<string>} */
const REGISTERED = new Set(["bar", "line", "pie", "scatter", "map"]);

/** @type {Record<string, string>} */
const SERIES_TYPE_ALIASES = {
  themeriver: "themeriver",
  "theme-river": "themeriver",
  k: "candlestick",
  candlestick: "candlestick",
  heatmap: "heatmap",
  sankey: "sankey",
  tree: "tree",
  treemap: "treemap",
  sunburst: "sunburst",
  graph: "graph",
  lines: "lines",
  parallel: "parallel",
  radar: "radar",
  gauge: "gauge",
  funnel: "funnel",
  boxplot: "boxplot",
  effectscatter: "effectscatter",
  pictorialbar: "pictorialbar",
  custom: "custom",
  chord: "chord",
};

/** @type {Record<string, () => Promise<unknown[]>>} */
const EXTRA_CHART_LOADERS = {
  radar: async () => {
    const [{ RadarChart }, { RadarComponent }] = await Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
    ]);
    return [RadarChart, RadarComponent];
  },
  gauge: async () => {
    const [{ GaugeChart }] = await Promise.all([import("echarts/charts")]);
    return [GaugeChart];
  },
  funnel: async () => {
    const [{ FunnelChart }] = await Promise.all([import("echarts/charts")]);
    return [FunnelChart];
  },
  heatmap: async () => {
    const [{ HeatmapChart }, { CalendarComponent }] = await Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
    ]);
    return [HeatmapChart, CalendarComponent];
  },
  candlestick: async () => {
    const [{ CandlestickChart }, { DataZoomComponent }] = await Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
    ]);
    return [CandlestickChart, DataZoomComponent];
  },
  boxplot: async () => {
    const [{ BoxplotChart }] = await Promise.all([import("echarts/charts")]);
    return [BoxplotChart];
  },
  themeriver: async () => {
    const [{ ThemeRiverChart }, { SingleAxisComponent }] = await Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
    ]);
    return [ThemeRiverChart, SingleAxisComponent];
  },
  sankey: async () => {
    const [{ SankeyChart }] = await Promise.all([import("echarts/charts")]);
    return [SankeyChart];
  },
  tree: async () => {
    const [{ TreeChart }] = await Promise.all([import("echarts/charts")]);
    return [TreeChart];
  },
  treemap: async () => {
    const [{ TreemapChart }] = await Promise.all([import("echarts/charts")]);
    return [TreemapChart];
  },
  sunburst: async () => {
    const [{ SunburstChart }] = await Promise.all([import("echarts/charts")]);
    return [SunburstChart];
  },
  graph: async () => {
    const [{ GraphChart }] = await Promise.all([import("echarts/charts")]);
    return [GraphChart];
  },
  lines: async () => {
    const [{ LinesChart }] = await Promise.all([import("echarts/charts")]);
    return [LinesChart];
  },
  parallel: async () => {
    const [{ ParallelChart }, { ParallelComponent }] = await Promise.all([
      import("echarts/charts"),
      import("echarts/components"),
    ]);
    return [ParallelChart, ParallelComponent];
  },
  effectscatter: async () => {
    const [{ EffectScatterChart }] = await Promise.all([import("echarts/charts")]);
    return [EffectScatterChart];
  },
  pictorialbar: async () => {
    const [{ PictorialBarChart }] = await Promise.all([import("echarts/charts")]);
    return [PictorialBarChart];
  },
  custom: async () => {
    const [{ CustomChart }] = await Promise.all([import("echarts/charts")]);
    return [CustomChart];
  },
  chord: async () => {
    const [{ ChordChart }] = await Promise.all([import("echarts/charts")]);
    return [ChordChart];
  },
};

/**
 * @param {string} raw
 */
function normalizeSeriesType(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "";
  return SERIES_TYPE_ALIASES[key] ?? key;
}

/**
 * @param {unknown} block
 * @param {Set<string>} types
 */
function collectSeriesTypesFromOptionBlock(block, types) {
  if (!block || typeof block !== "object") return;

  const series = /** @type {{ series?: unknown }} */ (block).series;
  if (!Array.isArray(series)) return;

  for (const entry of series) {
    if (!entry || typeof entry !== "object") continue;
    const type = normalizeSeriesType(/** @type {{ type?: unknown }} */ (entry).type);
    if (type) types.add(type);
  }
}

/**
 * @param {unknown} option
 * @returns {Set<string>}
 */
export function collectSeriesTypesFromOption(option) {
  /** @type {Set<string>} */
  const types = new Set();
  if (!option || typeof option !== "object") return types;

  collectSeriesTypesFromOptionBlock(option, types);

  const baseOption = /** @type {{ baseOption?: unknown }} */ (option).baseOption;
  if (baseOption && typeof baseOption === "object") {
    collectSeriesTypesFromOptionBlock(baseOption, types);
  }

  const options = /** @type {{ options?: unknown }} */ (option).options;
  if (Array.isArray(options)) {
    for (const sub of options) {
      collectSeriesTypesFromOptionBlock(sub, types);
    }
  }

  return types;
}

/**
 * Register tree-shaken ECharts chart/component modules required by `option`.
 * @param {EChartsCore} echarts
 * @param {Record<string, unknown>} option
 */
export async function ensureChartsRegistered(echarts, option) {
  const needed = collectSeriesTypesFromOption(option);
  /** @type {Promise<void>[]} */
  const tasks = [];

  for (const type of needed) {
    if (REGISTERED.has(type)) continue;
    const loader = EXTRA_CHART_LOADERS[type];
    if (!loader) continue;
    tasks.push(
      loader().then((modules) => {
        echarts.use(modules.filter(Boolean));
        REGISTERED.add(type);
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * @param {EChartsCore} echarts
 * @param {Record<string, unknown>} option
 * @returns {string[]}
 */
export function unsupportedSeriesTypes(option) {
  const needed = collectSeriesTypesFromOption(option);
  /** @type {string[]} */
  const missing = [];
  for (const type of needed) {
    if (REGISTERED.has(type) || EXTRA_CHART_LOADERS[type]) continue;
    missing.push(type);
  }
  return missing;
}
