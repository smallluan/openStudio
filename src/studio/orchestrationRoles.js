/** @typedef {'main' | 'pm' | 'fe' | 'be' | 'reviewer' | ''} OrchestrationRoleValue */

import orchRoles from "../../lib/orchestration/roles.cjs";

export const OrchestrationRole = orchRoles.OrchestrationRole;
export const normalizeOrchestrationRole = orchRoles.normalizeOrchestrationRole;
export const orchestrationRoleLabel = orchRoles.orchestrationRoleLabel;
export const inferOrchestrationRoleFromMeta = orchRoles.inferOrchestrationRoleFromMeta;
export const orchestrationRoleForAgent = orchRoles.orchestrationRoleForAgent;
export const orchestrationParticipantIds = orchRoles.orchestrationParticipantIds;
export const agentsByOrchestrationRole = orchRoles.agentsByOrchestrationRole;
export const matchAgentCapability = orchRoles.matchAgentCapability;
