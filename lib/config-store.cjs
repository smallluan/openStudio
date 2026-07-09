const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");

const CONFIG_VERSION = 7;
const FILE_NAME = "studio-user-config.json";

/** Earlier versions of Open Studio defaulted `openclaw.gatewayBaseUrl` to the
 * user's "production" loopback gateway on port 18789 and tried to drive it
 * over a (non-existent) `/v1/chat/completions` HTTP endpoint. Starting with
 * CONFIG_VERSION 2 we ship our own clean dev gateway on 19002 and talk to it
 * via WebSocket RPC. Drop saved values that match the legacy default so the
 * new default takes over; users who deliberately set 18789 themselves keep it.
 * CONFIG_VERSION 4 defaults `chatLabLeanPlugins` to false (full plugins) and
 * migrates existing configs from v3 with lean forced off once. */
const LEGACY_DEFAULT_GATEWAY_URLS = new Set([
  "http://127.0.0.1:18789",
  "http://localhost:18789",
]);

const { KNOWN_PROVIDER_IDS, inferProviderFromModelId, normalizeMinimaxRegion } = require("./model-providers.cjs");
const { readLegacyAgentModelApiKey } = require("./model-profile-credentials.cjs");

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
 *   apiKey?: string;
 * }} StoredModel */
/** @typedef {{
 *   id: string;
 *   label?: string;
 *   provider: string;
 *   modelId: string;
 *   baseUrl: string;
 *   apiKey?: string;
 *   minimaxRegion?: string;
 * }} ModelProfile */

/** @typedef {{
 *   version: number;
 *   credentials: StoredCredentials;
 *   openclaw: StoredOpenClaw;
 *   model: StoredModel;
 *   modelProfiles: ModelProfile[];
 *   enabledModelProfileIds: string[];
 *   activeModelProfileId: string;
 *   chatLabAutoTitle?: boolean;
 *   chatLabLinkOpenMode?: "sidebar" | "external";
 *   chatLabRawTraceEnabled?: boolean;
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
  const providerRaw = normalizeProviderValue(r.provider);
  const modelId = typeof r.modelId === "string" ? r.modelId.trim() : "";
  const provider = providerRaw || inferProviderFromModelId(modelId);
  const apiKey = typeof r.apiKey === "string" ? r.apiKey.trim() : "";
  const minimaxRegionRaw = normalizeMinimaxRegion(r.minimaxRegion);
  /** @type {ModelProfile} */
  const row = {
    id: safeId,
    label: typeof r.label === "string" ? r.label.trim() : "",
    provider,
    modelId,
    baseUrl: typeof r.baseUrl === "string" ? r.baseUrl.trim() : "",
    ...(apiKey ? { apiKey } : {}),
  };
  if (provider === "minimax" && minimaxRegionRaw) {
    row.minimaxRegion = minimaxRegionRaw;
  }
  return row;
}

/** @param {unknown} rows @param {ModelProfile[]} [existing] */
function normalizeProfileList(rows, existing = []) {
  const seen = new Set();
  const existingById = new Map(existing.map((p) => [p.id, p]));
  if (!Array.isArray(rows)) return [];
  /** @type {ModelProfile[]} */
  const next = [];
  for (const row of rows) {
    const prev = typeof row === "object" && row !== null && typeof row.id === "string"
      ? existingById.get(row.id.trim())
      : undefined;
    const mergedRow =
      prev && typeof row === "object" && row !== null ?
        {
          ...row,
          apiKey:
            typeof row.apiKey === "string" && row.apiKey.trim() ?
              row.apiKey.trim()
            : prev.apiKey,
        }
      : row;
    let p = normalizeProfileRecord(mergedRow);
    if (seen.has(p.id)) {
      p = { ...p, id: randomUUID() };
    }
    seen.add(p.id);
    next.push(p);
  }
  return next;
}

/**
 * @param {unknown} rawIds
 * @param {ModelProfile[]} profiles
 * @param {string} [fallbackActiveId]
 */
function normalizeEnabledProfileIds(rawIds, profiles, fallbackActiveId = "") {
  const valid = new Set(profiles.map((p) => p.id));
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  if (Array.isArray(rawIds)) {
    for (const row of rawIds) {
      const id = typeof row === "string" ? row.trim() : "";
      if (!id || !valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  const fallbackId = typeof fallbackActiveId === "string" ? fallbackActiveId.trim() : "";
  if (out.length === 0 && fallbackId && valid.has(fallbackId)) out.push(fallbackId);
  return out;
}

/** @param {UserConfig} config */
function syncModelFromProfiles(config) {
  const pid = typeof config.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
  const profiles = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  const enabled = normalizeEnabledProfileIds(config.enabledModelProfileIds, profiles, pid);
  config.enabledModelProfileIds = enabled;
  if (profiles.length === 0) {
    config.model = { provider: "", modelId: "", baseUrl: "" };
    config.activeModelProfileId = "";
    return;
  }
  if (enabled.length === 0) {
    config.model = { provider: "", modelId: "", baseUrl: "" };
    config.activeModelProfileId = "";
    return;
  }
  const matched = pid && enabled.includes(pid) ? profiles.find((x) => x.id === pid) : null;
  const prof = matched ?? profiles.find((x) => x.id === enabled[0]) ?? null;
  if (!prof) {
    config.model = { provider: "", modelId: "", baseUrl: "" };
    config.activeModelProfileId = "";
    return;
  }
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
      gatewayBaseUrl: "http://127.0.0.1:19002",
      sessionKey: "agent:dev:dev",
      chatLabLeanPlugins: true,
    },
    model: {
      provider: "",
      modelId: "",
      baseUrl: "",
    },
    modelProfiles: [],
    enabledModelProfileIds: [],
    activeModelProfileId: "",
    chatLabAutoTitle: false,
    chatLabLinkOpenMode: "sidebar",
    chatLabRawTraceEnabled: false,
  };
}

/** @param {string} userDataDir */
function createConfigStore(userDataDir) {
  const filePath = () => path.join(userDataDir, FILE_NAME);

  // Dev mode: sync gateway auth token from ~/.openclaw-dev/openclaw.json
  // so Studio's WS client can authenticate with the dev gateway.
  if (path.basename(userDataDir).endsWith("-dev")) {
    const devCfgPath = path.join(os.homedir(), ".openclaw-dev", "openclaw.json");
    try {
      const devRaw = JSON.parse(fs.readFileSync(devCfgPath, "utf8"));
      const gwToken = devRaw?.gateway?.auth?.token;
      const existingFp = filePath();
      let savedCfg = {};
      try {
        const raw = fs.readFileSync(existingFp, "utf8");
        savedCfg = JSON.parse(raw);
      } catch {
        /* first run */
      }
      if (typeof gwToken === "string" && gwToken.trim() && (!savedCfg.openclaw?.gatewayToken)) {
        savedCfg.openclaw ??= {};
        savedCfg.openclaw.gatewayToken = gwToken.trim();
        savedCfg.version = CONFIG_VERSION;
        fs.mkdirSync(path.dirname(existingFp), { recursive: true });
        fs.writeFileSync(existingFp, JSON.stringify(savedCfg, null, 2), "utf8");
      }
    } catch {
      /* ~/.openclaw-dev not ready yet; will retry on next read */
    }
  }

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
    if (parsedVersion < 3) {
      migrationDirty = true;
    }
    if (parsedVersion < 4) {
      migrationDirty = true;
    }
    if (parsedVersion < 5) migrationDirty = true;
    if (parsedVersion < 6) migrationDirty = true;
    if (parsedVersion < 7) migrationDirty = true;

    const dc = defaultConfig();
    /** @type {Partial<UserConfig>} */
    let merged = {
      ...dc,
      ...parsed,
      credentials: { ...dc.credentials, ...(parsed.credentials ?? {}) },
      openclaw: { ...dc.openclaw, ...(parsed.openclaw ?? {}) },
      model: { ...dc.model, ...(parsed.model ?? {}) },
      chatLabAutoTitle:
        typeof parsed.chatLabAutoTitle === "boolean" ? parsed.chatLabAutoTitle : dc.chatLabAutoTitle,
      chatLabLinkOpenMode:
        parsed.chatLabLinkOpenMode === "external" || parsed.chatLabLinkOpenMode === "sidebar"
          ? parsed.chatLabLinkOpenMode
          : dc.chatLabLinkOpenMode,
      chatLabRawTraceEnabled:
        typeof parsed.chatLabRawTraceEnabled === "boolean"
          ? parsed.chatLabRawTraceEnabled
          : dc.chatLabRawTraceEnabled,
    };

    const rawProfiles =
      parsed.modelProfiles != null ? parsed.modelProfiles : merged.modelProfiles;
    merged.modelProfiles = normalizeProfileList(rawProfiles);
    merged.enabledModelProfileIds = normalizeEnabledProfileIds(
      parsed.enabledModelProfileIds,
      merged.modelProfiles,
      typeof parsed.activeModelProfileId === "string" ? parsed.activeModelProfileId : "",
    );
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
      merged.enabledModelProfileIds = [id];
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
      enabledModelProfileIds: normalizeEnabledProfileIds(
        merged.enabledModelProfileIds,
        normalizeProfileList(merged.modelProfiles),
        merged.activeModelProfileId,
      ),
      activeModelProfileId:
        merged.modelProfiles.some((p) => p.id === merged.activeModelProfileId)
          ? merged.activeModelProfileId
          : merged.modelProfiles[0]?.id ?? "",
      chatLabAutoTitle:
        typeof merged.chatLabAutoTitle === "boolean" ? merged.chatLabAutoTitle : dc.chatLabAutoTitle,
      chatLabLinkOpenMode:
        merged.chatLabLinkOpenMode === "external" || merged.chatLabLinkOpenMode === "sidebar"
          ? merged.chatLabLinkOpenMode
          : dc.chatLabLinkOpenMode,
      chatLabRawTraceEnabled:
        typeof merged.chatLabRawTraceEnabled === "boolean"
          ? merged.chatLabRawTraceEnabled
          : dc.chatLabRawTraceEnabled,
    });

    syncModelFromProfiles(next);
    next.version = CONFIG_VERSION;
    if (parsedVersion < 4) {
      next.openclaw = { ...next.openclaw, chatLabLeanPlugins: false };
    }

    if (parsedVersion < 6) {
      const sessionKey =
        typeof next.openclaw?.sessionKey === "string" ? next.openclaw.sessionKey.trim() : "agent:dev:dev";
      const agentMatch = /^agent:([^:]+):/i.exec(sessionKey);
      const agentId = (agentMatch ? agentMatch[1] : "dev").toLowerCase();
      let stateDir = path.join(os.homedir(), ".openclaw");
      try {
        const gw = String(next.openclaw?.gatewayBaseUrl ?? "").trim();
        const u = new URL(gw);
        const port = u.port || (u.protocol === "https:" ? "443" : "80");
        const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
        if (loopback && (port === "19002" || port === "19001")) {
          stateDir = path.join(os.homedir(), ".openclaw-dev");
        }
      } catch {
        /* default */
      }
      for (const p of next.modelProfiles) {
        if (p.apiKey && String(p.apiKey).trim()) continue;
        if (!p.provider) continue;
        const recovered = readLegacyAgentModelApiKey(stateDir, agentId, p.provider);
        if (recovered) p.apiKey = recovered;
      }
    }

    if (parsedVersion < 7) {
      const globalKey =
        typeof next.credentials?.providerApiKey === "string" ? next.credentials.providerApiKey.trim() : "";
      for (const p of next.modelProfiles) {
        if (p.provider === "minimax") {
          if (!p.minimaxRegion) p.minimaxRegion = "cn";
          if (!p.apiKey && globalKey.startsWith("sk-api-")) p.apiKey = globalKey;
        }
      }
    }

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
        chatLabLeanPlugins:
          typeof oc.chatLabLeanPlugins === "boolean" ? oc.chatLabLeanPlugins : dc.openclaw.chatLabLeanPlugins,
      },
      model: { ...c.model },
      modelProfiles: c.modelProfiles.map((p) => ({
        id: p.id,
        label: p.label,
        provider: p.provider,
        modelId: p.modelId,
        baseUrl: p.baseUrl,
        ...(p.provider === "minimax" && p.minimaxRegion ? { minimaxRegion: p.minimaxRegion } : {}),
        hasApiKey: Boolean(p.apiKey && String(p.apiKey).trim().length > 0),
      })),
      enabledModelProfileIds: normalizeEnabledProfileIds(c.enabledModelProfileIds, c.modelProfiles, c.activeModelProfileId),
      activeModelProfileId: c.activeModelProfileId,
      chatLabAutoTitle: Boolean(c.chatLabAutoTitle),
      chatLabLinkOpenMode:
        c.chatLabLinkOpenMode === "external" ? "external" : "sidebar",
      chatLabRawTraceEnabled: Boolean(c.chatLabRawTraceEnabled),
      credentials: {
        hasProviderApiKey:
          c.modelProfiles.some((p) => p.apiKey && String(p.apiKey).trim().length > 0) ||
          Boolean(key && String(key).length > 0),
      },
    };
  }

  /**
   * @param {Partial<{
   *   openclaw: Partial<StoredOpenClaw>;
   *   credentials: Partial<StoredCredentials>;
   *   model: Partial<StoredModel>;
   *   modelProfiles: ModelProfile[];
   *   enabledModelProfileIds: string[];
   *   activeModelProfileId: string;
   *   chatLabAutoTitle?: boolean;
   *   chatLabLinkOpenMode?: "sidebar" | "external";
   *   chatLabRawTraceEnabled?: boolean;
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
      next.openclaw.chatLabLeanPlugins = Boolean(patch.openclaw.chatLabLeanPlugins);
    }

    if (Array.isArray(patch.modelProfiles)) {
      next.modelProfiles = normalizeProfileList(patch.modelProfiles, cur.modelProfiles);
    }

    if (Array.isArray(patch.enabledModelProfileIds)) {
      next.enabledModelProfileIds = normalizeEnabledProfileIds(
        patch.enabledModelProfileIds,
        next.modelProfiles,
        next.activeModelProfileId,
      );
    } else {
      next.enabledModelProfileIds = normalizeEnabledProfileIds(
        next.enabledModelProfileIds,
        next.modelProfiles,
        next.activeModelProfileId,
      );
    }

    if (patch.activeModelProfileId !== undefined) {
      const aid = patch.activeModelProfileId === null ? "" : String(patch.activeModelProfileId).trim();
      next.activeModelProfileId =
        aid && next.enabledModelProfileIds.includes(aid) ? aid : next.enabledModelProfileIds[0] ?? "";
    }

    if (patch.chatLabAutoTitle !== undefined) {
      next.chatLabAutoTitle = Boolean(patch.chatLabAutoTitle);
    }

    if (patch.chatLabLinkOpenMode !== undefined) {
      next.chatLabLinkOpenMode =
        patch.chatLabLinkOpenMode === "external" ? "external" : "sidebar";
    }

    if (patch.chatLabRawTraceEnabled !== undefined) {
      next.chatLabRawTraceEnabled = Boolean(patch.chatLabRawTraceEnabled);
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

    if (patch.modelProfiles || patch.enabledModelProfileIds || patch.activeModelProfileId !== undefined || patch.model) {
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
