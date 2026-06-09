"use strict";

/** @typedef {'main' | 'pm' | 'fe' | 'be' | 'reviewer' | ''} OrchestrationRoleValue */

/** @typedef {import('./core.cjs').OrchestrationTask} OrchestrationTask */

/**
 * @typedef {object} LobsterAgent
 * @property {string} id
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [gatewayAgentId]
 * @property {boolean} [isMain]
 * @property {OrchestrationRoleValue} [orchestrationRole]
 * @property {string} [orchestrationDomain]
 */

const OrchestrationRole = {
  MAIN: "main",
  PM: "pm",
  FE: "fe",
  BE: "be",
  REVIEWER: "reviewer",
  NONE: "",
};

const ROLE_SET = new Set(Object.values(OrchestrationRole));

function normalizeOrchestrationRole(raw) {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (ROLE_SET.has(v)) return /** @type {OrchestrationRoleValue} */ (v);
  return OrchestrationRole.NONE;
}

function orchestrationRoleLabel(role, t) {
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

function inferOrchestrationRoleFromMeta(agent) {
  const text = `${agent.name ?? ""} ${agent.description ?? ""}`.toLowerCase();
  if (/产品经理|产品\s*经理|product\s*manager|\bpm\b/.test(text)) return OrchestrationRole.PM;
  if (/前端|frontend|\bfe\b|front[-\s]?end/.test(text)) return OrchestrationRole.FE;
  if (/后端|backend|\bbe\b|back[-\s]?end/.test(text)) return OrchestrationRole.BE;
  if (/review|代码审查|代码\s*review|.reviewer/.test(text)) return OrchestrationRole.REVIEWER;
  return OrchestrationRole.NONE;
}

function orchestrationRoleForAgent(agent) {
  if (agent.isMain) return OrchestrationRole.MAIN;
  const configured = normalizeOrchestrationRole(agent.orchestrationRole);
  if (configured !== OrchestrationRole.NONE) return configured;
  return inferOrchestrationRoleFromMeta(agent);
}

function orchestrationParticipantIds(agents, opts = {}) {
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

function agentsByOrchestrationRole(agents, role, opts = {}) {
  const mainAgent = opts.mainAgent ?? null;
  const poolIds = new Set(orchestrationParticipantIds(agents, opts));
  const pool = agents.filter((a) => poolIds.has(a.id));
  if (role === OrchestrationRole.MAIN) {
    return mainAgent ? [mainAgent] : pool.filter((a) => a.isMain);
  }
  return pool.filter((a) => orchestrationRoleForAgent(a) === role);
}

/**
 * Simple capability score: overlap between task text and agent metadata.
 * @param {LobsterAgent} agent
 * @param {string} taskText
 */
function matchAgentCapability(agent, taskText) {
  const hay = String(taskText ?? "").toLowerCase();
  if (!hay.trim()) return 0;
  const parts = [
    agent.name,
    agent.description,
    agent.orchestrationDomain,
    agent.gatewayAgentId,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  let score = 0;
  for (const part of parts) {
    const tokens = part.split(/[\s,，、/|]+/).filter((t) => t.length >= 2);
    for (const tok of tokens) {
      if (hay.includes(tok)) score += 2;
    }
    if (hay.includes(part) && part.length >= 3) score += 3;
  }
  return score;
}

module.exports = {
  OrchestrationRole,
  normalizeOrchestrationRole,
  orchestrationRoleLabel,
  inferOrchestrationRoleFromMeta,
  orchestrationRoleForAgent,
  orchestrationParticipantIds,
  agentsByOrchestrationRole,
  matchAgentCapability,
};
