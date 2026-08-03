import { AgentMode } from "./modes.js";
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
 * @property {string} agentsMd
 * @property {string} userMd
 * @property {string} toolsMd
 * @property {string} memoryMd
 * @property {boolean} [isMain]
 * @property {string[]} skillIds
 * @property {import("./modes.js").AgentModeValue} mode
 * @property {string} zoneId
 * @property {number} agentSlot
 * @property {LobsterOpenclawBinding} [openclaw]
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

/** @param {string | null | undefined} src */
export function isAgentAvatarImageSrc(src) {
  const av = String(src ?? "").trim();
  return (
    av.startsWith("http") ||
    av.startsWith("/") ||
    av.startsWith("data:") ||
    av.startsWith("file:")
  );
}

/** @param {LobsterAgent} agent */
export function agentAvatarGlyph(agent) {
  const av = String(agent.avatar ?? "").trim();
  // 支持 URL 或图片路径（检测是否是 URL/路径而非 emoji）
  if (av && isAgentAvatarImageSrc(av)) {
    return av; // 返回完整 URL/路径
  }
  // 如果是 emoji（长度较短且不含空格），返回空字符串以使用文字头像
  if (av && av.length <= 4 && !av.includes(" ")) {
    return ""; // emoji 不再使用
  }
  // 返回空字符串，触发文字头像
  return "";
}

/** @param {{ displayName?: string; avatar?: string } | null | undefined} profile */
export function userProfileDisplayLabel(profile, fallback = "User") {
  return String(profile?.displayName ?? "").trim() || fallback;
}

/** @param {{ avatar?: string } | null | undefined} profile */
export function userProfileAvatarGlyph(profile) {
  const av = String(profile?.avatar ?? "").trim();
  if (av && isAgentAvatarImageSrc(av)) return av;
  return "";
}

/**
 * Avatars are for the Studio UI only. Never put `data:` / `file:` image payloads into
 * LLM-bound USER.md / IDENTITY.md — a JPEG data URL is tens of thousands of tokens of
 * useless base64 and is a common cause of early context overflow.
 *
 * @param {string | undefined | null} avatar
 * @returns {string} Short http(s) URL suitable for model context, or empty.
 */
export function avatarRefForLlmContext(avatar) {
  const av = String(avatar ?? "").trim();
  if (!av) return "";
  if (/^data:/i.test(av) || /^file:/i.test(av) || /^blob:/i.test(av)) return "";
  if (/^https?:\/\//i.test(av) && av.length <= 512) return av;
  return "";
}

/** @param {{ displayName?: string; avatar?: string; gender?: string; userMd?: string } | null | undefined} profile */
export function buildGlobalUserMd(profile) {
  if (!profile || typeof profile !== "object") return "";
  const displayName = String(profile.displayName ?? "").trim();
  const gender =
    profile.gender === "male" ? "Male" : profile.gender === "female" ? "Female" : profile.gender === "secret" ? "Prefer not to say" : "";
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

/** @param {{ name?: string; description?: string; avatar?: string }} meta */
export function buildIdentityMd(meta) {
  const name = String(meta.name ?? "").trim() || "Agent";
  const vibe = String(meta.description ?? "").trim() || "Helpful specialist";
  const avatarRef = avatarRefForLlmContext(meta.avatar);
  const avatarLine = avatarRef ? `- **Avatar:** ${avatarRef}` : "";
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
 * Build the Studio system row for a gateway turn.
 *
 * Default (`includeWorkspacePersona: false`): only Studio UI / group-session rules.
 * OpenClaw already injects SOUL.md / IDENTITY.md / USER.md from the agent workspace —
 * re-pasting them into every `chat.send` duplicates tens of KB into the gateway transcript.
 *
 * Pass `includeWorkspacePersona: true` only for rare offline/debug paths that must
 * carry persona without relying on OpenClaw bootstrap files.
 *
 * @param {LobsterAgent} agent
 * @param {string} [fallbackSystemPrompt]
 * @param {{
 *   groupAgents?: LobsterAgent[];
 *   groupDelegateHint?: string;
 *   studioSuffix?: string;
 *   globalUserProfile?: { displayName?: string; avatar?: string; gender?: string; userMd?: string };
 *   includeWorkspacePersona?: boolean;
 * }} [opts]
 * @returns {{ role: "system"; content: string } | null}
 */
export function systemMessageForAgent(agent, fallbackSystemPrompt, opts = {}) {
  const includeWorkspacePersona = opts.includeWorkspacePersona === true;
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
  const fallbackBlock = fallbackSystemPrompt?.trim()
    ? `\n\n# General Instructions\n\n${fallbackSystemPrompt.trim()}`
    : "";

  if (!includeWorkspacePersona) {
    const leanHead = [
      "# Studio UI session",
      `You are **${agentName}**. Long-form persona (SOUL.md / IDENTITY.md / USER.md) is loaded by OpenClaw from the agent workspace — it is intentionally not re-pasted on every Studio turn.`,
      groupBlock,
      delegateBlock,
      identityLock,
      fallbackBlock,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      role: "system",
      content: withStudioSuffix(leanHead),
    };
  }

  const soul = String(agent.soulMd ?? "").trim();
  const extraWorkspaceFiles = [];
  const agentsMd = String(agent.agentsMd ?? "").trim();
  if (agentsMd) extraWorkspaceFiles.push(`# AGENTS.md\n\n${agentsMd}`);
  const globalUserMd = buildGlobalUserMd(opts.globalUserProfile);
  const agentUserMd = String(agent.userMd ?? "").trim();
  const combinedUserMd =
    globalUserMd && agentUserMd
      ? `${globalUserMd}\n\n${agentUserMd}`
      : globalUserMd || agentUserMd;
  if (combinedUserMd) extraWorkspaceFiles.push(`# USER.md\n\n${combinedUserMd}`);
  const toolsMd = String(agent.toolsMd ?? "").trim();
  if (toolsMd) extraWorkspaceFiles.push(`# TOOLS.md\n\n${toolsMd}`);
  const memoryMd = String(agent.memoryMd ?? "").trim();
  if (memoryMd) extraWorkspaceFiles.push(`# MEMORY.md\n\n${memoryMd}`);
  const extraBlock = extraWorkspaceFiles.length ? `\n\n${extraWorkspaceFiles.join("\n\n")}` : "";
  if (soul) {
    return {
      role: "system",
      content: withStudioSuffix(
        `${identity}${groupBlock}${delegateBlock}${identityLock}\n\n# SOUL.md\n\n${soul}${extraBlock}${fallbackBlock}`,
      ),
    };
  }
  if (agent.isMain && fallbackSystemPrompt?.trim()) {
    return {
      role: "system",
      content: withStudioSuffix(
        `${identity}${groupBlock}${delegateBlock}${identityLock}${extraBlock}${fallbackBlock}`,
      ),
    };
  }
  return {
    role: "system",
    content: withStudioSuffix(`${identity}${groupBlock}${delegateBlock}${identityLock}${extraBlock}${fallbackBlock}`),
  };
}

/** Stable fingerprint for Studio UI system text (re-inject only when this changes). */
export function fingerprintStudioSystemContent(content) {
  const s = String(content ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
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
    agentsMd: typeof r.agentsMd === "string" ? r.agentsMd : "",
    userMd: typeof r.userMd === "string" ? r.userMd : "",
    toolsMd: typeof r.toolsMd === "string" ? r.toolsMd : "",
    memoryMd: typeof r.memoryMd === "string" ? r.memoryMd : "",
    isMain: Boolean(r.isMain) || id === MAIN_AGENT_STUDIO_ID,
    skillIds: Array.isArray(r.skillIds) ? r.skillIds.filter((x) => typeof x === "string") : [],
    mode,
    zoneId: typeof r.zoneId === "string" && r.zoneId ? r.zoneId : undefined,
    agentSlot: Number.isFinite(r.agentSlot) ? Math.floor(Number(r.agentSlot)) : undefined,
    openclaw: sessionKey != null && sessionKey !== "" ? { sessionKey } : {},
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
    agentsMd: typeof o.agentsMd === "string" ? o.agentsMd : "",
    userMd: typeof o.userMd === "string" ? o.userMd : "",
    toolsMd: typeof o.toolsMd === "string" ? o.toolsMd : "",
    memoryMd: typeof o.memoryMd === "string" ? o.memoryMd : "",
    isMain: Boolean(o.isMain),
    skillIds,
    mode,
    zoneId,
    agentSlot: o.agentSlot ?? 0,
    openclaw,
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
