import { createInitialAgents, normalizeLobsterAgent } from "./agents.js";

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

/** @returns {import("./agents.js").LobsterAgent[]} */
export function loadAgents() {
  try {
    const raw = localStorage.getItem(AGENTS_STORAGE_KEY);
    if (raw == null) return createInitialAgents();
    const data = JSON.parse(raw);
    if (!Array.isArray(data.agents)) return createInitialAgents();
    return data.agents.map(normalizeLobsterAgent).filter(Boolean);
  } catch {
    return createInitialAgents();
  }
}
