/** @typedef {import('echarts/core').EChartsType} EChartsCore */

/** @type {Set<string>} */
const CHINA_MAP_ALIASES = new Set([
  "china",
  "cn",
  "chn",
  "china-full",
  "中国",
]);

/** @type {Map<string, Promise<void>>} */
const REGISTERED = new Map();

/**
 * @param {string} name
 * @returns {"china" | null}
 */
export function normalizeBuiltInMapName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  if (CHINA_MAP_ALIASES.has(raw) || CHINA_MAP_ALIASES.has(raw.toLowerCase())) {
    return "china";
  }
  return null;
}

/**
 * @param {unknown} block
 * @returns {string[]}
 */
function mapNamesFromBlock(block) {
  if (!block || typeof block !== "object") return [];
  const rec = /** @type {Record<string, unknown>} */ (block);
  /** @type {string[]} */
  const names = [];
  if (typeof rec.map === "string" && rec.map.trim()) names.push(rec.map.trim());
  if (rec.type === "map" && typeof rec.mapType === "string" && rec.mapType.trim()) {
    names.push(rec.mapType.trim());
  }
  return names;
}

/**
 * @param {Record<string, unknown>} option
 * @returns {Set<string>}
 */
export function collectMapNamesFromOption(option) {
  /** @type {Set<string>} */
  const names = new Set();

  const geo = option.geo;
  if (Array.isArray(geo)) {
    for (const block of geo) {
      for (const name of mapNamesFromBlock(block)) names.add(name);
    }
  } else {
    for (const name of mapNamesFromBlock(geo)) names.add(name);
  }

  const series = option.series;
  if (Array.isArray(series)) {
    for (const block of series) {
      if (block && typeof block === "object") {
        const rec = /** @type {Record<string, unknown>} */ (block);
        if (rec.type === "map") {
          for (const name of mapNamesFromBlock(rec)) names.add(name);
        }
      }
    }
  }

  return names;
}

/**
 * @param {Record<string, unknown>} option
 * @returns {string | null}
 */
export function validateBuiltInMapSupport(option) {
  const names = collectMapNamesFromOption(option);
  if (!names.size) return null;

  for (const name of names) {
    if (!normalizeBuiltInMapName(name)) {
      return `暂不支持地图「${name}」，当前仅内置 china / 中国（省级边界）`;
    }
  }
  return null;
}

/**
 * @param {EChartsCore} echarts
 */
async function registerChinaMap(echarts) {
  if (REGISTERED.has("china")) return REGISTERED.get("china");

  const pending = import("../assets/geo/china-full.json").then((mod) => {
    const geoJSON = mod.default ?? mod;
    for (const alias of ["china", "China", "CN", "中国"]) {
      echarts.registerMap(alias, { geoJSON });
    }
  });

  REGISTERED.set("china", pending);
  return pending;
}

/**
 * @param {EChartsCore} echarts
 * @param {Record<string, unknown>} option
 */
export async function ensureBuiltInMapsRegistered(echarts, option) {
  const names = collectMapNamesFromOption(option);
  /** @type {Promise<void>[]} */
  const tasks = [];

  for (const name of names) {
    const builtIn = normalizeBuiltInMapName(name);
    if (builtIn === "china") {
      tasks.push(registerChinaMap(echarts));
    }
  }

  await Promise.all(tasks);
}
