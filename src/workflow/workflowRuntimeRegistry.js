/**
 * Runtime registry for workflows — reserved for future chat/session integration.
 * Mirrors the pattern of skillRegistry.listSkillsForPicker().
 */
import { loadWorkflowLibrary } from "./workflowsLocalStore.js";
import { normalizeWorkflowDocument } from "./workflowNormalize.js";

/** @typedef {import('./workflowTypes.js').WorkflowDocument} WorkflowDocument */
/** @typedef {import('./workflowTypes.js').WorkflowAgentNodeData} WorkflowAgentNodeData */

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   description: string;
 *   searchText: string;
 * }} WorkflowPickRow
 */

/** @returns {WorkflowDocument[]} */
export function listWorkflowDocuments() {
  const lib = loadWorkflowLibrary();
  return lib.workflows
    .map((w) => normalizeWorkflowDocument(w))
    .filter((w) => w !== null && !w.draft);
}

/** @returns {WorkflowPickRow[]} */
export function listWorkflowsForPicker() {
  return listWorkflowDocuments().map((w) => ({
    id: w.id,
    label: w.name,
    description: w.description,
    searchText: `${w.name} ${w.description}`.toLowerCase(),
  }));
}

/**
 * Resolve effective skill IDs for an agent node at runtime.
 * @param {{ skillIds?: string[] } | null | undefined} agent
 * @param {WorkflowAgentNodeData} nodeData
 * @returns {string[]}
 */
export function resolveAgentNodeSkills(agent, nodeData) {
  const base = new Set(agent?.skillIds ?? []);
  for (const id of nodeData.skillOverrides?.unbind ?? []) base.delete(id);
  for (const id of nodeData.skillOverrides?.bind ?? []) base.add(id);
  return [...base];
}

/** @param {string} workflowId */
export function getWorkflowById(workflowId) {
  return listWorkflowDocuments().find((w) => w.id === workflowId) ?? null;
}
