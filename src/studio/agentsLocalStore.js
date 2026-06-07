import {
  createInitialAgents,
  MAIN_AGENT_STUDIO_ID,
  normalizeLobsterAgent,
} from "./agents.js";

/** Same-tab saves must NOT broadcast a synthetic event here — listeners calling setAgents + save create an infinite loop. Other tabs sync via `storage`. */
export const AGENTS_STORAGE_KEY = "openstudio_agents_v1";

/** @param {import("./agents.js").LobsterAgent[]} agents */
export function saveAgents(agents) {
  try {
    localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify({ agents }));
  } catch {
    /* quota / private mode */
  }
}

/** @param {import("./agents.js").LobsterAgent[]} agents */
function ensureMainAgent(agents) {
  if (!agents.length) return createInitialAgents();
  if (agents.some((a) => a.isMain)) return agents;
  const [first, ...rest] = agents;
  return [{ ...first, isMain: true, id: first.id === "lobster-1" ? MAIN_AGENT_STUDIO_ID : first.id }, ...rest];
}

/** @returns {import("./agents.js").LobsterAgent[]} */
export function loadAgents() {
  try {
    const raw = localStorage.getItem(AGENTS_STORAGE_KEY);
    if (raw == null) return createInitialAgents();
    const data = JSON.parse(raw);
    if (!Array.isArray(data.agents)) return createInitialAgents();
    const normalized = data.agents.map(normalizeLobsterAgent).filter(Boolean);
    return ensureMainAgent(normalized);
  } catch {
    return createInitialAgents();
  }
}
