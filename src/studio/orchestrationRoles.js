/** @typedef {'main' | 'pm' | 'fe' | 'be' | 'reviewer' | ''} OrchestrationRoleValue */

export const OrchestrationRole = /** @type {const} */ ({
  MAIN: "main",
  PM: "pm",
  FE: "fe",
  BE: "be",
  REVIEWER: "reviewer",
  NONE: "",
});

/** @type {Set<string>} */
const ROLE_SET = new Set(Object.values(OrchestrationRole));

/**
 * @param {unknown} raw
 * @returns {OrchestrationRoleValue}
 */
export function normalizeOrchestrationRole(raw) {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (ROLE_SET.has(v)) return /** @type {OrchestrationRoleValue} */ (v);
  return OrchestrationRole.NONE;
}

/** @param {OrchestrationRoleValue} role @param {(key: string) => string} t */
export function orchestrationRoleLabel(role, t) {
  switch (role) {
    case OrchestrationRole.MAIN:
      return t("orchestration.roles.main");
    case OrchestrationRole.PM:
      return t("orchestration.roles.pm");
    case OrchestrationRole.FE:
      return t("orchestration.roles.fe");
    case OrchestrationRole.BE:
      return t("orchestration.roles.be");
    case OrchestrationRole.REVIEWER:
      return t("orchestration.roles.reviewer");
    default:
      return t("orchestration.roles.none");
  }
}

/**
 * Fallback when orchestrationRole is unset — match common display names (e.g. 产品经理).
 * @param {import("./agents.js").LobsterAgent} agent
 * @returns {OrchestrationRoleValue}
 */
export function inferOrchestrationRoleFromMeta(agent) {
  const text = `${agent.name ?? ""} ${agent.description ?? ""}`.toLowerCase();
  if (/产品经理|产品\s*经理|product\s*manager|\bpm\b/.test(text)) return OrchestrationRole.PM;
  if (/前端|frontend|\bfe\b|front[-\s]?end/.test(text)) return OrchestrationRole.FE;
  if (/后端|backend|\bbe\b|back[-\s]?end/.test(text)) return OrchestrationRole.BE;
  if (/review|代码审查|代码\s*review|.reviewer/.test(text)) return OrchestrationRole.REVIEWER;
  return OrchestrationRole.NONE;
}

/**
 * @param {import("./agents.js").LobsterAgent} agent
 * @returns {OrchestrationRoleValue}
 */
export function orchestrationRoleForAgent(agent) {
  if (agent.isMain) return OrchestrationRole.MAIN;
  const configured = normalizeOrchestrationRole(agent.orchestrationRole);
  if (configured !== OrchestrationRole.NONE) return configured;
  return inferOrchestrationRoleFromMeta(agent);
}

/**
 * Session pool for orchestration: main + this thread's participant bar + @mentions only.
 * Agents must be explicitly added to the conversation — never pull in every role-tagged agent studio-wide.
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ mainAgent?: import("./agents.js").LobsterAgent | null; participantIds?: string[]; mentionIds?: string[] }} opts
 * @returns {string[]}
 */
export function orchestrationParticipantIds(agents, opts = {}) {
  void agents;
  const mainAgent = opts.mainAgent ?? null;
  const ids = new Set();
  if (mainAgent?.id) ids.add(mainAgent.id);
  for (const id of opts.participantIds ?? []) {
    if (id) ids.add(id);
  }
  for (const id of opts.mentionIds ?? []) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {OrchestrationRoleValue} role
 * @param {{ participantIds?: string[]; mentionIds?: string[]; mainAgent?: import("./agents.js").LobsterAgent | null }} opts
 * @returns {import("./agents.js").LobsterAgent[]}
 */
export function agentsByOrchestrationRole(agents, role, opts = {}) {
  const mainAgent = opts.mainAgent ?? null;
  const poolIds = new Set(orchestrationParticipantIds(agents, opts));
  const pool = agents.filter((a) => poolIds.has(a.id));
  if (role === OrchestrationRole.MAIN) {
    return mainAgent ? [mainAgent] : pool.filter((a) => a.isMain);
  }
  return pool.filter((a) => orchestrationRoleForAgent(a) === role);
}
