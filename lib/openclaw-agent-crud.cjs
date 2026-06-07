/**
 * Create / update / remove OpenClaw on-disk agents from Studio agent metadata.
 * Provisions workspace + SOUL.md / IDENTITY.md and registers agents in openclaw.json `agents.list`.
 */

const fs = require("fs");
const path = require("path");
const {
  resolveOpenClawStateDir,
  parseAgentIdFromSessionKey,
  syncOpenClawAgentForId,
} = require("./sync-openclaw-agent-from-studio.cjs");

/** OpenClaw workspace bootstrap file names (case-sensitive). */
const SOUL_FILE = "SOUL.md";
const IDENTITY_FILE = "IDENTITY.md";

/** @param {string} value */
function normalizeAgentId(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "main";
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "").slice(0, 64) || "main";
}

function writeFileAtomic(filePath, body) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

/** @param {string} filePath */
function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * On Windows (case-insensitive FS), `soul.md` and `SOUL.md` are the same inode.
 * Never unlink a legacy lowercase name when it aliases the canonical file.
 * @param {string} workspaceDir
 * @param {string} canonicalFile
 * @param {string} legacyFile
 */
function unlinkLegacyFileIfDistinct(workspaceDir, canonicalFile, legacyFile) {
  if (canonicalFile.toLowerCase() === legacyFile.toLowerCase()) return;
  try {
    fs.unlinkSync(path.join(workspaceDir, legacyFile));
  } catch {
    /* ignore */
  }
}

/** @param {string} stateDir @param {string} gatewayAgentId */
function agentWorkspaceDir(stateDir, gatewayAgentId) {
  return path.join(stateDir, "agents", normalizeAgentId(gatewayAgentId), "workspace");
}

/** @param {string} name @param {string} description */
function defaultSoulMd(name, description) {
  const lines = [`# ${name || "Agent"}`, ""];
  if (description.trim()) lines.push(description.trim(), "");
  lines.push(
    "You are a specialized assistant in Open Studio. Stay in character and be concise unless the user asks for depth.",
    "",
  );
  return lines.join("\n");
}

/** @param {{ name: string; description: string; avatar: string; identityMd?: string }} meta */
function buildIdentityMd(meta) {
  const custom = String(meta.identityMd ?? "").trim();
  if (custom) return custom.endsWith("\n") ? custom : `${custom}\n`;
  const name = String(meta.name ?? "").trim() || "Agent";
  const vibe = String(meta.description ?? "").trim() || "Helpful specialist";
  const emoji = String(meta.avatar ?? "🦞").trim().slice(0, 8) || "🦞";
  return [
    "# IDENTITY.md - Who Am I?",
    "",
    `- **Name:** ${name}`,
    `- **Creature:** AI assistant`,
    `- **Vibe:** ${vibe}`,
    `- **Emoji:** ${emoji}`,
    "",
  ].join("\n");
}

/** @param {{ name: string; identityMd?: string }} meta */
function identityNameForList(meta) {
  const fromMd = /\*\*Name:\*\*\s*(.+)/i.exec(String(meta.identityMd ?? ""));
  if (fromMd?.[1]?.trim()) return fromMd[1].trim().slice(0, 80);
  return String(meta.name ?? "").trim().slice(0, 80) || "Agent";
}

/**
 * @param {unknown} studioCfg
 * @returns {string}
 */
function defaultGatewayAgentIdFromConfig(studioCfg) {
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const sessionKey =
    typeof oc.sessionKey === "string" && oc.sessionKey.trim() ? oc.sessionKey.trim() : "agent:dev:dev";
  return parseAgentIdFromSessionKey(sessionKey);
}

/** @param {string} gatewayAgentId */
function sessionKeyForGatewayAgentId(gatewayAgentId) {
  const id = normalizeAgentId(gatewayAgentId);
  if (id === "dev") return "agent:dev:dev";
  return `agent:${id}:main`;
}

/**
 * @param {string} workspaceDir
 * @param {string | null | undefined} legacyWorkspace
 */
function migrateBootstrapFromLegacyWorkspace(workspaceDir, legacyWorkspace) {
  const legacy = typeof legacyWorkspace === "string" ? legacyWorkspace.trim() : "";
  if (!legacy) return;
  const legacyResolved = path.resolve(legacy);
  const targetResolved = path.resolve(workspaceDir);
  if (legacyResolved === targetResolved) return;

  for (const file of [SOUL_FILE, IDENTITY_FILE, "soul.md", "identity.md"]) {
    const dest = path.join(workspaceDir, file === "soul.md" ? SOUL_FILE : file === "identity.md" ? IDENTITY_FILE : file);
    if (readTextIfExists(dest)?.trim()) continue;
    const fromLegacy = readTextIfExists(path.join(legacyResolved, file));
    if (fromLegacy?.trim()) writeFileAtomic(dest, fromLegacy.endsWith("\n") ? fromLegacy : `${fromLegacy}\n`);
  }
}

/**
 * @param {string} workspaceDir
 * @param {{ name: string; description: string; avatar: string; soulMd: string; identityMd?: string }} meta
 */
function writeAgentWorkspaceFiles(workspaceDir, meta) {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const soulBody = meta.soulMd.trim() ? meta.soulMd : defaultSoulMd(meta.name, meta.description);
  writeFileAtomic(
    path.join(workspaceDir, SOUL_FILE),
    soulBody.endsWith("\n") ? soulBody : `${soulBody}\n`,
  );
  const identityBody = buildIdentityMd(meta);
  writeFileAtomic(
    path.join(workspaceDir, IDENTITY_FILE),
    identityBody.endsWith("\n") ? identityBody : `${identityBody}\n`,
  );
  unlinkLegacyFileIfDistinct(workspaceDir, SOUL_FILE, "soul.md");
  unlinkLegacyFileIfDistinct(workspaceDir, IDENTITY_FILE, "identity.md");
}

/**
 * @param {string} stateDir
 * @param {string} gatewayAgentId
 * @param {{ name: string; description: string; avatar: string; soulMd?: string; identityMd?: string; isMain?: boolean }} meta
 */
function patchAgentsListEntry(stateDir, gatewayAgentId, meta) {
  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return { ok: false, reason: "missing_or_invalid_openclaw_json" };
  }

  cfg.agents ??= {};
  const defaults = /** @type {Record<string, unknown>} */ (cfg.agents.defaults ?? {});
  const defaultModel =
    typeof defaults.model === "string" && defaults.model.trim() ? defaults.model.trim() : "";

  const idNorm = normalizeAgentId(gatewayAgentId);
  const workspaceDir = path.join(stateDir, "agents", idNorm, "workspace");
  const list = Array.isArray(cfg.agents.list) ? cfg.agents.list : [];
  if (!Array.isArray(cfg.agents.list)) cfg.agents.list = list;

  let hit = false;
  /** @type {string | undefined} */
  let prevWorkspace;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (normalizeAgentId(entry.id) !== idNorm) continue;
    hit = true;
    prevWorkspace = typeof entry.workspace === "string" ? entry.workspace : undefined;
    entry.id = idNorm;
    entry.workspace = workspaceDir;
    entry.identity = {
      name: identityNameForList(meta),
      theme: meta.description.slice(0, 240),
      emoji: meta.avatar || "🦞",
    };
    if (defaultModel) entry.model = defaultModel;
    if (meta.isMain) entry.default = true;
    if (!entry.tools || typeof entry.tools !== "object") entry.tools = { profile: "full" };
    entry.agentDir = path.join(stateDir, "agents", idNorm, "agent");
    break;
  }

  if (!hit) {
    /** @type {Record<string, unknown>} */
    const row = {
      id: idNorm,
      workspace: workspaceDir,
      identity: {
        name: identityNameForList(meta),
        theme: meta.description.slice(0, 240),
        emoji: meta.avatar || "🦞",
      },
      tools: { profile: "full" },
    };
    if (defaultModel) row.model = defaultModel;
    if (meta.isMain) row.default = true;
    row.agentDir = path.join(stateDir, "agents", idNorm, "agent");
    list.push(row);
  } else if (prevWorkspace && path.resolve(prevWorkspace) !== path.resolve(workspaceDir)) {
    migrateBootstrapFromLegacyWorkspace(workspaceDir, prevWorkspace);
  }

  if (meta.isMain) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      if (normalizeAgentId(entry.id) === idNorm) entry.default = true;
      else if (entry.default) delete entry.default;
    }
    defaults.workspace = workspaceDir;
    cfg.agents.defaults = defaults;
  }

  writeFileAtomic(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  return { ok: true, created: !hit, workspaceDir, prevWorkspace };
}

/**
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function provisionOpenClawAgent(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const name = String(p.name ?? gatewayAgentId).trim().slice(0, 80) || gatewayAgentId;
  const description = String(p.description ?? "").trim().slice(0, 2000);
  const avatar = String(p.avatar ?? "🦞").trim().slice(0, 8) || "🦞";
  const soulMdRaw = typeof p.soulMd === "string" ? p.soulMd : "";
  const soulMd = soulMdRaw.trim() ? soulMdRaw : defaultSoulMd(name, description);
  const identityMd = typeof p.identityMd === "string" ? p.identityMd : "";
  const isMain = Boolean(p.isMain);

  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const agentRoot = path.join(stateDir, "agents", gatewayAgentId);
  const workspaceDir = path.join(agentRoot, "workspace");
  const agentDir = path.join(agentRoot, "agent");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  const listPatch = patchAgentsListEntry(stateDir, gatewayAgentId, {
    name,
    description,
    avatar,
    soulMd,
    identityMd,
    isMain,
  });
  if (!listPatch.ok) return listPatch;

  if (listPatch.prevWorkspace) {
    migrateBootstrapFromLegacyWorkspace(workspaceDir, listPatch.prevWorkspace);
  }

  writeAgentWorkspaceFiles(workspaceDir, { name, description, avatar, soulMd, identityMd });

  const sync = syncOpenClawAgentForId(studioCfg, gatewayAgentId);

  return {
    ok: true,
    gatewayAgentId,
    sessionKey: sessionKeyForGatewayAgentId(gatewayAgentId),
    workspaceDir,
    soulPath: path.join(workspaceDir, SOUL_FILE),
    created: listPatch.created,
    needsGatewayRestart: true,
    sync,
  };
}

/**
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function removeOpenClawAgent(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  if (!gatewayAgentId || gatewayAgentId === defaultGatewayAgentIdFromConfig(studioCfg)) {
    return { ok: false, reason: "cannot_remove_main_agent" };
  }

  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const cfgPath = path.join(stateDir, "openclaw.json");
  /** @type {Record<string, unknown>} */
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return { ok: false, reason: "missing_or_invalid_openclaw_json" };
  }

  const list = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const idNorm = normalizeAgentId(gatewayAgentId);
  const next = list.filter((entry) => {
    if (!entry || typeof entry !== "object") return true;
    return normalizeAgentId(entry.id) !== idNorm;
  });
  if (next.length === list.length) return { ok: true, removed: false };
  cfg.agents.list = next;
  writeFileAtomic(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  return { ok: true, removed: true, needsGatewayRestart: true };
}

/**
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function readAgentSoulMd(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const workspaceDir = path.join(stateDir, "agents", gatewayAgentId, "workspace");
  const soulPath = path.join(workspaceDir, SOUL_FILE);
  const legacyPath = path.join(workspaceDir, "soul.md");
  const soulMd = readTextIfExists(soulPath) ?? readTextIfExists(legacyPath);
  if (soulMd == null) return { ok: false, reason: "soul_not_found", soulPath };
  return { ok: true, soulMd, soulPath };
}

/**
 * @param {string} gatewayAgentId
 * @param {unknown} studioCfg
 */
function readAgentSoulForChat(gatewayAgentId, studioCfg) {
  const r = readAgentSoulMd({ gatewayAgentId }, studioCfg);
  return r.ok && typeof r.soulMd === "string" ? r.soulMd.trim() : "";
}

/**
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function readAgentIdentityMd(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const workspaceDir = agentWorkspaceDir(stateDir, gatewayAgentId);
  const identityPath = path.join(workspaceDir, IDENTITY_FILE);
  const legacyPath = path.join(workspaceDir, "identity.md");
  const identityMd = readTextIfExists(identityPath) ?? readTextIfExists(legacyPath);
  if (identityMd == null) return { ok: false, reason: "identity_not_found", identityPath };
  return { ok: true, identityMd, identityPath };
}

/**
 * Combined workspace bootstrap for chat routing (identity + soul, OpenClaw session load order).
 * @param {string} gatewayAgentId
 * @param {unknown} studioCfg
 */
function readAgentBootstrapForChat(gatewayAgentId, studioCfg) {
  const id = normalizeAgentId(gatewayAgentId);
  const identity = readAgentIdentityMd({ gatewayAgentId: id }, studioCfg);
  const soul = readAgentSoulMd({ gatewayAgentId: id }, studioCfg);
  const chunks = [];
  if (identity.ok && typeof identity.identityMd === "string" && identity.identityMd.trim()) {
    chunks.push(identity.identityMd.trim());
  }
  if (soul.ok && typeof soul.soulMd === "string" && soul.soulMd.trim()) {
    chunks.push(soul.soulMd.trim());
  }
  return chunks.join("\n\n");
}

module.exports = {
  normalizeAgentId,
  defaultGatewayAgentIdFromConfig,
  sessionKeyForGatewayAgentId,
  provisionOpenClawAgent,
  removeOpenClawAgent,
  readAgentSoulMd,
  readAgentIdentityMd,
  readAgentSoulForChat,
  readAgentBootstrapForChat,
  defaultSoulMd,
  SOUL_FILE,
  IDENTITY_FILE,
};
