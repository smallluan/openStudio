import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  agentDisplayLabel,
  agentWithMode,
  buildIdentityMd,
  createInitialAgents,
  findMainAgent,
  normalizeLobsterAgent,
  sessionKeyForAgent,
  uniqueGatewayAgentIdForName,
} from "../studio/agents.js";
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
 *   createAgent: (partial: {
 *     name: string;
 *     description?: string;
 *     identityMd?: string;
 *     soulMd?: string;
 *     agentsMd?: string;
 *     userMd?: string;
 *     toolsMd?: string;
 *     memoryMd?: string;
 *     avatar?: string;
 *     skillIds?: string[];
 *   }) => Promise<{ ok: boolean; id?: string; reason?: string }>;
 *   removeAgent: (agentId: string) => void;
 *   patchAgentMeta: (agentId: string, patch: {
 *     name?: string;
 *     description?: string;
 *     avatar?: string;
 *     identityMd?: string;
 *     soulMd?: string;
 *     agentsMd?: string;
 *     userMd?: string;
 *     toolsMd?: string;
 *     memoryMd?: string;
 *     skillIds?: string[];
 *     openclaw?: { sessionKey?: string };
 *   }) => void;
 *   agentById: Map<string, LobsterAgent>;
 *   mainAgent: LobsterAgent | null;
 * }} StudioApi */

const StudioContext = /** @type {import('react').Context<StudioApi | null>} */ (
  createContext(null)
);

function newAgentId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `lobster-${Date.now()}`;
}

/** @param {LobsterAgent} agent */
async function provisionAgentOnDisk(agent) {
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  if (!bridge?.provisionAgent) return null;
  try {
    return await bridge.provisionAgent({
      gatewayAgentId: agent.gatewayAgentId,
      name: agentDisplayLabel(agent),
      description: agent.description,
      avatar: agent.avatar,
      soulMd: agent.soulMd,
      identityMd: agent.identityMd,
      agentsMd: agent.agentsMd,
      userMd: agent.userMd,
      toolsMd: agent.toolsMd,
      memoryMd: agent.memoryMd,
      isMain: Boolean(agent.isMain),
    });
  } catch {
    return null;
  }
}

export function StudioProvider({ children }) {
  const [agents, setAgents] = useState(loadAgents);
  const provisionTimersRef = useRef(/** @type {Map<string, number>} */ (new Map()));

  useEffect(() => {
    saveAgents(agents);
  }, [agents]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== AGENTS_STORAGE_KEY || e.storageArea !== localStorage) return;
      setAgents(loadAgents());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const bridge = window.studioBridge;
    if (!bridge?.getDefaultGatewayAgentId) return;
    let cancelled = false;
    void bridge.getDefaultGatewayAgentId().then((r) => {
      if (cancelled || !r?.ok || typeof r.gatewayAgentId !== "string") return;
      const gatewayAgentId = r.gatewayAgentId.trim();
      if (!gatewayAgentId) return;
      setAgents((prev) => {
        const main = findMainAgent(prev);
        if (!main) return prev;
        if (main.gatewayAgentId === gatewayAgentId) return prev;
        return prev.map((a) =>
          a.id === main.id
            ? {
                ...a,
                gatewayAgentId,
                openclaw: { sessionKey: sessionKeyForAgent({ ...a, gatewayAgentId }) },
              }
            : a,
        );
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleProvision = useCallback((agent) => {
    const prevTimer = provisionTimersRef.current.get(agent.id);
    if (prevTimer) window.clearTimeout(prevTimer);
    const timer = window.setTimeout(() => {
      provisionTimersRef.current.delete(agent.id);
      void provisionAgentOnDisk(agent).then((result) => {
        if (!result?.ok) {
          console.warn("[studio] agent provision failed", agent.gatewayAgentId, result?.reason);
          return;
        }
        setAgents((cur) =>
          cur.map((a) => {
            if (a.id !== agent.id) return a;
            const next = {
              ...a,
              openclaw: { ...a.openclaw, sessionKey: result.sessionKey || a.openclaw?.sessionKey },
            };
            if (!a.soulMd?.trim() && typeof result.soulPath === "string") {
              const diskBridge = typeof window !== "undefined" ? window.studioBridge : undefined;
              void diskBridge?.readAgentSoul?.({ gatewayAgentId: a.gatewayAgentId }).then((soul) => {
                if (!soul?.ok || !soul.soulMd?.trim()) return;
                setAgents((cur2) =>
                  cur2.map((row) => (row.id === a.id ? { ...row, soulMd: soul.soulMd } : row)),
                );
              });
            }
            return next;
          }),
        );
      });
    }, 450);
    provisionTimersRef.current.set(agent.id, timer);
  }, []);

  const mainBootstrappedRef = useRef(false);
  useEffect(() => {
    if (mainBootstrappedRef.current) return;
    mainBootstrappedRef.current = true;
    for (const agent of loadAgents()) scheduleProvision(agent);
  }, [scheduleProvision]);

  const setAgentMode = useCallback((agentId, mode) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? agentWithMode(a, mode) : a))
    );
  }, []);

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

  const createAgent = useCallback(async (partial) => {
    const name = partial?.name?.trim();
    if (!name) return { ok: false, reason: "name_required" };

    const id = newAgentId();
    /** @type {LobsterAgent | null} */
    let created = null;
    setAgents((prev) => {
      const gatewayAgentId = uniqueGatewayAgentIdForName(name, prev);
      const avatar = partial?.avatar?.trim() || "🦞";
      const description = partial?.description?.trim() ?? "";
      const identityMd =
        partial?.identityMd?.trim() || buildIdentityMd({ name, description, avatar });
      created = agentWithMode(
        {
          id,
          gatewayAgentId,
          name,
          description,
          avatar,
          soulMd: partial?.soulMd?.trim() ?? "",
          identityMd,
          agentsMd: partial?.agentsMd?.trim() ?? "",
          userMd: partial?.userMd?.trim() ?? "",
          toolsMd: partial?.toolsMd?.trim() ?? "",
          memoryMd: partial?.memoryMd?.trim() ?? "",
          skillIds: Array.isArray(partial?.skillIds) ? [...partial.skillIds] : [],
          mode: AgentMode.IDLE,
          zoneId: "lounge",
          agentSlot: prev.length,
          openclaw: {},
        },
        AgentMode.IDLE,
      );
      return [...prev, created];
    });

    if (!created) return { ok: false, reason: "create_failed" };
    const agent = created;
    const result = await provisionAgentOnDisk(agent);
    if (!result?.ok) {
      console.warn("[studio] create agent provision failed", agent.gatewayAgentId, result?.reason);
      return { ok: false, reason: result?.reason ?? "provision_failed", id: agent.id };
    }
    setAgents((cur) =>
      cur.map((a) =>
        a.id === agent.id
          ? { ...a, openclaw: { ...a.openclaw, sessionKey: result.sessionKey || a.openclaw?.sessionKey } }
          : a,
      ),
    );
    return { ok: true, id: agent.id };
  }, []);

  const removeAgent = useCallback((agentId) => {
    setAgents((prev) => {
      const target = prev.find((a) => a.id === agentId);
      if (!target || target.isMain) return prev;
      const bridge = window.studioBridge;
      if (bridge?.deleteGatewayAgent) {
        void bridge.deleteGatewayAgent({ gatewayAgentId: target.gatewayAgentId });
      }
      return prev.filter((a) => a.id !== agentId);
    });
  }, []);

  const patchAgentMeta = useCallback((agentId, patch) => {
    setAgents((prev) => {
      let patched = /** @type {LobsterAgent | null} */ (null);
      const next = prev.map((a) => {
        if (a.id !== agentId) return a;
        const row = { ...a };
        if (patch.name !== undefined) row.name = patch.name;
        if (patch.description !== undefined) row.description = patch.description;
        if (patch.avatar !== undefined) row.avatar = patch.avatar;
        if (patch.identityMd !== undefined) row.identityMd = patch.identityMd;
        if (patch.soulMd !== undefined) row.soulMd = patch.soulMd;
        if (patch.agentsMd !== undefined) row.agentsMd = patch.agentsMd;
        if (patch.userMd !== undefined) row.userMd = patch.userMd;
        if (patch.toolsMd !== undefined) row.toolsMd = patch.toolsMd;
        if (patch.memoryMd !== undefined) row.memoryMd = patch.memoryMd;
        if (patch.skillIds !== undefined) row.skillIds = [...patch.skillIds];
        if (patch.openclaw !== undefined) {
          const merged = { ...a.openclaw, ...patch.openclaw };
          const sk = merged.sessionKey;
          if (typeof sk !== "string" || !sk.trim()) delete merged.sessionKey;
          else merged.sessionKey = sk.trim();
          row.openclaw = merged;
        }
        if (!row.openclaw?.sessionKey) {
          row.openclaw = { ...row.openclaw, sessionKey: sessionKeyForAgent(row) };
        }
        patched = row;
        return row;
      });
      if (patched) scheduleProvision(patched);
      return next;
    });
  }, [scheduleProvision]);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const mainAgent = useMemo(() => findMainAgent(agents), [agents]);

  const value = useMemo(
    () => ({
      agents,
      setAgentMode,
      rotateDemoMode,
      createAgent,
      removeAgent,
      patchAgentMeta,
      agentById,
      mainAgent,
    }),
    [agents, setAgentMode, rotateDemoMode, createAgent, removeAgent, patchAgentMeta, agentById, mainAgent],
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
