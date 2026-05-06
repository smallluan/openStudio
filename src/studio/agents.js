import { AgentMode } from "./modes.js";
import { getZoneById, pickZoneIdForMode } from "./zones.js";

/**
 * @typedef {object} LobsterOpenclawBinding
 * @property {string} [sessionKey]
 */

/**
 * @typedef {object} LobsterAgent
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} skillIds
 * @property {import("./modes.js").AgentModeValue} mode
 * @property {string} zoneId
 * @property {number} agentSlot
 * @property {LobsterOpenclawBinding} [openclaw]
 */

const MODE_SET = new Set(Object.values(AgentMode));

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
  return agentDefaults({
    id,
    name: typeof r.name === "string" ? r.name : "",
    description: typeof r.description === "string" ? r.description : "",
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
  return {
    id: o.id ?? "lobster-1",
    name: o.name ?? "",
    description: typeof o.description === "string" ? o.description : "",
    skillIds,
    mode,
    zoneId,
    agentSlot: o.agentSlot ?? 0,
    openclaw: o.openclaw && typeof o.openclaw === "object" ? o.openclaw : {},
  };
}

/** 初始演示数据：单虾；阶段 B 改为自配置文件或 IPC */
export function createInitialAgents() {
  return [agentDefaults({ id: "lobster-1", mode: AgentMode.IDLE })];
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
