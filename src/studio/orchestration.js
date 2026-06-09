import orchCore from "../../lib/orchestration/core.cjs";

export const MAX_ORCHESTRATION_PHASES = orchCore.MAX_ORCHESTRATION_PHASES;
export const newOrchestrationId = orchCore.newOrchestrationId;
export const normalizeTaskKind = orchCore.normalizeTaskKind;
export const normalizeOrchestrationTask = orchCore.normalizeOrchestrationTask;
export const normalizeOrchestrationPlan = orchCore.normalizeOrchestrationPlan;
export const normalizeOrchestrationRun = orchCore.normalizeOrchestrationRun;
export const normalizePreTasks = orchCore.normalizePreTasks;
export const parsePlanFromResponse = orchCore.parsePlanFromResponse;
export const parseReviewFromResponse = orchCore.parseReviewFromResponse;
export const parseTriageFromResponse = orchCore.parseTriageFromResponse;
export const readyTasks = orchCore.readyTasks;
export const orchestrationAssignOpts = orchCore.orchestrationAssignOpts;
export const orchestrationTeamAgents = orchCore.orchestrationTeamAgents;
export const formatOrchestrationTeamRoster = orchCore.formatOrchestrationTeamRoster;
export const resolveTaskOwner = orchCore.resolveTaskOwner;
export const pickExecutionOwner = orchCore.pickExecutionOwner;
export const sanitizePlanForPool = orchCore.sanitizePlanForPool;
export const assignTaskOwners = orchCore.assignTaskOwners;
export const patchPlanTask = orchCore.patchPlanTask;
export const taskIsExecutable = orchCore.taskIsExecutable;
export const enforcePlanPhaseFormat = orchCore.enforcePlanPhaseFormat;
export const buildPlanRevisionPrompt = orchCore.buildPlanRevisionPrompt;
export const buildOrchestrationTriagePrompt = orchCore.buildOrchestrationTriagePrompt;
export const buildPreTaskPrompt = orchCore.buildPreTaskPrompt;
export const buildPlanSynthesisPrompt = orchCore.buildPlanSynthesisPrompt;
export const buildTaskPrompt = orchCore.buildTaskPrompt;
export const buildDevTaskPrompt = orchCore.buildDevTaskPrompt;
export const buildReviewPrompt = orchCore.buildReviewPrompt;
export const buildRollupPrompt = orchCore.buildRollupPrompt;
export const buildPmResearchPrompt = orchCore.buildPmResearchPrompt;
export const resolveTriageNeedsPm = orchCore.resolveTriageNeedsPm;

/** @typedef {'todo' | 'in_progress' | 'done' | 'blocked' | 'review'} OrchestrationTaskStatus */
/** @typedef {'research' | 'work' | 'review' | 'synthesize'} OrchestrationTaskKind */
/** @typedef {'pm_research' | 'development' | 'review' | 'rollup'} OrchestrationTaskPhase */
/** @typedef {'planning' | 'awaiting_approval' | 'revising' | 'running' | 'paused' | 'completed' | 'failed'} OrchestrationRunStatus */

/**
 * @typedef {object} OrchestrationTask
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string | null} [ownerAgentId]
 * @property {import("./orchestrationRoles.js").OrchestrationRoleValue} [ownerRole]
 * @property {string} [domain]
 * @property {OrchestrationTaskKind} [taskKind]
 * @property {OrchestrationTaskStatus} status
 * @property {OrchestrationTaskPhase} phase
 * @property {string[]} dependsOn
 * @property {string} [output]
 * @property {number} [reviewRound]
 */

/**
 * @typedef {object} OrchestrationPlan
 * @property {number} version
 * @property {string} summary
 * @property {string} [feasibility]
 * @property {OrchestrationTask[]} tasks
 */

/**
 * @typedef {object} OrchestrationPreTask
 * @property {string} agentId
 * @property {string} brief
 */

/**
 * @typedef {object} OrchestrationRun
 * @property {string} runId
 * @property {OrchestrationRunStatus} status
 * @property {string} [currentPhase]
 * @property {string} userRequirement
 * @property {string} [scenarioSummary]
 * @property {boolean} [requiresApproval]
 * @property {OrchestrationPreTask[]} [preTasks]
 * @property {string[]} [mentionIds]
 * @property {string[]} [participantIds]
 * @property {string} [revisionNotes]
 * @property {OrchestrationPlan | null} plan
 * @property {string | null} [activeTaskId]
 * @property {string[]} [activeTaskIds]
 * @property {Record<string, { approved: boolean; findings: string[] }>} [reviewResults]
 * @property {number} startedAt
 * @property {number} [updatedAt]
 */

import { agentsByOrchestrationRole } from "./orchestrationRoles.js";

/**
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {string | null | undefined} agentId
 * @param {import("./orchestrationRoles.js").OrchestrationRoleValue} role
 * @param {{ participantIds?: string[]; mentionIds?: string[]; mainAgent?: import("./agents.js").LobsterAgent | null }} [opts]
 */
export function agentByIdOrRole(agents, agentId, role, opts = {}) {
  if (agentId) {
    const hit = agents.find((a) => a.id === agentId);
    if (hit) return hit;
  }
  const pool = agentsByOrchestrationRole(agents, role, opts);
  return pool[0] ?? null;
}
