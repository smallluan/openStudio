import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { agentWithMode } from "../studio/agents.js";
import {
  AGENTS_STORAGE_KEY,
  loadAgents,
  saveAgents,
} from "../studio/agentsLocalStore.js";
import { AgentMode } from "../studio/modes.js";

/** @typedef {import("../studio/agents.js").LobsterAgent} LobsterAgent */

/** @typedef {{
 *   agents: LobsterAgent[];
 *   setAgentMode: (agentId: string, mode: import("../studio/modes.js").AgentModeValue) => void;
 *   rotateDemoMode: () => void;
 *   addAgent: (partial?: { name?: string }) => string;
 *   removeAgent: (agentId: string) => void;
 *   patchAgentMeta: (agentId: string, patch: {
 *     name?: string;
 *     description?: string;
 *     skillIds?: string[];
 *     openclaw?: { sessionKey?: string };
 *   }) => void;
 * }} StudioApi */

const StudioContext = /** @type {import('react').Context<StudioApi | null>} */ (
  createContext(null)
);

function newAgentId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `lobster-${Date.now()}`;
}

export function StudioProvider({ children }) {
  const [agents, setAgents] = useState(loadAgents);

  useEffect(() => {
    saveAgents(agents);
  }, [agents]);

  useEffect(() => {
    /** Fires only for other tabs / windows; avoids same-tab save → reload → save loops */
    const onStorage = (e) => {
      if (e.key !== AGENTS_STORAGE_KEY || e.storageArea !== localStorage) return;
      setAgents(loadAgents());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAgentMode = useCallback((agentId, mode) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? agentWithMode(a, mode) : a))
    );
  }, []);

  /** 开发用：循环切换模式以验证分区映射 */
  const rotateDemoMode = useCallback(() => {
    const order = [
      AgentMode.IDLE,
      AgentMode.THINKING,
      AgentMode.WORKING,
      AgentMode.BREAK,
      AgentMode.ENTERTAINMENT,
    ];
    setAgents((prev) => {
      if (!prev[0]) return prev;
      const curIdx = order.indexOf(prev[0].mode);
      const nextMode = order[(curIdx + 1) % order.length];
      return prev.map((a, i) =>
        i === 0 ? agentWithMode(a, nextMode) : a
      );
    });
  }, []);

  const addAgent = useCallback((partial) => {
    const id = newAgentId();
    setAgents((prev) => {
      const next = agentWithMode(
        {
          id,
          name: partial?.name?.trim?.() ?? "",
          description: "",
          skillIds: [],
          mode: AgentMode.IDLE,
          zoneId: "lounge",
          agentSlot: prev.length,
          openclaw: {},
        },
        AgentMode.IDLE
      );
      return [...prev, next];
    });
    return id;
  }, []);

  const removeAgent = useCallback((agentId) => {
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
  }, []);

  const patchAgentMeta = useCallback((agentId, patch) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== agentId) return a;
        const next = { ...a };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.description !== undefined) next.description = patch.description;
        if (patch.skillIds !== undefined) next.skillIds = [...patch.skillIds];
        if (patch.openclaw !== undefined) {
          const merged = { ...a.openclaw, ...patch.openclaw };
          const sk = merged.sessionKey;
          if (typeof sk !== "string" || !sk.trim()) delete merged.sessionKey;
          else merged.sessionKey = sk.trim();
          next.openclaw = merged;
        }
        return next;
      })
    );
  }, []);

  const value = useMemo(
    () => ({
      agents,
      setAgentMode,
      rotateDemoMode,
      addAgent,
      removeAgent,
      patchAgentMeta,
    }),
    [agents, setAgentMode, rotateDemoMode, addAgent, removeAgent, patchAgentMeta]
  );

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio() {
  const v = useContext(StudioContext);
  if (!v) throw new Error("useStudio must be used within StudioProvider");
  return v;
}
