/**
 * Push Open Studio's active model profile + API key into the OpenClaw gateway
 * workspace so the in-gateway agent (tools, desktop control, etc.) uses the
 * same provider/model as Settings → Model.
 *
 * Open Studio chat traffic always goes through `chat.send` on the gateway; the
 * gateway resolves credentials from its own `agents/<id>/agent/auth-profiles.json`
 * and model from `openclaw.json` agent entries — not from studio-user-config.json.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");

const {
  KNOWN_PROVIDER_IDS,
  getGatewayProviderCatalog,
  mapNativeProviderToOpenClaw,
  applyGatewayProviderCatalog,
  ensureGatewayModelRowDefaults,
  ensureGatewayProviderModelsDefaults,
  trimTrailingSlash,
} = require("./model-providers.cjs");

/**
 * Provider plugins are no longer force-enabled in `plugins.allow` by Studio.
 * Newer OpenClaw bundles can reject stale provider plugin public surfaces
 * (e.g. `openai/provider-policy-api.js`) even when model routing is valid.
 * We keep this list only to *remove* any previously persisted provider ids.
 */
const KNOWN_OPENCLAW_PROVIDER_PLUGINS = ["deepseek", "openai", "anthropic", "google"];

/**
 * Default bundled plugins seen on `openclaw --dev gateway` without an explicit
 * `plugins.allow` in openclaw.json. Studio keeps this complete list available so
 * the embedded agent can drive all supported desktop peripherals.
 */
const OPENCLAW_DEV_GATEWAY_BASE_ALLOWLIST = [
  "acpx",
  "bonjour",
  "browser",
  "device-pair",
  "file-transfer",
  "memory-core",
  "openclaw-weixin",
  "phone-control",
  "talk-voice",
];

const LEGACY_PLUGIN_ID_ALIASES = new Map([
  ["wechat", "openclaw-weixin"],
]);

/**
 * OpenClaw DeepSeek provider expects canonical IDs like `deepseek-v4-flash`.
 * Accept a few historical aliases from Studio profiles and normalize them.
 * @param {string} modelId
 */
function normalizeDeepSeekModelId(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw) return raw;
  const folded = raw.toLowerCase().replace(/[_\s]+/g, "-");
  if (folded === "deepseek-v4flash" || folded === "deepseek-v4-flash") return "deepseek-v4-flash";
  if (folded === "deepseek-v4pro" || folded === "deepseek-v4-pro") return "deepseek-v4-pro";
  return raw;
}

const {
  extractActiveProfile,
  resolveApiKeyForActiveProfile,
} = require("./model-profile-credentials.cjs");

/** Normalise agent ids the same way Open Studio session keys use them. */
function normalizeAgentId(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "main";
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "").slice(0, 64) || "main";
}

/**
 * `agent:dev:dev` → `dev`.
 * @param {string | undefined} sessionKey
 */
function parseAgentIdFromSessionKey(sessionKey) {
  const raw = String(sessionKey ?? "").trim();
  const m = /^agent:([^:]+):/i.exec(raw);
  return normalizeAgentId(m ? m[1] : "main");
}

/**
 * Dev gateway bundled with `npm run dev` listens on 19002 and uses ~/.openclaw-dev.
 * (Port changed from 19001 to 19002 to allow dev + packaged exe to run simultaneously.)
 * Anything else is assumed to follow the default OpenClaw state dir ~/.openclaw.
 * @param {string} gatewayBaseUrl
 */
function resolveOpenClawStateDir(gatewayBaseUrl) {
  try {
    const u = new URL(gatewayBaseUrl);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const loopback =
      u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
    if (loopback && port === "19002") {
      return path.join(os.homedir(), ".openclaw-dev");
    }
  } catch {
    /* fall through */
  }
  return path.join(os.homedir(), ".openclaw");
}

/** @param {string} stateDir */
function isOpenClawDevProfileStateDir(stateDir) {
  return path.basename(stateDir) === ".openclaw-dev";
}

/**
 * Fresh clones often start the dev gateway without a persisted shared token.
 * OpenClaw then rejects token-less loopback backend connects with
 * `device identity required`. Persist `gateway.auth.token` before `gateway run`
 * so Open Studio can auth as `gateway-client` / `backend` without pairing.
 *
 * @param {string} [stateDir]
 * @returns {{ ok: boolean; token?: string; created?: boolean; reason?: string }}
 */
function ensureDevGatewayAuthToken(stateDir = path.join(os.homedir(), ".openclaw-dev")) {
  if (!isOpenClawDevProfileStateDir(stateDir)) {
    return { ok: false, reason: "not_dev_profile" };
  }

  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (parsed && typeof parsed === "object") cfg = parsed;
  } catch {
    /* first run */
  }

  const gateway = /** @type {Record<string, unknown>} */ (cfg.gateway ?? (cfg.gateway = {}));
  const auth = /** @type {Record<string, unknown>} */ (gateway.auth ?? (gateway.auth = {}));
  const prevToken = typeof auth.token === "string" ? auth.token.trim() : "";
  let created = false;

  if (!prevToken) {
    auth.mode = "token";
    auth.token = randomUUID();
    created = true;
  } else if (auth.mode !== "token") {
    auth.mode = "token";
  }

  const changed = writeJsonIfChanged(cfgPath, cfg);
  const token = typeof auth.token === "string" ? auth.token : "";
  return { ok: true, token, created: created || changed };
}

function writeFileAtomic(filePath, body) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

function writeJsonIfChanged(filePath, obj) {
  const next = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    if (fs.readFileSync(filePath, "utf8") === next) return false;
  } catch {
    /* missing */
  }
  writeFileAtomic(filePath, next);
  return true;
}

/**
 * OpenClaw `chat.send` only passes image attachments as native multimodal input when
 * `resolveGatewayModelSupportsImages` is true. That checks the **gateway model catalog**
 * for an entry whose `input` array includes `"image"`. Custom or unknown model ids often
 * have no such entry, so OpenClaw offloads images to workspace files and the agent tries
 * to read them with tools (what users see as "can't see the image" / fake size limits).
 *
 * `cfg.models.providers[<provider>].models[]` is merged into the catalog; we upsert the
 * active Studio model with `input: ["text","image"]` so Chat Lab images use vision.
 * (If the provider API really does not accept images, the model call fails — which is
 * clearer than the file-workspace path.)
 *
 * @param {Record<string, unknown>} cfg parsed openclaw.json root
 * @param {string} modelRef e.g. `openai/gpt-4o-mini`
 * @returns {boolean} whether cfg was mutated
 */
/**
 * @param {Record<string, unknown>} row
 * @param {string} providerApi
 */
function ensureGatewayVisionModelRow(row, providerApi) {
  let changed = false;
  const curInput = Array.isArray(row.input) ? row.input.filter((x) => typeof x === "string") : [];
  if (!curInput.includes("image")) {
    row.input = [...new Set([...curInput, "text", "image"])];
    changed = true;
  }
  if (ensureGatewayModelRowDefaults(row, providerApi)) changed = true;
  return changed;
}

function ensureGatewayVisionCatalogEntry(cfg, modelRef, catalogMeta) {
  const raw = String(modelRef ?? "").trim();
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash >= raw.length - 1) return false;
  const provider = raw.slice(0, slash).trim().toLowerCase();
  const id = raw.slice(slash + 1).trim();
  if (!provider || !id) return false;

  if (!cfg.models || typeof cfg.models !== "object" || Array.isArray(cfg.models)) {
    cfg.models = {};
  }
  const modelsRoot = /** @type {Record<string, unknown>} */ (cfg.models);
  if (!modelsRoot.providers || typeof modelsRoot.providers !== "object" || Array.isArray(modelsRoot.providers)) {
    modelsRoot.providers = {};
  }
  const providers = /** @type {Record<string, unknown>} */ (modelsRoot.providers);
  /** @type {{ models?: unknown[] } & Record<string, unknown>} */
  let block = {};
  const prev = providers[provider];
  if (prev && typeof prev === "object" && !Array.isArray(prev)) {
    block = { ...prev };
  }

  const resolvedCatalog = catalogMeta ?? getGatewayProviderCatalog(provider);
  /** @type {boolean} */
  let changed = false;
  if (resolvedCatalog && applyGatewayProviderCatalog(block, resolvedCatalog)) {
    changed = true;
  }
  const providerApi = typeof block.api === "string" ? block.api : "";

  const rawModels = block.models;
  const arr = Array.isArray(rawModels) ? rawModels.map((m) => m) : [];
  const idLc = id.toLowerCase();

  /** @type {unknown[]} */
  const nextModels = [];
  let found = false;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      nextModels.push(entry);
      continue;
    }
    /** @type {Record<string, unknown>} */
    const row = { ...entry };
    const rid = typeof row.id === "string" ? row.id.trim() : "";
    if (!rid.toLowerCase() || rid.toLowerCase() !== idLc) {
      nextModels.push(row);
      continue;
    }
    found = true;
    if (ensureGatewayVisionModelRow(row, providerApi)) changed = true;
    nextModels.push(row);
  }

  if (!found) {
    /** @type {Record<string, unknown>} */
    const row = { id, name: id, input: ["text", "image"] };
    ensureGatewayVisionModelRow(row, providerApi);
    nextModels.push(row);
    changed = true;
  }

  block.models = nextModels;
  if (ensureGatewayProviderModelsDefaults(block)) changed = true;

  if (!changed) return false;
  providers[provider] = block;
  return true;
}

/**
 * OpenClaw also merges per-agent plugin catalogs under `agents/<id>/agent/plugins/`.
 * Keep them aligned with gateway provider defaults (notably anthropic-messages maxTokens).
 *
 * @param {string} agentAgentDir
 * @returns {boolean}
 */
function patchAllAgentPluginModelCatalogs(agentAgentDir) {
  const pluginsRoot = path.join(agentAgentDir, "plugins");
  let changed = false;
  /** @type {string[]} */
  let names = [];
  try {
    names = fs.readdirSync(pluginsRoot);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name || name === "." || name === "..") continue;
    if (patchAgentPluginModelCatalog(agentAgentDir, name)) changed = true;
  }
  return changed;
}

/**
 * @param {string} agentAgentDir
 * @param {string} providerPluginId
 * @returns {boolean}
 */
function patchAgentPluginModelCatalog(agentAgentDir, providerPluginId) {
  const catalogPath = path.join(agentAgentDir, "plugins", providerPluginId, "catalog.json");
  /** @type {Record<string, unknown>} */
  let catalog;
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    catalog = { ...parsed };
  } catch {
    return false;
  }

  const providers = catalog.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return false;

  let changed = false;
  /** @type {Record<string, unknown>} */
  const nextProviders = { ...providers };
  for (const [key, value] of Object.entries(nextProviders)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    /** @type {{ models?: unknown[] } & Record<string, unknown>} */
    const block = { ...value };
    if (ensureGatewayProviderModelsDefaults(block)) {
      nextProviders[key] = block;
      changed = true;
    }
  }

  if (!changed) return false;
  catalog.providers = nextProviders;
  return writeJsonIfChanged(catalogPath, catalog);
}

/**
 * Map Settings → Model profile to OpenClaw provider + model ref + auth profile id.
 * @param {{ provider: string; modelId: string; baseUrl: string; minimaxRegion?: string }} profile
 * @returns {{ openClawProvider: string; modelRef: string; profileKey: string; baseUrl?: string; warning?: string } | null}
 */
function mapStudioProfileToOpenClaw(profile) {
  const provider = String(profile.provider || "").trim();
  const modelIdRaw = String(profile.modelId || "").trim();
  const modelId =
    provider === "deepseek" || (provider === "openai-compatible" && String(profile.baseUrl || "").toLowerCase().includes("deepseek"))
      ? normalizeDeepSeekModelId(modelIdRaw)
      : modelIdRaw;
  const baseUrl = String(profile.baseUrl || "").trim().toLowerCase();

  if (!modelId || !KNOWN_PROVIDER_IDS.includes(provider)) return null;

  if (provider === "anthropic-compatible") {
    if (baseUrl.includes("minimax") || baseUrl.includes("minimaxi.com")) {
      const catalog = getGatewayProviderCatalog("minimax", {
        minimaxRegion: baseUrl.includes("minimaxi.com") ? "cn" : "intl",
      });
      return {
        openClawProvider: "minimax",
        modelRef: `minimax/${modelId}`,
        profileKey: "minimax:default",
        ...(catalog ? { gatewayCatalog: catalog } : {}),
      };
    }
    const customBaseUrl = trimTrailingSlash(String(profile.baseUrl || ""));
    return {
      openClawProvider: "anthropic",
      modelRef: `anthropic/${modelId}`,
      profileKey: "anthropic:default",
      ...(customBaseUrl ?
        {
          gatewayCatalog: {
            baseUrl: customBaseUrl,
            api: "anthropic-messages",
          },
        }
      : {}),
      ...(!customBaseUrl ?
        {
          warning:
            "anthropic_compatible_missing_base_url: set Base URL on the Anthropic-compatible profile.",
        }
      : {}),
    };
  }

  if (provider === "openai-compatible") {
    if (baseUrl.includes("deepseek")) {
      const catalog = getGatewayProviderCatalog("deepseek");
      return {
        openClawProvider: "deepseek",
        modelRef: `deepseek/${modelId}`,
        profileKey: "deepseek:default",
        ...(catalog ? { gatewayCatalog: catalog } : {}),
      };
    }
    if (baseUrl.includes("minimax") || baseUrl.includes("minimaxi.com")) {
      const catalog = getGatewayProviderCatalog("minimax", {
        minimaxRegion: baseUrl.includes("minimaxi.com") ? "cn" : "intl",
      });
      return {
        openClawProvider: "minimax",
        modelRef: `minimax/${modelId}`,
        profileKey: "minimax:default",
        ...(catalog ? { gatewayCatalog: catalog } : {}),
      };
    }
    if (baseUrl.includes("moonshot")) {
      const catalog = getGatewayProviderCatalog("moonshot");
      return {
        openClawProvider: "moonshot",
        modelRef: `moonshot/${modelId}`,
        profileKey: "moonshot:default",
        ...(catalog ? { gatewayCatalog: catalog } : {}),
      };
    }
    if (baseUrl.includes("dashscope") || baseUrl.includes("qwen")) {
      const catalog = getGatewayProviderCatalog("qwen");
      return {
        openClawProvider: "qwen",
        modelRef: `qwen/${modelId}`,
        profileKey: "qwen:default",
        ...(catalog ? { gatewayCatalog: catalog } : {}),
      };
    }
    return {
      openClawProvider: "openai",
      modelRef: `openai/${modelId}`,
      profileKey: "openai:default",
      warning:
        "openai_compatible_non_deepseek: ensure this model exists for OpenClaw's OpenAI provider or configure the gateway manually.",
    };
  }

  const mapped = mapNativeProviderToOpenClaw(provider, profile);
  if (mapped) {
    return {
      openClawProvider: mapped.openClawProvider,
      modelRef: `${mapped.openClawProvider}/${modelId}`,
      profileKey: mapped.profileKey,
      ...(mapped.gatewayCatalog ? { gatewayCatalog: mapped.gatewayCatalog } : {}),
    };
  }

  return null;
}

/**
 * Persist model + (for `.openclaw-dev`) provider plugin allowlist so the gateway
 * can resolve `provider/model` instead of falling back to openai/gpt-5.5.
 *
 * @param {string} stateDir
 * @param {string} agentId
 * @param {string} modelRef e.g. deepseek/deepseek-v4-flash
 * @param {string} providerPluginId bundled extension id, e.g. `deepseek`
 * @param {unknown} [studioCfg] full Studio user config
 * @param {typeof import("./model-providers.cjs").GATEWAY_PROVIDER_CATALOG[string] | undefined} [gatewayCatalog]
 */
function patchOpenClawGatewayStudioBinding(stateDir, agentId, modelRef, providerPluginId, studioCfg, gatewayCatalog) {
  const cfgPath = path.join(stateDir, "openclaw.json");
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return { ok: false, reason: "missing_or_invalid_openclaw_json" };
  }

  let changed = false;
  const devProfile = isOpenClawDevProfileStateDir(stateDir);

  cfg.agents ??= {};
  cfg.agents.defaults ??= {};
  const prevDefault = typeof cfg.agents.defaults.model === "string" ? cfg.agents.defaults.model.trim() : "";
  if (prevDefault !== modelRef) {
    cfg.agents.defaults.model = modelRef;
    changed = true;
  }

  const list = cfg.agents.list;
  if (!Array.isArray(list)) return { ok: false, reason: "no_agents_list", partial: changed };

  const idNorm = normalizeAgentId(agentId);
  let hit = false;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (normalizeAgentId(entry.id) !== idNorm) continue;
    hit = true;
    const prev = typeof entry.model === "string" ? entry.model.trim() : "";
    if (prev !== modelRef) {
      entry.model = modelRef;
      changed = true;
    }
    break;
  }

  if (!hit) return { ok: false, reason: "agent_not_found_in_openclaw_json", partial: changed };

  cfg.plugins ??= {};
  const cur = Array.isArray(cfg.plugins.allow) ? cfg.plugins.allow : null;

  let next = (cur ?? [])
    .filter((id) => typeof id === "string" && !KNOWN_OPENCLAW_PROVIDER_PLUGINS.includes(id))
    .map((id) => LEGACY_PLUGIN_ID_ALIASES.get(id) || id);
  if (devProfile) {
    next = [...new Set([...next, ...OPENCLAW_DEV_GATEWAY_BASE_ALLOWLIST])];
  }

  if (studioPrefersSidebarLinkOpen(studioCfg)) {
    next = next.filter((id) => id !== "browser");
  } else if (devProfile && !next.includes("browser")) {
    next = [...next, "browser"];
  }

  next.sort((a, b) => a.localeCompare(b));

  const same =
    Array.isArray(cur) &&
    cur.length === next.length &&
    cur.every((v, i) => v === next[i]);
  if (!same) {
    cfg.plugins.allow = next;
    changed = true;
  }

  if (patchOpenClawBrowserForStudioLinkOpenMode(studioCfg, cfg)) changed = true;

  if (ensureGatewayVisionCatalogEntry(cfg, modelRef, gatewayCatalog)) changed = true;

  // P1: defer full tool JSON schemas via OpenClaw tool search (tools stay registered).
  cfg.tools ??= {};
  const tools = /** @type {Record<string, unknown>} */ (cfg.tools);
  if (tools.toolSearch !== true) {
    tools.toolSearch = true;
    changed = true;
  }

  if (changed) writeJsonIfChanged(cfgPath, cfg);
  return { ok: true, changed };
}

/** @param {unknown} studioCfg */
function studioPrefersSidebarLinkOpen(studioCfg) {
  return (
    !studioCfg ||
    typeof studioCfg !== "object" ||
    /** @type {{ chatLabLinkOpenMode?: string }} */ (studioCfg).chatLabLinkOpenMode !== "external"
  );
}

/**
 * Sidebar link mode: disable bundled browser plugin (preview dock handles pages).
 * External mode: re-enable browser plugin + visible Chrome for agent automation.
 * @param {unknown} studioCfg
 * @param {Record<string, unknown>} cfg openclaw.json root (mutated in place)
 * @returns {boolean}
 */
function patchOpenClawBrowserForStudioLinkOpenMode(studioCfg, cfg) {
  let changed = false;
  const sidebar = studioPrefersSidebarLinkOpen(studioCfg);

  cfg.browser ??= {};
  const browser = /** @type {Record<string, unknown>} */ (cfg.browser);
  if (browser.headless !== sidebar) {
    browser.headless = sidebar;
    changed = true;
  }

  cfg.plugins ??= {};
  cfg.plugins.entries ??= {};
  const entries = /** @type {Record<string, unknown>} */ (cfg.plugins.entries);
  const browserEntry =
    entries.browser && typeof entries.browser === "object"
      ? /** @type {Record<string, unknown>} */ (entries.browser)
      : {};
  const wantPlugin = !sidebar;
  if (browserEntry.enabled !== wantPlugin) {
    entries.browser = { ...browserEntry, enabled: wantPlugin };
    changed = true;
  }

  if (Array.isArray(cfg.plugins.allow)) {
    const allow = /** @type {string[]} */ (cfg.plugins.allow);
    const hasBrowser = allow.includes("browser");
    if (sidebar && hasBrowser) {
      cfg.plugins.allow = allow.filter((id) => id !== "browser");
      changed = true;
    } else if (!sidebar && !hasBrowser) {
      cfg.plugins.allow = [...allow, "browser"].sort((a, b) => a.localeCompare(b));
      changed = true;
    }
  }

  return changed;
}

/** @deprecated alias */
function patchOpenClawBrowserFromStudioLinkMode(studioCfg, cfg) {
  return patchOpenClawBrowserForStudioLinkOpenMode(studioCfg, cfg);
}

/**
 * @param {string} stateDir
 * @param {unknown} studioCfg
 * @returns {boolean}
 */
function patchOpenClawBrowserLinkOpenMode(stateDir, studioCfg) {
  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return false;
  }
  if (!patchOpenClawBrowserFromStudioLinkMode(studioCfg, cfg)) return false;
  writeJsonIfChanged(cfgPath, cfg);
  return true;
}

/**
 * Keep gateway provider blocks aligned for every enabled Studio profile, not only
 * the active one — otherwise switching models can leave stale baseUrl/api metadata.
 * @param {unknown} studioCfg
 * @param {string} stateDir
 */
function patchAllEnabledProviderCatalogs(studioCfg, stateDir) {
  if (!studioCfg || typeof studioCfg !== "object") return false;
  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return false;
  }

  const profiles = Array.isArray(studioCfg.modelProfiles) ? studioCfg.modelProfiles : [];
  const enabledIds = normalizeEnabledProfileIdsFromStudio(studioCfg, profiles);
  const profileMap = new Map(profiles.map((p) => [p?.id, p]));

  let changed = false;
  for (const id of enabledIds) {
    const profile = profileMap.get(id);
    if (!profile || typeof profile !== "object") continue;
    const mapped = mapStudioProfileToOpenClaw({
      provider: profile.provider,
      modelId: profile.modelId,
      baseUrl: profile.baseUrl ?? "",
      minimaxRegion: profile.minimaxRegion,
    });
    if (!mapped?.gatewayCatalog) continue;
    if (ensureGatewayVisionCatalogEntry(cfg, mapped.modelRef, mapped.gatewayCatalog)) {
      changed = true;
    }
  }

  if (changed) writeJsonIfChanged(cfgPath, cfg);
  return changed;
}

/** @param {unknown} studioCfg @param {unknown[]} profiles */
function normalizeEnabledProfileIdsFromStudio(studioCfg, profiles) {
  const valid = new Set(
    profiles
      .filter((p) => p && typeof p === "object" && typeof p.id === "string")
      .map((p) => p.id.trim())
      .filter(Boolean),
  );
  const raw = Array.isArray(studioCfg.enabledModelProfileIds) ? studioCfg.enabledModelProfileIds : [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    const id = typeof row === "string" ? row.trim() : "";
    if (!id || !valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {string} agentAgentDir .../agents/<id>/agent
 * @param {string} profileKey e.g. deepseek:default
 * @param {{ type: string; provider: string; key: string }} credential
 */
function upsertAuthProfile(agentAgentDir, profileKey, credential) {
  const authPath = path.join(agentAgentDir, "auth-profiles.json");
  /** @type {{ version: number; profiles: Record<string, unknown> }} */
  let store = { version: 1, profiles: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.profiles && typeof parsed.profiles === "object") {
      store = {
        version: Number(parsed.version) || 1,
        profiles: { ...parsed.profiles },
      };
    }
  } catch {
    /* new store */
  }

  const prev = store.profiles[profileKey];
  const prevKey =
    prev && typeof prev === "object" && typeof prev.key === "string" ? prev.key : null;
  if (
    prev &&
    typeof prev === "object" &&
    prev.type === credential.type &&
    prev.provider === credential.provider &&
    prevKey === credential.key
  ) {
    return false;
  }

  store.profiles[profileKey] = { ...credential };
  writeJsonIfChanged(authPath, store);
  return true;
}

/** @param {string} agentAgentDir @param {string} profileKey */
function clearAuthProfileCooldown(agentAgentDir, profileKey) {
  const statePath = path.join(agentAgentDir, "auth-state.json");
  /** @type {Record<string, unknown>} */
  let state = { version: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object") state = { ...parsed };
  } catch {
    return false;
  }
  const stats = state.usageStats;
  if (!stats || typeof stats !== "object" || !Object.prototype.hasOwnProperty.call(stats, profileKey)) {
    return false;
  }
  const nextStats = { ...stats };
  delete nextStats[profileKey];
  state.usageStats = nextStats;
  writeJsonIfChanged(statePath, state);
  return true;
}

/**
 * @param {unknown} cfg UserConfig from config-store readRaw()
 * @returns {{ ok: boolean; skipped?: string; stateDir?: string; agentId?: string; authChanged?: boolean; modelPatch?: unknown; warning?: string }}
 */
/**
 * Push model + API credentials into a specific OpenClaw agent directory.
 * @param {unknown} cfg
 * @param {string} [agentIdOverride] normalized gateway agent id; defaults to cfg.openclaw.sessionKey
 */
function syncOpenClawAgentForId(cfg, agentIdOverride) {
  const oc = cfg?.openclaw && typeof cfg.openclaw === "object" ? cfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim()
      ? oc.gatewayBaseUrl.trim()
      : "";
  if (!gatewayBaseUrl) return { ok: false, skipped: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const browserHeadlessPatched = patchOpenClawBrowserLinkOpenMode(stateDir, cfg);

  const sessionKey =
    typeof oc.sessionKey === "string" && oc.sessionKey.trim()
      ? oc.sessionKey.trim()
      : "agent:dev:dev";

  const profile = extractActiveProfile(cfg);
  if (!profile) return { ok: false, skipped: "no_active_model_profile", browserHeadlessPatched };

  const mapped = mapStudioProfileToOpenClaw({
    provider: profile.provider,
    modelId: profile.modelId,
    baseUrl: profile.baseUrl ?? "",
    minimaxRegion: profile.minimaxRegion,
  });
  if (!mapped) return { ok: false, skipped: "unsupported_provider_for_gateway_sync", browserHeadlessPatched };

  const agentId = agentIdOverride
    ? normalizeAgentId(agentIdOverride)
    : parseAgentIdFromSessionKey(sessionKey);
  const agentAgentDir = path.join(stateDir, "agents", agentId, "agent");

  const apiKey = resolveApiKeyForActiveProfile(cfg, stateDir, agentId, mapped);
  if (!apiKey) return { ok: false, skipped: "missing_api_key" };

  const credential = {
    type: "api_key",
    provider: mapped.openClawProvider,
    key: apiKey,
  };

  const authChanged = upsertAuthProfile(agentAgentDir, mapped.profileKey, credential);
  clearAuthProfileCooldown(agentAgentDir, mapped.profileKey);
  const providerPluginId = mapped.openClawProvider;
  const modelPatch = patchOpenClawGatewayStudioBinding(
    stateDir,
    agentId,
    mapped.modelRef,
    providerPluginId,
    cfg,
    mapped.gatewayCatalog,
  );
  patchAllEnabledProviderCatalogs(cfg, stateDir);
  const pluginCatalogChanged = patchAllAgentPluginModelCatalogs(agentAgentDir);

  // Keep OpenClaw USER.md in sync with Studio global profile (persona is no longer
  // re-pasted into every chat.send system row).
  let userMdSynced = false;
  try {
    const { syncWorkspaceUserMdFromStudio } = require("./openclaw-agent-crud.cjs");
    const workspaceDir = path.join(stateDir, "agents", agentId, "workspace");
    userMdSynced = Boolean(syncWorkspaceUserMdFromStudio(workspaceDir, cfg));
  } catch {
    userMdSynced = false;
  }

  return {
    ok: true,
    stateDir,
    agentId,
    authChanged,
    modelPatch,
    pluginCatalogChanged,
    browserHeadlessPatched,
    userMdSynced,
    ...(mapped.warning ? { warning: mapped.warning } : {}),
  };
}

function syncOpenClawAgentFromStudioConfig(cfg) {
  return syncOpenClawAgentForId(cfg);
}

module.exports = {
  syncOpenClawAgentFromStudioConfig,
  syncOpenClawAgentForId,
  resolveOpenClawStateDir,
  parseAgentIdFromSessionKey,
  normalizeAgentId,
  mapStudioProfileToOpenClaw,
  ensureDevGatewayAuthToken,
  patchOpenClawGatewayStudioBinding,
  patchOpenClawBrowserLinkOpenMode,
  patchOpenClawBrowserFromStudioLinkMode,
};
