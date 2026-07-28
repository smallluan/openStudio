import {
  composeAutomationExecutionSystemPrompt,
  composeChatLabStudioSuffix,
} from "../chat/chatLabSystemPrompt.js";
import { buildGroupMemberChangeEvents } from "../chat/chatLabGroupMemberEvents.js";
import { resolveWorkflowNodeMetaForAgent } from "../chat/chatLabWorkflowMessageLayout.js";
import {
  agentDisplayLabel,
  groupAgentsInSession,
  sessionKeyForAgent,
  systemMessageForAgent,
} from "../studio/agents.js";
import {
  buildWorkflowUserTurnContext,
  getWorkflowById,
  resolveWorkflowAgents,
  resolveWorkflowOrchestrationPlan,
  resolveWorkflowParticipantIds,
} from "../workflow/workflowRuntimeRegistry.js";
import { formatAutomationExecutionUserMessage } from "./formatAutomationExecutionMessage.js";

/**
 * @param {Array<{ role: string; content: string }>} outgoing
 * @param {import("../workflow/workflowRuntimeRegistry.js").WorkflowOrchestrationPlan | null | undefined} workflowPlan
 */
function withWorkflowContextOnUserTurn(outgoing, workflowPlan) {
  const block = buildWorkflowUserTurnContext(workflowPlan);
  if (!block || !Array.isArray(outgoing)) return outgoing;
  const rows = outgoing.map((row) => ({ ...row }));
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.role !== "user") continue;
    const body = String(rows[i].content ?? "");
    if (body.includes("工作流执行模式（用户已选择")) break;
    rows[i] = { ...rows[i], content: `${block}\n\n---\n\n${body}` };
    break;
  }
  return rows;
}

/**
 * @param {import("../studio/agents.js").LobsterAgent} agent
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {import("../studio/agents.js").LobsterAgent[]} groupAgents
 * @param {{ workflowFlowPrompt?: string; workflowFogPrompt?: string }} [extra]
 */
function systemRowForAutomationAgent(agent, t, groupAgents, extra = {}) {
  // Stable UI + automation rules only; workflow fog goes on the user turn.
  const studioSuffix = [composeAutomationExecutionSystemPrompt(t), composeChatLabStudioSuffix(t)]
    .filter(Boolean)
    .join("\n\n");
  return systemMessageForAgent(agent, t("chatLab.systemPrompt"), {
    groupAgents,
    studioSuffix,
  });
}
/**
 * @param {{
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   agentById: Map<string, import("../studio/agents.js").LobsterAgent>;
 *   mainAgent: import("../studio/agents.js").LobsterAgent | null;
 *   taskName?: string;
 *   displayPrompt: string;
 *   gatewayMessage: string;
 *   agentId?: string;
 *   workflowId?: string;
 * }} input
 */
export function resolveAutomationChatTargets(input) {
  const workflowId = String(input.workflowId ?? "").trim();
  const { agentById, mainAgent } = input;

  if (workflowId) {
    const plan = resolveWorkflowOrchestrationPlan({
      workflowId,
      sessionState: { selectedWorkflowId: workflowId, runtime: null },
      agentById,
      mentionedAgentIds: [],
    });
    const targets = resolveWorkflowAgents(plan?.targetAgentIds ?? [], agentById);
    return {
      workflowId,
      workflowPlan: plan,
      workflowName: getWorkflowById(workflowId)?.name || workflowId,
      targets: targets.length ? targets : mainAgent ? [mainAgent] : [],
    };
  }

  const pickedId = String(input.agentId ?? "").trim();
  const agent = (pickedId ? agentById.get(pickedId) : null) || mainAgent;
  return {
    workflowId: "",
    workflowPlan: null,
    workflowName: "",
    targets: agent ? [agent] : [],
  };
}

/**
 * @param {Record<string, unknown>} assistantRow
 * @param {string} workflowId
 * @param {string[]} activeNodeIds
 * @param {Map<string, import("../studio/agents.js").LobsterAgent>} agentById
 */
function withWorkflowAssistantNodeMeta(assistantRow, workflowId, activeNodeIds, agentById) {
  const agentId = typeof assistantRow.agentId === "string" ? assistantRow.agentId : "";
  if (!workflowId || !agentId) return assistantRow;
  const meta = resolveWorkflowNodeMetaForAgent(workflowId, agentId, agentById, activeNodeIds);
  if (!meta) return assistantRow;
  return {
    ...assistantRow,
    ...(meta.workflowNodeId ? { workflowNodeId: meta.workflowNodeId } : {}),
    ...(meta.workflowNodeLabel ? { workflowNodeLabel: meta.workflowNodeLabel } : {}),
  };
}

/**
 * @param {{
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   target: import("../studio/agents.js").LobsterAgent;
 *   groupAgents: import("../studio/agents.js").LobsterAgent[];
 *   taskName?: string;
 *   displayPrompt: string;
 *   gatewayMessage: string;
 *   workflowPlan?: import("../workflow/workflowRuntimeRegistry.js").WorkflowOrchestrationPlan | null;
 *   globalUserProfile?: { displayName?: string; avatar?: string; gender?: string; userMd?: string };
 * }} input
 */
export function buildAutomationOutgoingMessages(input) {
  const executionUserTurn = formatAutomationExecutionUserMessage(input.t, {
    taskName: input.taskName,
    prompt: input.displayPrompt,
    message: input.gatewayMessage,
  });

  const sysRow = systemRowForAutomationAgent(input.target, input.t, input.groupAgents);
  const baseOutgoing = [
    ...(sysRow ? [sysRow] : []),
    { role: "user", content: executionUserTurn },
  ];
  return withWorkflowContextOnUserTurn(baseOutgoing, input.workflowPlan);
}

/**
 * @param {{
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   agentById: Map<string, import("../studio/agents.js").LobsterAgent>;
 *   mainAgent: import("../studio/agents.js").LobsterAgent | null;
 *   agents: import("../studio/agents.js").LobsterAgent[];
 *   taskName?: string;
 *   displayPrompt: string;
 *   gatewayMessage: string;
 *   agentId?: string;
 *   workflowId?: string;
 *   nowMs?: number;
 *   globalUserProfile?: { displayName?: string; avatar?: string; gender?: string; userMd?: string };
 * }} input
 */
export function buildAutomationChatSession(input) {
  const now = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const { targets, workflowId, workflowPlan, workflowName } = resolveAutomationChatTargets(input);

  const workflowParticipantIds = workflowId
    ? resolveWorkflowParticipantIds(workflowId, input.agentById)
    : [];
  const targetParticipantIds = targets
    .map((a) => a.id)
    .filter((id) => id && id !== input.mainAgent?.id);
  const nextNonMainParticipantIds = [
    ...new Set([
      ...workflowParticipantIds.filter((id) => id && id !== input.mainAgent?.id),
      ...targetParticipantIds,
    ]),
  ];
  const participantIds = [
    ...new Set([...(input.mainAgent?.id ? [input.mainAgent.id] : []), ...nextNonMainParticipantIds]),
  ];
  const memberEvents = buildGroupMemberChangeEvents(
    [],
    nextNonMainParticipantIds,
    input.agentById,
    input.t,
    input.t("chatLab.automationRunBadge"),
  );
  const workflowState = workflowId
    ? { selectedWorkflowId: workflowId, runtime: workflowPlan?.runtime ?? null }
    : null;

  const groupAgents = groupAgentsInSession({
    agents: input.agents,
    mainAgent: input.mainAgent,
    participantIds: nextNonMainParticipantIds,
  });

  const userRow = {
    id: `automation-user-${now}`,
    role: /** @type {const} */ ("user"),
    content: input.displayPrompt,
    messageKind: /** @type {const} */ ("automation_run"),
    createdAt: now,
    ...(workflowId ? { workflowId, workflowName } : {}),
  };

  const assistantRows = targets.map((target, index) =>
    withWorkflowAssistantNodeMeta(
      {
        id: `automation-assistant-${now}-${index}`,
        role: /** @type {const} */ ("assistant"),
        content: "",
        thinking: "",
        createdAt: now + index + 1,
        agentId: target.id,
      },
      workflowId,
      workflowPlan?.runtime?.activeNodeIds ?? [],
      input.agentById,
    ),
  );

  /** @type {Array<{
   *   target: import("../studio/agents.js").LobsterAgent;
   *   assistantRow: typeof assistantRows[number];
   *   outgoing: Array<{ role: string; content: string }>;
   * }>} */
  const launches = targets.map((target, index) => ({
    target,
    assistantRow: assistantRows[index],
    outgoing: buildAutomationOutgoingMessages({
      t: input.t,
      target,
      groupAgents,
      taskName: input.taskName,
      displayPrompt: input.displayPrompt,
      gatewayMessage: input.gatewayMessage,
      workflowPlan,
      globalUserProfile: input.globalUserProfile,
    }),
  }));

  return {
    userRow,
    assistantRows,
    launches,
    workflowId,
    targets,
    participantIds,
    nextNonMainParticipantIds,
    memberEvents,
    workflowState,
  };
}

export { agentDisplayLabel, sessionKeyForAgent };
