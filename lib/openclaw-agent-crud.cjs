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
const AGENTS_FILE = "AGENTS.md";
const USER_FILE = "USER.md";
const TOOLS_FILE = "TOOLS.md";
const MEMORY_FILE = "MEMORY.md";

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

/**
 * Avatars are UI-only — never put data:/file:/blob: payloads into LLM-bound USER.md.
 * @param {string | undefined | null} avatar
 */
function avatarRefForLlmContext(avatar) {
  const av = String(avatar ?? "").trim();
  if (!av) return "";
  if (/^data:/i.test(av) || /^file:/i.test(av) || /^blob:/i.test(av)) return "";
  if (/^https?:\/\//i.test(av) && av.length <= 512) return av;
  return "";
}

/**
 * @param {{ displayName?: string; avatar?: string; gender?: string; userMd?: string } | null | undefined} profile
 */
function buildGlobalUserMd(profile) {
  if (!profile || typeof profile !== "object") return "";
  const displayName = String(profile.displayName ?? "").trim();
  const gender =
    profile.gender === "male" ? "Male" : profile.gender === "female" ? "Female" : "";
  const avatarRef = avatarRefForLlmContext(profile.avatar);
  const userMd = String(profile.userMd ?? "").trim();
  const metaLines = [];
  if (displayName) metaLines.push(`- **Name:** ${displayName}`);
  if (gender) metaLines.push(`- **Gender:** ${gender}`);
  if (avatarRef) metaLines.push(`- **Avatar:** ${avatarRef}`);
  const metaBlock =
    metaLines.length > 0 ? ["# About the user", "", ...metaLines].join("\n") : "";
  if (metaBlock && userMd) return `${metaBlock}\n\n${userMd}`;
  return metaBlock || userMd;
}

/**
 * Combine Studio global user profile + per-agent USER.md for OpenClaw bootstrap.
 * @param {unknown} studioCfg
 * @param {string} [agentUserMd]
 */
function composeWorkspaceUserMd(studioCfg, agentUserMd = "") {
  const profile =
    studioCfg && typeof studioCfg === "object"
      ? /** @type {{ userProfile?: unknown }} */ (studioCfg).userProfile
      : null;
  const globalUserMd = buildGlobalUserMd(
    profile && typeof profile === "object"
      ? /** @type {{ displayName?: string; avatar?: string; gender?: string; userMd?: string }} */ (profile)
      : null,
  );
  const agentPart = String(agentUserMd ?? "").trim();
  if (globalUserMd && agentPart) return `${globalUserMd}\n\n${agentPart}`;
  return globalUserMd || agentPart;
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
 * @param {{
 *   name: string;
 *   description: string;
 *   avatar: string;
 *   soulMd: string;
 *   identityMd?: string;
 *   agentsMd?: string;
 *   userMd?: string;
 *   toolsMd?: string;
 *   memoryMd?: string;
 *   studioCfg?: unknown;
 * }} meta
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
  // Write optional workspace files if provided
  const agentsMd = typeof meta.agentsMd === "string" ? meta.agentsMd.trim() : "";
  if (agentsMd) {
    writeFileAtomic(
      path.join(workspaceDir, AGENTS_FILE),
      agentsMd.endsWith("\n") ? agentsMd : `${agentsMd}\n`,
    );
  }
  const combinedUserMd = composeWorkspaceUserMd(meta.studioCfg, meta.userMd);
  if (combinedUserMd) {
    writeFileAtomic(
      path.join(workspaceDir, USER_FILE),
      combinedUserMd.endsWith("\n") ? combinedUserMd : `${combinedUserMd}\n`,
    );
  }
  const toolsMd = typeof meta.toolsMd === "string" ? meta.toolsMd.trim() : "";
  if (toolsMd) {
    writeFileAtomic(
      path.join(workspaceDir, TOOLS_FILE),
      toolsMd.endsWith("\n") ? toolsMd : `${toolsMd}\n`,
    );
  }
  const memoryMd = typeof meta.memoryMd === "string" ? meta.memoryMd.trim() : "";
  if (memoryMd) {
    writeFileAtomic(
      path.join(workspaceDir, MEMORY_FILE),
      memoryMd.endsWith("\n") ? memoryMd : `${memoryMd}\n`,
    );
  }
  unlinkLegacyFileIfDistinct(workspaceDir, SOUL_FILE, "soul.md");
  unlinkLegacyFileIfDistinct(workspaceDir, IDENTITY_FILE, "identity.md");
}

/**
 * Refresh USER.md on an agent workspace from Studio global profile + existing agent notes.
 * @param {string} workspaceDir
 * @param {unknown} studioCfg
 */
function syncWorkspaceUserMdFromStudio(workspaceDir, studioCfg) {
  if (!workspaceDir || !fs.existsSync(workspaceDir)) return false;
  const existing = readTextIfExists(path.join(workspaceDir, USER_FILE)) ?? "";
  // Prefer agent-local notes already on disk when re-syncing profile-only updates.
  // Strip a previously written "# About the user" block so we do not stack duplicates.
  const withoutAbout = existing.replace(/^# About the user[\s\S]*?(?=\n# |\n*$)/, "").trim();
  const next = composeWorkspaceUserMd(studioCfg, withoutAbout);
  const target = path.join(workspaceDir, USER_FILE);
  if (!next) {
    if (!existing) return false;
    try {
      fs.unlinkSync(target);
      return true;
    } catch {
      return false;
    }
  }
  const body = next.endsWith("\n") ? next : `${next}\n`;
  if (existing === body) return false;
  writeFileAtomic(target, body);
  return true;
}

/**
 * @param {string} stateDir
 * @param {string} gatewayAgentId
 * @param {{ name: string; description: string; avatar: string; soulMd?: string; identityMd?: string; agentsMd?: string; userMd?: string; toolsMd?: string; memoryMd?: string; isMain?: boolean }} meta
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

/** @param {string} stateDir @param {string} gatewayAgentId */
function removeAgentDirectory(stateDir, gatewayAgentId) {
  const idNorm = normalizeAgentId(gatewayAgentId);
  if (!idNorm) return { ok: false, reason: "missing_agent_id" };
  const agentsRoot = path.resolve(stateDir, "agents");
  const agentRoot = path.resolve(agentsRoot, idNorm);
  if (!agentRoot.startsWith(`${agentsRoot}${path.sep}`)) {
    return { ok: false, reason: "invalid_agent_path" };
  }
  if (!fs.existsSync(agentRoot)) return { ok: true, removed: false, agentRoot };
  try {
    fs.rmSync(agentRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    return {
      ok: false,
      reason: "disk_remove_failed",
      error: String(/** @type {any} */ (err)?.message ?? err),
      agentRoot,
    };
  }
  if (fs.existsSync(agentRoot)) {
    return { ok: false, reason: "disk_remove_failed", error: "path_still_exists", agentRoot };
  }
  return { ok: true, removed: true, agentRoot };
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
  const agentsMd = typeof p.agentsMd === "string" ? p.agentsMd : "";
  const userMd = typeof p.userMd === "string" ? p.userMd : "";
  const toolsMd = typeof p.toolsMd === "string" ? p.toolsMd : "";
  const memoryMd = typeof p.memoryMd === "string" ? p.memoryMd : "";
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

  writeAgentWorkspaceFiles(workspaceDir, {
    name,
    description,
    avatar,
    soulMd,
    identityMd,
    agentsMd,
    userMd,
    toolsMd,
    memoryMd,
    studioCfg,
  });

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
  const listRemoved = next.length !== list.length;
  if (listRemoved) {
    if (!cfg.agents || typeof cfg.agents !== "object") cfg.agents = {};
    /** @type {{ list?: unknown }} */ (cfg.agents).list = next;
    writeFileAtomic(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  }

  // Always attempt disk cleanup — even when the registry entry was already missing.
  const disk = removeAgentDirectory(stateDir, idNorm);
  if (!disk.ok) {
    return {
      ok: false,
      reason: disk.reason || "disk_remove_failed",
      error: disk.error,
      listRemoved,
      needsGatewayRestart: listRemoved,
      disk,
    };
  }

  const removed = listRemoved || Boolean(disk.removed);
  return {
    ok: true,
    removed,
    alreadyGone: !removed,
    listRemoved,
    needsGatewayRestart: listRemoved,
    disk,
  };
}

/**
 * @param {unknown} payload
 * @param {unknown} studioCfg
 * @returns {{
 *   ok: boolean;
 *   reason?: string;
 *   keep?: Set<string>;
 *   stateDir?: string;
 *   cfgPath?: string;
 *   cfg?: Record<string, unknown>;
 *   orphanIds?: string[];
 *   nextList?: unknown[];
 * }}
 */
function resolveOrphanOpenClawAgents(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const keepRaw = Array.isArray(p.keepGatewayAgentIds) ? p.keepGatewayAgentIds : [];
  /** @type {Set<string>} */
  const keep = new Set();
  for (const raw of keepRaw) {
    const id = normalizeAgentId(raw);
    if (id) keep.add(id);
  }
  const mainId = defaultGatewayAgentIdFromConfig(studioCfg);
  if (mainId) keep.add(mainId);

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
  /** @type {string[]} */
  const orphanIds = [];
  /** @type {unknown[]} */
  const nextList = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = normalizeAgentId(/** @type {{ id?: unknown }} */ (entry).id);
    if (!id || keep.has(id)) {
      nextList.push(entry);
      continue;
    }
    orphanIds.push(id);
  }

  return { ok: true, keep, stateDir, cfgPath, cfg, orphanIds, nextList };
}

/**
 * Drop gateway registry + disk trees for agents that Studio no longer keeps.
 * Never removes the configured main/default agent.
 *
 * @param {unknown} payload `{ keepGatewayAgentIds: string[] }`
 * @param {unknown} studioCfg
 */
function pruneOrphanOpenClawAgents(payload, studioCfg) {
  const resolved = resolveOrphanOpenClawAgents(payload, studioCfg);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { stateDir, cfgPath, cfg, orphanIds, nextList } = resolved;
  if (!orphanIds.length) {
    return { ok: true, removed: [], pruned: 0, needsGatewayRestart: false };
  }

  if (!cfg.agents || typeof cfg.agents !== "object") cfg.agents = {};
  /** @type {{ list?: unknown }} */ (cfg.agents).list = nextList;
  writeFileAtomic(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

  /** @type {unknown[]} */
  const disks = [];
  for (const id of orphanIds) {
    disks.push(removeAgentDirectory(stateDir, id));
  }

  return {
    ok: true,
    removed: orphanIds,
    pruned: orphanIds.length,
    needsGatewayRestart: true,
    disks,
  };
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
 * Read AGENTS.md from agent workspace
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function readAgentAgentsMd(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const workspaceDir = agentWorkspaceDir(stateDir, gatewayAgentId);
  const agentsPath = path.join(workspaceDir, AGENTS_FILE);
  const agentsMd = readTextIfExists(agentsPath);
  if (agentsMd == null) return { ok: false, reason: "agents_not_found", agentsPath };
  return { ok: true, agentsMd, agentsPath };
}

/**
 * Read USER.md from agent workspace
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function readAgentUserMd(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const workspaceDir = agentWorkspaceDir(stateDir, gatewayAgentId);
  const userPath = path.join(workspaceDir, USER_FILE);
  const userMd = readTextIfExists(userPath);
  if (userMd == null) return { ok: false, reason: "user_not_found", userPath };
  return { ok: true, userMd, userPath };
}

/**
 * Read TOOLS.md from agent workspace
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function readAgentToolsMd(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const workspaceDir = agentWorkspaceDir(stateDir, gatewayAgentId);
  const toolsPath = path.join(workspaceDir, TOOLS_FILE);
  const toolsMd = readTextIfExists(toolsPath);
  if (toolsMd == null) return { ok: false, reason: "tools_not_found", toolsPath };
  return { ok: true, toolsMd, toolsPath };
}

/**
 * Read MEMORY.md from agent workspace
 * @param {unknown} payload
 * @param {unknown} studioCfg
 */
function readAgentMemoryMd(payload, studioCfg) {
  const p = payload && typeof payload === "object" ? payload : {};
  const gatewayAgentId = normalizeAgentId(p.gatewayAgentId);
  const oc = studioCfg?.openclaw && typeof studioCfg.openclaw === "object" ? studioCfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  if (!gatewayBaseUrl) return { ok: false, reason: "missing_gateway_base_url" };

  const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
  const workspaceDir = agentWorkspaceDir(stateDir, gatewayAgentId);
  const memoryPath = path.join(workspaceDir, MEMORY_FILE);
  const memoryMd = readTextIfExists(memoryPath);
  if (memoryMd == null) return { ok: false, reason: "memory_not_found", memoryPath };
  return { ok: true, memoryMd, memoryPath };
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
  removeAgentDirectory,
  provisionOpenClawAgent,
  removeOpenClawAgent,
  resolveOrphanOpenClawAgents,
  pruneOrphanOpenClawAgents,
  readAgentSoulMd,
  readAgentIdentityMd,
  readAgentAgentsMd,
  readAgentUserMd,
  readAgentToolsMd,
  readAgentMemoryMd,
  readAgentSoulForChat,
  readAgentBootstrapForChat,
  defaultSoulMd,
  SOUL_FILE,
  IDENTITY_FILE,
  AGENTS_FILE,
  USER_FILE,
  TOOLS_FILE,
  MEMORY_FILE,
  buildGlobalUserMd,
  composeWorkspaceUserMd,
  syncWorkspaceUserMdFromStudio,
};
