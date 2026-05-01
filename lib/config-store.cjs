const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const CONFIG_VERSION = 2;
const FILE_NAME = "studio-user-config.json";

/** Earlier versions of Open Studio defaulted `openclaw.gatewayBaseUrl` to the
 * user's "production" loopback gateway on port 18789 and tried to drive it
 * over a (non-existent) `/v1/chat/completions` HTTP endpoint. Starting with
 * CONFIG_VERSION 2 we ship our own clean dev gateway on 19001 and talk to it
 * via WebSocket RPC. Drop saved values that match the legacy default so the
 * new default takes over; users who deliberately set 18789 themselves keep it. */
const LEGACY_DEFAULT_GATEWAY_URLS = new Set([
  "http://127.0.0.1:18789",
  "http://localhost:18789",
]);

const KNOWN_PROVIDER_IDS = ["openai", "anthropic", "google", "openai-compatible"];

/** @typedef {{ providerApiKey?: string }} StoredCredentials */
/** @typedef {{
 *   gatewayBaseUrl?: string;
 *   gatewayToken?: string;
 *   sessionKey?: string;
 *   chatLabLeanPlugins?: boolean;
 * }} StoredOpenClaw */
/** @typedef {{
 *   provider?: string;
 *   modelId?: string;
 *   baseUrl?: string;
 * }} StoredModel */
/** @typedef {{
 *   id: string;
 *   label?: string;
 *   provider: string;
 *   modelId: string;
 *   baseUrl: string;
 * }} ModelProfile */

/** @typedef {{
 *   version: number;
 *   credentials: StoredCredentials;
 *   openclaw: StoredOpenClaw;
 *   model: StoredModel;
 *   modelProfiles: ModelProfile[];
 *   activeModelProfileId: string;
 * }} UserConfig */

/** @param {Partial<StoredModel>} m */
function modelHasConfiguredFields(m) {
  if (!m || typeof m !== "object") return false;
  if (typeof m.baseUrl === "string" && m.baseUrl.trim().length > 0) return true;
  if (typeof m.modelId === "string" && m.modelId.trim().length > 0) return true;
  if (typeof m.provider !== "string" || m.provider.trim().length === 0) return false;
  if (m.provider.trim() !== "openai") return true;
  return false;
}

/** @param {StoredModel | undefined} m */
function deriveLegacyMigrateProvider(m) {
  const p = typeof m?.provider === "string" ? m.provider.trim() : "";
  if (p && KNOWN_PROVIDER_IDS.includes(p)) return p;
  return "";
}

/** @param {Partial<UserConfig>} merged */
function shouldMigrateLegacyToProfiles(parsed, merged) {
  const listFromFile = parsed.modelProfiles;
  if (Array.isArray(listFromFile) && listFromFile.length > 0) return false;
  const m = merged.model;
  const apiKey =
    merged.credentials?.providerApiKey != null &&
    typeof merged.credentials.providerApiKey === "string" &&
    merged.credentials.providerApiKey.trim().length > 0;
  return modelHasConfiguredFields(m) || apiKey;
}

/** @param {unknown} p */
function normalizeProviderValue(p) {
  if (typeof p !== "string") return "";
  const t = p.trim();
  if (!t || !KNOWN_PROVIDER_IDS.includes(t)) return "";
  return t;
}

/** @param {Partial<ModelProfile> | unknown} raw */
function normalizeProfileRecord(raw) {
  const r = typeof raw === "object" && raw !== null ? /** @type {Partial<ModelProfile>} */ (raw) : {};
  const safeId = typeof r.id === "string" && r.id.trim().length > 0 ? r.id.trim() : randomUUID();
  const provider = normalizeProviderValue(r.provider);
  return {
    id: safeId,
    label: typeof r.label === "string" ? r.label.trim() : "",
    provider,
    modelId: typeof r.modelId === "string" ? r.modelId.trim() : "",
    baseUrl: typeof r.baseUrl === "string" ? r.baseUrl.trim() : "",
  };
}

/** @param {unknown} rows */
function normalizeProfileList(rows) {
  const seen = new Set();
  if (!Array.isArray(rows)) return [];
  /** @type {ModelProfile[]} */
  const next = [];
  for (const row of rows) {
    let p = normalizeProfileRecord(row);
    if (seen.has(p.id)) {
      p = { ...p, id: randomUUID() };
    }
    seen.add(p.id);
    next.push(p);
  }
  return next;
}

/** @param {UserConfig} config */
function syncModelFromProfiles(config) {
  const pid = typeof config.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
  const profiles = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  if (profiles.length === 0) {
    config.model = { provider: "", modelId: "", baseUrl: "" };
    config.activeModelProfileId = "";
    return;
  }
  const matched = pid ? profiles.find((x) => x.id === pid) : null;
  const prof = matched ?? profiles[0];
  config.activeModelProfileId = prof.id;
  config.model = {
    provider: prof.provider,
    modelId: prof.modelId,
    baseUrl: prof.baseUrl,
  };
}

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    credentials: {},
    openclaw: {
      gatewayBaseUrl: "http://127.0.0.1:19001",
      sessionKey: "agent:dev:dev",
      chatLabLeanPlugins: false,
    },
    model: {
      provider: "",
      modelId: "",
      baseUrl: "",
    },
    modelProfiles: [],
    activeModelProfileId: "",
  };
}

/** @param {string} userDataDir */
function createConfigStore(userDataDir) {
  const filePath = () => path.join(userDataDir, FILE_NAME);

  /** @returns {UserConfig} */
  function readMerged() {
    const fp = filePath();
    let parsed = {};
    let migrationDirty = false;
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const p = JSON.parse(raw);
      if (typeof p === "object" && p !== null) parsed = p;
    } catch {
      parsed = {};
    }

    const parsedVersion =
      typeof parsed.version === "number" && Number.isFinite(parsed.version)
        ? parsed.version
        : 1;
    if (parsedVersion < 2) {
      const oc = parsed.openclaw;
      if (oc && typeof oc === "object") {
        const url = typeof oc.gatewayBaseUrl === "string" ? oc.gatewayBaseUrl.trim() : "";
        if (url && LEGACY_DEFAULT_GATEWAY_URLS.has(url)) {
          delete oc.gatewayBaseUrl;
          migrationDirty = true;
        }
      }
    }

    const dc = defaultConfig();
    /** @type {Partial<UserConfig>} */
    let merged = {
      ...dc,
      ...parsed,
      credentials: { ...dc.credentials, ...(parsed.credentials ?? {}) },
      openclaw: { ...dc.openclaw, ...(parsed.openclaw ?? {}) },
      model: { ...dc.model, ...(parsed.model ?? {}) },
    };

    const rawProfiles =
      parsed.modelProfiles != null ? parsed.modelProfiles : merged.modelProfiles;
    merged.modelProfiles = normalizeProfileList(rawProfiles);
    merged.activeModelProfileId =
      typeof parsed.activeModelProfileId === "string"
        ? parsed.activeModelProfileId.trim()
        : typeof merged.activeModelProfileId === "string"
          ? merged.activeModelProfileId.trim()
          : "";

    if (
      merged.modelProfiles.length === 0 &&
      shouldMigrateLegacyToProfiles(parsed, merged)
    ) {
      const legacy = merged.model;
      const provGuess = deriveLegacyMigrateProvider(legacy);
      const id = randomUUID();
      merged.modelProfiles = [
        {
          id,
          label: "",
          provider: normalizeProviderValue(provGuess) || "openai",
          modelId: typeof legacy?.modelId === "string" ? legacy.modelId.trim() : "",
          baseUrl: typeof legacy?.baseUrl === "string" ? legacy.baseUrl.trim() : "",
        },
      ];
      merged.activeModelProfileId = id;
    }

    if (merged.activeModelProfileId && !merged.modelProfiles.some((p) => p.id === merged.activeModelProfileId)) {
      merged.activeModelProfileId = merged.modelProfiles[0]?.id ?? "";
    }

    const next = /** @type {UserConfig} */ ({
      ...defaultConfig(),
      ...merged,
      credentials: { ...dc.credentials, ...merged.credentials },
      openclaw: { ...dc.openclaw, ...merged.openclaw },
      model: { ...dc.model, ...merged.model },
      modelProfiles: normalizeProfileList(merged.modelProfiles),
      activeModelProfileId:
        merged.modelProfiles.some((p) => p.id === merged.activeModelProfileId)
          ? merged.activeModelProfileId
          : merged.modelProfiles[0]?.id ?? "",
    });

    syncModelFromProfiles(next);
    next.version = CONFIG_VERSION;

    if (migrationDirty) {
      try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify(next, null, 2), "utf8");
      } catch {
        // best-effort migration: if disk write fails the in-memory value is still correct
      }
    }

    return next;
  }

  /** @returns {UserConfig} */
  function readRaw() {
    return readMerged();
  }

  /** @param {UserConfig} next */
  function writeRaw(next) {
    const fp = filePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(next, null, 2), "utf8");
  }

  /** 渲染进程可用：不含明文密钥 */
  function getSanitized() {
    const c = readMerged();
    const key = c.credentials?.providerApiKey;
    const oc = c.openclaw ?? {};
    const gwTok = oc.gatewayToken;
    const dc = defaultConfig();
    const gwUrl =
      typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim().length > 0
        ? oc.gatewayBaseUrl.trim()
        : dc.openclaw.gatewayBaseUrl;
    const sessionKey =
      typeof oc.sessionKey === "string" && oc.sessionKey.trim().length > 0
        ? oc.sessionKey.trim()
        : dc.openclaw.sessionKey;
    return {
      version: c.version,
      openclaw: {
        gatewayBaseUrl: gwUrl,
        sessionKey,
        hasGatewayToken: Boolean(gwTok && String(gwTok).trim().length > 0),
        chatLabLeanPlugins: Boolean(oc.chatLabLeanPlugins),
      },
      model: { ...c.model },
      modelProfiles: c.modelProfiles.map((p) => ({
        id: p.id,
        label: p.label,
        provider: p.provider,
        modelId: p.modelId,
        baseUrl: p.baseUrl,
      })),
      activeModelProfileId: c.activeModelProfileId,
      credentials: {
        hasProviderApiKey: Boolean(key && String(key).length > 0),
      },
    };
  }

  /**
   * @param {Partial<{
   *   openclaw: Partial<StoredOpenClaw>;
   *   credentials: Partial<StoredCredentials>;
   *   model: Partial<StoredModel>;
   *   modelProfiles: ModelProfile[];
   *   activeModelProfileId: string;
   * }>} patch
   */
  function applyPatch(patch) {
    const cur = readMerged();
    /** @type {UserConfig} */
    const next = {
      ...cur,
      version: CONFIG_VERSION,
      openclaw: { ...cur.openclaw, ...(patch.openclaw ?? {}) },
      credentials: { ...cur.credentials, ...(patch.credentials ?? {}) },
      model: { ...cur.model, ...(patch.model ?? {}) },
    };

    if (patch.credentials && Object.prototype.hasOwnProperty.call(patch.credentials, "providerApiKey")) {
      const v = patch.credentials.providerApiKey;
      if (v === "" || v === null) delete next.credentials.providerApiKey;
      else next.credentials.providerApiKey = String(v);
    }

    if (patch.openclaw && Object.prototype.hasOwnProperty.call(patch.openclaw, "gatewayToken")) {
      const v = patch.openclaw.gatewayToken;
      if (v === "" || v === null) delete next.openclaw.gatewayToken;
      else next.openclaw.gatewayToken = String(v).trim();
    }

    if (patch.openclaw && Object.prototype.hasOwnProperty.call(patch.openclaw, "sessionKey")) {
      const v = patch.openclaw.sessionKey;
      if (v === "" || v === null) delete next.openclaw.sessionKey;
      else next.openclaw.sessionKey = String(v).trim();
    }

    if (patch.openclaw && Object.prototype.hasOwnProperty.call(patch.openclaw, "chatLabLeanPlugins")) {
      const v = patch.openclaw.chatLabLeanPlugins;
      if (v === false || v === null) delete next.openclaw.chatLabLeanPlugins;
      else next.openclaw.chatLabLeanPlugins = true;
    }

    if (Array.isArray(patch.modelProfiles)) {
      next.modelProfiles = normalizeProfileList(patch.modelProfiles);
    }

    if (patch.activeModelProfileId !== undefined) {
      const aid = patch.activeModelProfileId === null ? "" : String(patch.activeModelProfileId).trim();
      next.activeModelProfileId =
        aid && next.modelProfiles.some((p) => p.id === aid) ? aid : next.modelProfiles[0]?.id ?? "";
    }

    if (patch.model && !patch.modelProfiles) {
      const pid =
        typeof next.activeModelProfileId === "string" ? next.activeModelProfileId.trim() : "";
      if (pid) {
        next.modelProfiles = next.modelProfiles.map((p) => {
          if (p.id !== pid) return p;
          return {
            ...p,
            provider: normalizeProviderValue(patch.model?.provider ?? p.provider),
            modelId:
              patch.model?.modelId !== undefined
                ? String(patch.model.modelId).trim()
                : p.modelId,
            baseUrl:
              patch.model?.baseUrl !== undefined ? String(patch.model.baseUrl).trim() : p.baseUrl,
          };
        });
      }
    }

    if (patch.modelProfiles || patch.activeModelProfileId !== undefined || patch.model) {
      syncModelFromProfiles(next);
    }

    if (typeof next.model.provider === "string") next.model.provider = next.model.provider.trim();
    if (typeof next.model.modelId === "string") next.model.modelId = next.model.modelId.trim();
    if (typeof next.model.baseUrl === "string") next.model.baseUrl = next.model.baseUrl.trim();

    writeRaw(next);
    return getSanitized();
  }

  return { filePath, readRaw, getSanitized, applyPatch };
}

module.exports = { createConfigStore, CONFIG_VERSION, FILE_NAME, defaultConfig };
