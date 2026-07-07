import { AgentMode } from "./modes.js";
import { normalizeOrchestrationRole } from "./orchestrationRoles.js";
import { getZoneById, pickZoneIdForMode } from "./zones.js";

/**
 * @typedef {object} LobsterOpenclawBinding
 * @property {string} [sessionKey]
 */

/**
 * @typedef {object} LobsterAgent
 * @property {string} id
 * @property {string} gatewayAgentId
 * @property {string} name
 * @property {string} description
 * @property {string} avatar
 * @property {string} soulMd
 * @property {string} identityMd
 * @property {boolean} [isMain]
 * @property {string[]} skillIds
 * @property {import("./modes.js").AgentModeValue} mode
 * @property {string} zoneId
 * @property {number} agentSlot
 * @property {LobsterOpenclawBinding} [openclaw]
 * @property {import("./orchestrationRoles.js").OrchestrationRoleValue} [orchestrationRole]
 * @property {string} [orchestrationDomain]
 */

const MODE_SET = new Set(Object.values(AgentMode));
export const MAIN_AGENT_STUDIO_ID = "agent-main";

/** @param {string} value */
export function slugifyGatewayAgentId(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "agent";
  const slug = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 48);
  return slug || "agent";
}

/** @param {string} gatewayAgentId */
export function sessionKeyForGatewayAgentId(gatewayAgentId) {
  const id = slugifyGatewayAgentId(gatewayAgentId);
  if (id === "dev") return "agent:dev:dev";
  return `agent:${id}:main`;
}

/** @param {Partial<LobsterAgent>} agent */
export function sessionKeyForAgent(agent) {
  const fromBinding = agent.openclaw?.sessionKey?.trim();
  if (fromBinding) return fromBinding;
  return sessionKeyForGatewayAgentId(agent.gatewayAgentId || "main");
}

/** @param {LobsterAgent} agent */
export function agentDisplayLabel(agent) {
  return agent.name?.trim() || agent.gatewayAgentId || "Agent";
}

/** @param {LobsterAgent} agent */
export function agentAvatarGlyph(agent) {
  const av = String(agent.avatar ?? "").trim();
  // 支持 URL 或图片路径（检测是否是 URL/路径而非 emoji）
  if (av && (av.startsWith("http") || av.startsWith("/") || av.startsWith("data:") || av.startsWith("file:"))) {
    return av; // 返回完整 URL/路径
  }
  // 如果是 emoji（长度较短且不含空格），返回空字符串以使用文字头像
  if (av && av.length <= 4 && !av.includes(" ")) {
    return ""; // emoji 不再使用
  }
  // 返回空字符串，触发文字头像
  return "";
}

/** @param {{ name?: string; description?: string; avatar?: string }} meta */
export function buildIdentityMd(meta) {
  const name = String(meta.name ?? "").trim() || "Agent";
  const vibe = String(meta.description ?? "").trim() || "Helpful specialist";
  const avatar = String(meta.avatar ?? "").trim();
  // 如果 avatar 是 URL/路径，添加 Avatar 字段；否则不显示
  const avatarLine = avatar && (avatar.startsWith("http") || avatar.startsWith("/") || avatar.startsWith("data:"))
    ? `- **Avatar:** ${avatar}`
    : "";
  return [
    "# IDENTITY.md - Who Am I?",
    "",
    `- **Name:** ${name}`,
    `- **Creature:** AI assistant`,
    `- **Vibe:** ${vibe}`,
    avatarLine,
  ].filter(Boolean).join("\n");
}

/** @param {string} identityMd */
export function parseIdentityNameFromMd(identityMd) {
  const m = /\*\*Name:\*\*\s*(.+)/i.exec(String(identityMd ?? ""));
  return m?.[1]?.trim() ?? "";
}

/** @param {LobsterAgent} agent */
export function identityBlockForAgent(agent) {
  const custom = String(agent.identityMd ?? "").trim();
  if (custom) return custom;
  return buildIdentityMd(agent);
}

/** @param {LobsterAgent} agent */
export function resolvedAgentName(agent) {
  return parseIdentityNameFromMd(identityBlockForAgent(agent)) || agentDisplayLabel(agent);
}

/**
 * @param {{ agents: LobsterAgent[]; mainAgent: LobsterAgent | null; participantIds?: string[] }} args
 * @returns {LobsterAgent[]}
 */
export function groupAgentsInSession({ agents, mainAgent, participantIds }) {
  const ids = new Set();
  if (mainAgent?.id) ids.add(mainAgent.id);
  for (const id of participantIds ?? []) {
    if (id) ids.add(id);
  }
  return agents.filter((a) => ids.has(a.id));
}

/**
 * OpenClaw loads IDENTITY.md (who) and SOUL.md (how) separately — keep both in the system row.
 * @param {LobsterAgent} agent
 * @param {string} [fallbackSystemPrompt]
 * @param {{ groupAgents?: LobsterAgent[]; orchestrationTeamRoster?: string; groupDelegateHint?: string; studioSuffix?: string }} [opts]
 * @returns {{ role: "system"; content: string } | null}
 */
export function systemMessageForAgent(agent, fallbackSystemPrompt, opts = {}) {
  const identity = identityBlockForAgent(agent);
  const agentName = resolvedAgentName(agent);
  const others = (opts.groupAgents ?? []).filter((a) => a.id !== agent.id);
  const groupBlock =
    others.length > 0
      ? [
          "",
          "## Group chat",
          "You share this thread with these **separate** agents (not you):",
          ...others.map((a) => `- **${resolvedAgentName(a)}** (${agentDisplayLabel(a)})`),
          "Their messages appear as `Agent · Name` in the UI; in your context they arrive as user lines prefixed `[群聊 · Name]`.",
          "Lines prefixed `[You · …]` are your own earlier messages in this thread.",
          "Lines prefixed `[群聊 · 系统]` report teammates joining or leaving — trust them over older chat when judging who is still in the room.",
          "When a teammate @mentions you, reply as **yourself** only — never copy their introduction or claim their name/role.",
          "When the user asks about them, answer from that chat history first — do not search memory to learn who they are.",
        ].join("\n")
      : "";
  const delegateBlock =
    others.length > 0 && opts.groupDelegateHint?.trim()
      ? ["", "## @mentioning teammates", opts.groupDelegateHint.trim()].join("\n")
      : "";
  const orchBlock = opts.orchestrationTeamRoster?.trim()
    ? ["", "## Orchestration team", opts.orchestrationTeamRoster.trim()].join("\n")
    : "";
  const identityLock = [
    "",
    "## Session rules",
    `- You are **${agentName}** only. Never claim you spoke under another agent's name.`,
    "- `[群聊 · …]` lines are **other agents** speaking to you — not your prior replies.",
    "- `[群聊 · 系统]` lines are **membership notices** (join/leave) — authoritative for who is in the room.",
    "- `[You · …]` lines are **your** earlier messages in this thread.",
    "- If the latest `[群聊 · …]` line @mentions you, answer that request in your own voice.",
  ].join("\n");
  const studioSuffix = String(opts.studioSuffix ?? "").trim();
  /** @param {string} content */
  const withStudioSuffix = (content) => (studioSuffix ? `${content}\n\n${studioSuffix}` : content);
  const soul = String(agent.soulMd ?? "").trim();
  if (soul) {
    return {
      role: "system",
      content: withStudioSuffix(
        `${identity}${groupBlock}${delegateBlock}${orchBlock}${identityLock}\n\n# SOUL.md\n\n${soul}`,
      ),
    };
  }
  if (agent.isMain && fallbackSystemPrompt?.trim()) {
    return {
      role: "system",
      content: withStudioSuffix(
        `${identity}${groupBlock}${delegateBlock}${orchBlock}${identityLock}\n\n${fallbackSystemPrompt.trim()}`,
      ),
    };
  }
  return {
    role: "system",
    content: withStudioSuffix(`${identity}${groupBlock}${delegateBlock}${orchBlock}${identityLock}`),
  };
}

/**
 * @param {LobsterAgent[]} agents
 * @returns {LobsterAgent | null}
 */
export function findMainAgent(agents) {
  return agents.find((a) => a.isMain) ?? agents[0] ?? null;
}

/**
 * @param {unknown} raw
 * @returns {LobsterAgent | null}
 */
export function normalizeLobsterAgent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
  if (!id) return null;
  const modeCandidate = r.mode;
  const mode =
    typeof modeCandidate === "string" && MODE_SET.has(modeCandidate)
      ? /** @type {import("./modes.js").AgentModeValue} */ (modeCandidate)
      : AgentMode.IDLE;
  const oc = r.openclaw && typeof r.openclaw === "object" ? /** @type {Record<string, unknown>} */ (r.openclaw) : null;
  const sessionKey = oc && typeof oc.sessionKey === "string" ? oc.sessionKey : undefined;
  const gatewayAgentId =
    typeof r.gatewayAgentId === "string" && r.gatewayAgentId.trim()
      ? slugifyGatewayAgentId(r.gatewayAgentId)
      : id === MAIN_AGENT_STUDIO_ID
        ? "dev"
        : slugifyGatewayAgentId(typeof r.name === "string" ? r.name : id);
  return agentDefaults({
    id,
    gatewayAgentId,
    name: typeof r.name === "string" ? r.name : "",
    description: typeof r.description === "string" ? r.description : "",
    avatar: typeof r.avatar === "string" ? r.avatar : "",
    soulMd: typeof r.soulMd === "string" ? r.soulMd : "",
    identityMd: typeof r.identityMd === "string" ? r.identityMd : "",
    isMain: Boolean(r.isMain) || id === MAIN_AGENT_STUDIO_ID,
    skillIds: Array.isArray(r.skillIds) ? r.skillIds.filter((x) => typeof x === "string") : [],
    mode,
    zoneId: typeof r.zoneId === "string" && r.zoneId ? r.zoneId : undefined,
    agentSlot: Number.isFinite(r.agentSlot) ? Math.floor(Number(r.agentSlot)) : undefined,
    openclaw: sessionKey != null && sessionKey !== "" ? { sessionKey } : {},
    orchestrationRole: normalizeOrchestrationRole(r.orchestrationRole),
    orchestrationDomain: typeof r.orchestrationDomain === "string" ? r.orchestrationDomain.trim().slice(0, 120) : "",
  });
}

/** @param {Partial<LobsterAgent>} o */
function agentDefaults(o) {
  const mode = o.mode ?? AgentMode.IDLE;
  const zoneId = o.zoneId ?? pickZoneIdForMode(mode);
  const skillIds = Array.isArray(o.skillIds) ? o.skillIds.filter((x) => typeof x === "string") : [];
  const gatewayAgentId = slugifyGatewayAgentId(o.gatewayAgentId ?? o.name ?? o.id ?? "agent");
  const openclaw = o.openclaw && typeof o.openclaw === "object" ? { ...o.openclaw } : {};
  if (!openclaw.sessionKey) openclaw.sessionKey = sessionKeyForGatewayAgentId(gatewayAgentId);
  return {
    id: o.id ?? "lobster-1",
    gatewayAgentId,
    name: o.name ?? "",
    description: typeof o.description === "string" ? o.description : "",
    avatar: typeof o.avatar === "string" ? o.avatar : "",
    soulMd: typeof o.soulMd === "string" ? o.soulMd : "",
    identityMd: typeof o.identityMd === "string" ? o.identityMd : "",
    isMain: Boolean(o.isMain),
    skillIds,
    mode,
    zoneId,
    agentSlot: o.agentSlot ?? 0,
    openclaw,
    orchestrationRole: normalizeOrchestrationRole(o.orchestrationRole),
    orchestrationDomain:
      typeof o.orchestrationDomain === "string" ? o.orchestrationDomain.trim().slice(0, 120) : "",
  };
}

/** Built-in main agent + demo slot for studio canvas. */
export function createInitialAgents() {
  return [
    agentDefaults({
      id: MAIN_AGENT_STUDIO_ID,
      gatewayAgentId: "dev",
      name: "",
      description: "",
      avatar: "",
      isMain: true,
      mode: AgentMode.IDLE,
    }),
  ];
}

/**
 * @param {LobsterAgent} agent
 * @param {import("./modes.js").AgentModeValue} mode
 * @returns {LobsterAgent}
 */
export function agentWithMode(agent, mode) {
  const zoneId = pickZoneIdForMode(mode);
  return { ...agent, mode, zoneId };
}

/**
 * @param {LobsterAgent} agent
 * @returns {import("./zones.js").NormPoint | null}
 */
export function anchorForAgent(agent) {
  const zone = getZoneById(agent.zoneId);
  if (!zone?.defaultAnchors?.length) return null;
  const idx = Math.min(agent.agentSlot, zone.defaultAnchors.length - 1);
  return zone.defaultAnchors[idx] ?? zone.defaultAnchors[0];
}

/**
 * @param {string} name
 * @param {LobsterAgent[]} existing
 * @returns {string}
 */
export function uniqueGatewayAgentIdForName(name, existing) {
  const base = slugifyGatewayAgentId(name);
  const taken = new Set(existing.map((a) => a.gatewayAgentId));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`.slice(0, 48);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}
