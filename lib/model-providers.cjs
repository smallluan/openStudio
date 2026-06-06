/**
 * Shared model provider ids and OpenClaw-aligned default base URLs.
 * Keep in sync with `MODEL_PROVIDER_IDS` in src/context/ModelSettingsContext.jsx.
 */

const KNOWN_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "minimax",
  "moonshot",
  "qwen",
  "openai-compatible",
];

/** Providers routed through OpenAI Chat Completions streaming in llm-chat-stream.cjs */
const OPENAI_LIKE_PROVIDER_IDS = new Set([
  "openai",
  "openai-compatible",
  "deepseek",
  "minimax",
  "moonshot",
  "qwen",
]);

/** MiniMax keys are region-specific: intl keys → api.minimax.io, CN keys → api.minimaxi.com */
const MINIMAX_REGIONS = {
  intl: {
    baseUrl: "https://api.minimax.io/anthropic",
    streamBaseUrl: "https://api.minimax.io/v1",
  },
  cn: {
    baseUrl: "https://api.minimaxi.com/anthropic",
    streamBaseUrl: "https://api.minimaxi.com/v1",
  },
};

/**
 * Direct HTTP streaming roots (Studio title synthesis, etc.).
 * These use `/chat/completions` appended by llm-chat-stream.cjs.
 */
const LLM_STREAM_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  minimax: MINIMAX_REGIONS.intl.streamBaseUrl,
  moonshot: "https://api.moonshot.ai/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

/**
 * OpenClaw gateway `models.providers[<id>]` blocks — must match bundled plugin catalogs.
 * When Studio writes a partial override, missing `api` breaks agent runs.
 */
const GATEWAY_PROVIDER_CATALOG = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
  },
  minimax: {
    baseUrl: MINIMAX_REGIONS.intl.baseUrl,
    api: "anthropic-messages",
    authHeader: true,
  },
  moonshot: {
    baseUrl: "https://api.moonshot.ai/v1",
    api: "openai-completions",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
  },
};

const GATEWAY_CATALOG_PROVIDER_IDS = new Set(Object.keys(GATEWAY_PROVIDER_CATALOG));

/** @param {string | undefined | null} u */
function trimTrailingSlash(u) {
  if (typeof u !== "string") return "";
  return u.replace(/\/+$/, "");
}

/**
 * @param {string} modelId
 * @returns {string}
 */
function inferProviderFromModelId(modelId) {
  const id = String(modelId ?? "").trim();
  if (!id) return "";
  const lc = id.toLowerCase();
  if (lc.startsWith("minimax-") || lc.startsWith("minimax/")) return "minimax";
  if (lc.startsWith("kimi-")) return "moonshot";
  if (lc.startsWith("qwen") || lc.startsWith("qwen3")) return "qwen";
  if (lc.startsWith("deepseek")) return "deepseek";
  return "";
}

/**
 * @param {string} provider
 * @param {string} [userBaseUrl]
 * @returns {string}
 */
function resolveProviderBaseUrl(provider, userBaseUrl = "", profile) {
  const custom = trimTrailingSlash(userBaseUrl);
  if (provider === "openai-compatible") return custom;
  if (custom) return custom;
  if (provider === "minimax") {
    const region = resolveMinimaxRegion(profile);
    return trimTrailingSlash(MINIMAX_REGIONS[region].streamBaseUrl);
  }
  return trimTrailingSlash(LLM_STREAM_BASE_URLS[provider] || "");
}

/** @param {unknown} region */
function normalizeMinimaxRegion(region) {
  const r = String(region ?? "").trim().toLowerCase();
  if (r === "cn" || r === "china" || r === "domestic") return "cn";
  if (r === "intl" || r === "international" || r === "global") return "intl";
  return "";
}

/**
 * @param {{ minimaxRegion?: string }} [profile]
 * @returns {"cn" | "intl"}
 */
function resolveMinimaxRegion(profile) {
  const fromProfile = normalizeMinimaxRegion(profile?.minimaxRegion);
  if (fromProfile) return fromProfile;
  try {
    const locale = String(process.env.LANG || process.env.LC_ALL || "").toLowerCase();
    if (locale.startsWith("zh")) return "cn";
  } catch {
    /* ignore */
  }
  return "intl";
}

/**
 * @param {string} provider
 * @param {{ minimaxRegion?: string }} [opts]
 * @returns {typeof GATEWAY_PROVIDER_CATALOG[string] | null}
 */
function getGatewayProviderCatalog(provider, opts) {
  const id = String(provider || "").trim();
  const base = GATEWAY_PROVIDER_CATALOG[id];
  if (!base) return null;
  if (id === "minimax") {
    const region = resolveMinimaxRegion(opts);
    const urls = MINIMAX_REGIONS[region];
    return {
      ...base,
      baseUrl: urls.baseUrl,
    };
  }
  return { ...base };
}

/**
 * @param {string} provider Studio profile provider id
 * @param {{ minimaxRegion?: string }} [profile]
 * @returns {{ openClawProvider: string; profileKey: string; gatewayCatalog?: typeof GATEWAY_PROVIDER_CATALOG[string] } | null}
 */
function mapNativeProviderToOpenClaw(provider, profile) {
  const id = String(provider || "").trim();
  if (!id || id === "openai-compatible" || !KNOWN_PROVIDER_IDS.includes(id)) return null;
  const openClawProvider = id;
  const profileKey = `${openClawProvider}:default`;
  const gatewayCatalog = getGatewayProviderCatalog(id, profile);
  if (gatewayCatalog) {
    return { openClawProvider, profileKey, gatewayCatalog };
  }
  return { openClawProvider, profileKey };
}

/**
 * @param {Record<string, unknown>} block
 * @param {typeof GATEWAY_PROVIDER_CATALOG[string]} catalogMeta
 * @returns {boolean}
 */
function applyGatewayProviderCatalog(block, catalogMeta) {
  if (!catalogMeta || !block || typeof block !== "object") return false;
  let changed = false;
  for (const [key, value] of Object.entries(catalogMeta)) {
    if (block[key] !== value) {
      block[key] = value;
      changed = true;
    }
  }
  return changed;
}

module.exports = {
  KNOWN_PROVIDER_IDS,
  OPENAI_LIKE_PROVIDER_IDS,
  LLM_STREAM_BASE_URLS,
  MINIMAX_REGIONS,
  GATEWAY_PROVIDER_CATALOG,
  GATEWAY_CATALOG_PROVIDER_IDS,
  trimTrailingSlash,
  inferProviderFromModelId,
  normalizeMinimaxRegion,
  resolveMinimaxRegion,
  resolveProviderBaseUrl,
  getGatewayProviderCatalog,
  mapNativeProviderToOpenClaw,
  applyGatewayProviderCatalog,
};
