import { skillPickRowToPayload, skillMetaFromPickRow } from "../skills/skillRegistry.js";
import {
  buildWorkflowUserTurnContext,
  resolveWorkflowOrchestrationPlan,
} from "../workflow/workflowRuntimeRegistry.js";
import { formatComposerSkillDirective } from "./formatComposerSkillDirective.js";

/**
 * @param {import("../components/automation/AutomationTaskDialog.jsx").AutomationTaskDraft} draft
 * @param {{ agentById?: Map<string, { id: string; gatewayAgentId?: string }> }} [opts]
 */
export function buildAutomationCronMessage(draft, opts = {}) {
  const agentById = opts.agentById ?? new Map();
  /** @type {string[]} */
  const parts = [];

  const skillPayload = skillPickRowToPayload(draft.skillRow);
  const skillHint = formatComposerSkillDirective(skillPayload).trim();
  if (skillHint) parts.push(skillHint);

  const workflowId = String(draft.workflowId ?? "").trim();
  if (workflowId) {
    const plan = resolveWorkflowOrchestrationPlan({
      workflowId,
      sessionState: { selectedWorkflowId: workflowId, runtime: null },
      agentById,
      mentionedAgentIds: [],
    });
    const wfCtx = buildWorkflowUserTurnContext(plan).trim();
    if (wfCtx) parts.push(wfCtx);
  }

  const prompt = String(draft.prompt ?? "").trim();
  if (prompt) parts.push(prompt);

  return parts.join("\n\n");
}

/**
 * @param {import("../components/automation/AutomationTaskDialog.jsx").AutomationTaskDraft} draft
 */
export function automationDraftToStudioMeta(draft) {
  return {
    name: String(draft.name ?? "").trim(),
    prompt: String(draft.prompt ?? "").trim(),
    modelProfileId: String(draft.modelId ?? "").trim(),
    agentId: String(draft.agentId ?? "").trim(),
    skillMeta: skillMetaFromPickRow(draft.skillRow) ?? null,
    workflowId: String(draft.workflowId ?? "").trim(),
    channel: String(draft.channel ?? "").trim(),
    frequencyMode: String(draft.frequencyMode ?? "period"),
    periodCycle: String(draft.periodCycle ?? "daily"),
    periodTime: String(draft.periodTime ?? "09:00"),
    intervalValue: Number(draft.intervalValue) > 0 ? Number(draft.intervalValue) : 1,
    intervalUnit: String(draft.intervalUnit ?? "hour"),
    onceDate: String(draft.onceDate ?? "").trim(),
    onceTime: String(draft.onceTime ?? "09:00"),
    effectiveRange: Array.isArray(draft.effectiveRange)
      ? draft.effectiveRange.map((v) => String(v ?? "").trim()).filter(Boolean)
      : [],
  };
}
