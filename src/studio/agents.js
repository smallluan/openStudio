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
 * @property {import("./modes.js").AgentModeValue} mode
 * @property {string} zoneId
 * @property {number} agentSlot
 * @property {LobsterOpenclawBinding} [openclaw]
 */

/** @param {Partial<LobsterAgent>} o */
function agentDefaults(o) {
  const mode = o.mode ?? AgentMode.IDLE;
  const zoneId = o.zoneId ?? pickZoneIdForMode(mode);
  return {
    id: o.id ?? "lobster-1",
    name: o.name ?? "龙虾一号",
    mode,
    zoneId,
    agentSlot: o.agentSlot ?? 0,
    openclaw: o.openclaw ?? {},
  };
}

/** 初始演示数据：单虾；阶段 B 改为自配置文件或 IPC */
export function createInitialAgents() {
  return [agentDefaults({ id: "lobster-1", name: "龙虾一号", mode: AgentMode.IDLE })];
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
