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

const KNOWN_PROVIDER_IDS = ["openai", "anthropic", "google", "openai-compatible"];

/**
 * All LLM provider plugin ids we know how to map to from a Studio model
 * profile. When Studio's *active* provider changes (e.g. user switches the
 * profile from DeepSeek to Anthropic), `patchOpenClawGatewayStudioBinding`
 * uses this list to **remove** the previously-active provider plugin from
 * `plugins.allow`, so `plugins.allow` doesn't accumulate every provider the
 * user ever tried (each unused provider plugin still loads its npm runtime
 * deps + tool surface on the next gateway restart, which we don't want).
 *
 * Plugins NOT in this list (e.g. browser, phone-control, talk-voice) are
 * never auto-removed — they're tool/peripheral plugins, not LLM providers,
 * and `mapStudioProfileToOpenClaw` never produces them as a "current" id.
 */
const KNOWN_OPENCLAW_PROVIDER_PLUGINS = ["deepseek", "openai", "anthropic", "google"];

/**
 * Default bundled plugins seen on `openclaw --dev gateway` without an explicit
 * `plugins.allow` in openclaw.json. Studio historically synced this fat list so
 * the embedded agent could drive desktop peripherals — **but Open Studio now defaults**
 * `openclaw.chatLabLeanPlugins` to **true**, which skips this list and only loads the
 * active LLM provider plugin for dev gateways (~/.openclaw-dev). Toggle lean mode off in
 * Settings → Model → Advanced if you need the full surface (browser / phone-control / …).
 */
const OPENCLAW_DEV_GATEWAY_BASE_ALLOWLIST = [
  "acpx",
  "bonjour",
  "browser",
  "device-pair",
  "file-transfer",
  "memory-core",
  "phone-control",
  "talk-voice",
];

/**
 * When Studio setting `openclaw.chatLabLeanPlugins` is true, we only extend
 * `plugins.allow` with the active LLM provider plugin on **dev** gateways
 * (`~/.openclaw-dev`). Skipping the fat base list shortens gateway
 * `core-plugin-tools` / prep by not loading browser, phone-control, etc.
 */
const OPENCLAW_DEV_GATEWAY_LEAN_ALLOWLIST = [];

/** @param {unknown} cfg */
function extractActiveProfile(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const list = Array.isArray(cfg.modelProfiles) ? cfg.modelProfiles : [];
  const activeId =
    typeof cfg.activeModelProfileId === "string" ? cfg.activeModelProfileId.trim() : "";
  const matched = activeId ? list.find((p) => p && p.id === activeId) : null;
  return matched ?? list[0] ?? null;
}

/** @param {unknown} cfg */
function extractApiKey(cfg) {
  const raw = cfg?.credentials?.providerApiKey;
  return typeof raw === "string" ? raw.trim() : "";
}

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
 * Dev gateway bundled with `npm run dev` listens on 19001 and uses ~/.openclaw-dev.
 * Anything else is assumed to follow the default OpenClaw state dir ~/.openclaw.
 * @param {string} gatewayBaseUrl
 */
function resolveOpenClawStateDir(gatewayBaseUrl) {
  try {
    const u = new URL(gatewayBaseUrl);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const loopback =
      u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
    if (loopback && port === "19001") {
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
 * Map Settings → Model profile to OpenClaw provider + model ref + auth profile id.
 * @param {{ provider: string; modelId: string; baseUrl: string }} profile
 * @returns {{ openClawProvider: string; modelRef: string; profileKey: string; warning?: string } | null}
 */
function mapStudioProfileToOpenClaw(profile) {
  const provider = String(profile.provider || "").trim();
  const modelId = String(profile.modelId || "").trim();
  const baseUrl = String(profile.baseUrl || "").trim().toLowerCase();

  if (!modelId || !KNOWN_PROVIDER_IDS.includes(provider)) return null;

  if (provider === "openai-compatible") {
    if (baseUrl.includes("deepseek")) {
      return {
        openClawProvider: "deepseek",
        modelRef: `deepseek/${modelId}`,
        profileKey: "deepseek:default",
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

  if (provider === "openai") {
    return {
      openClawProvider: "openai",
      modelRef: `openai/${modelId}`,
      profileKey: "openai:default",
    };
  }

  if (provider === "anthropic") {
    return {
      openClawProvider: "anthropic",
      modelRef: `anthropic/${modelId}`,
      profileKey: "anthropic:default",
    };
  }

  if (provider === "google") {
    return {
      openClawProvider: "google",
      modelRef: `google/${modelId}`,
      profileKey: "google:default",
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
 * @param {unknown} [studioCfg] full Studio user config (for `chatLabLeanPlugins`)
 */
function patchOpenClawGatewayStudioBinding(stateDir, agentId, modelRef, providerPluginId, studioCfg) {
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

  if (providerPluginId) {
    const oc =
      studioCfg && typeof studioCfg === "object" ? /** @type {any} */ (studioCfg).openclaw : null;
    const lean =
      Boolean(oc && typeof oc === "object" && oc.chatLabLeanPlugins) && devProfile;

    cfg.plugins ??= {};
    const cur = Array.isArray(cfg.plugins.allow) ? cfg.plugins.allow : null;

    /** @type {string[]} */
    let next;
    if (lean) {
      next = [...OPENCLAW_DEV_GATEWAY_LEAN_ALLOWLIST];
    } else if (cur === null) {
      next = devProfile ? [...OPENCLAW_DEV_GATEWAY_BASE_ALLOWLIST] : [];
    } else {
      next = cur.filter(
        (id) =>
          typeof id === "string" &&
          (id === providerPluginId || !KNOWN_OPENCLAW_PROVIDER_PLUGINS.includes(id)),
      );
    }

    if (!next.includes(providerPluginId)) next.push(providerPluginId);
    next.sort((a, b) => a.localeCompare(b));

    const same =
      Array.isArray(cur) &&
      cur.length === next.length &&
      cur.every((v, i) => v === next[i]);
    if (!same) {
      cfg.plugins.allow = next;
      changed = true;
    }
  }

  if (changed) writeJsonIfChanged(cfgPath, cfg);
  return { ok: true, changed };
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

/**
 * @param {unknown} cfg UserConfig from config-store readRaw()
 * @returns {{ ok: boolean; skipped?: string; stateDir?: string; agentId?: string; authChanged?: boolean; modelPatch?: unknown; warning?: string }}
 */
function syncOpenClawAgentFromStudioConfig(cfg) {
  const oc = cfg?.openclaw && typeof cfg.openclaw === "object" ? cfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim()
      ? oc.gatewayBaseUrl.trim()
      : "";
  if (!gatewayBaseUrl) return { ok: false, skipped: "missing_gateway_base_url" };

  const sessionKey =
    typeof oc.sessionKey === "string" && oc.sessionKey.trim()
      ? oc.sessionKey.trim()
      : "agent:dev:dev";

  const profile = extractActiveProfile(cfg);
  const apiKey = extractApiKey(cfg);
  if (!profile) return { ok: false, skipped: "no_active_model_profile" };
  if (!apiKey) return { ok: false, skipped: "missing_api_key" };

  const mapped = mapStudioProfileToOpenClaw({
    provider: profile.provider,
    modelId: profile.modelId,
    baseUrl: profile.baseUrl ?? "",
  });
  if (!mapped) return { ok: false, skipped: "unsupported_provider_for_gateway_sync" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const agentId = parseAgentIdFromSessionKey(sessionKey);
  const agentAgentDir = path.join(stateDir, "agents", agentId, "agent");

  const credential = {
    type: "api_key",
    provider: mapped.openClawProvider,
    key: apiKey,
  };

  const authChanged = upsertAuthProfile(agentAgentDir, mapped.profileKey, credential);
  const providerPluginId = mapped.openClawProvider;
  const modelPatch = patchOpenClawGatewayStudioBinding(
    stateDir,
    agentId,
    mapped.modelRef,
    providerPluginId,
    cfg,
  );

  return {
    ok: true,
    stateDir,
    agentId,
    authChanged,
    modelPatch,
    ...(mapped.warning ? { warning: mapped.warning } : {}),
  };
}

module.exports = {
  syncOpenClawAgentFromStudioConfig,
  resolveOpenClawStateDir,
  parseAgentIdFromSessionKey,
  mapStudioProfileToOpenClaw,
};
