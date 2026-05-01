import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { createInitialAgents, agentWithMode } from "../studio/agents.js";
import { AgentMode } from "../studio/modes.js";

/** @typedef {import("../studio/agents.js").LobsterAgent} LobsterAgent */

/** @typedef {{
 *   agents: LobsterAgent[];
 *   setAgentMode: (agentId: string, mode: import("../studio/modes.js").AgentModeValue) => void;
 *   rotateDemoMode: () => void;
 * }} StudioApi */

const StudioContext = /** @type {import('react').Context<StudioApi | null>} */ (
  createContext(null)
);

export function StudioProvider({ children }) {
  const [agents, setAgents] = useState(createInitialAgents);

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

  const value = useMemo(
    () => ({ agents, setAgentMode, rotateDemoMode }),
    [agents, setAgentMode, rotateDemoMode]
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
