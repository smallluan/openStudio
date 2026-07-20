/** @typedef {import('@xyflow/react').Node} FlowNode */
/** @typedef {import('@xyflow/react').Edge} FlowEdge */

/**
 * Node-level skill overrides (only effective on this node at runtime).
 * @typedef {{
 *   bind: string[];
 *   unbind: string[];
 * }} WorkflowSkillOverrides
 */

/**
 * @typedef {{
 *   label?: string;
 *   description?: string;
 * }} WorkflowTerminalNodeData
 */

/**
 * @typedef {WorkflowTerminalNodeData & {
 *   agentId: string | null;
 *   skillOverrides: WorkflowSkillOverrides;
 *   handoffSourceNodeId?: string | null;
 * }} WorkflowAgentNodeData
 */

/**
 * @typedef {WorkflowTerminalNodeData & {
 *   workflowId: string | null;
 * }} WorkflowNestedNodeData
 */

/**
 * @typedef {WorkflowTerminalNodeData & {
 *   agentId: string | null;
 *   task: string;
 * }} WorkflowSubAgentNodeData
 */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   description: string;
 *   nodes: FlowNode[];
 *   edges: FlowEdge[];
 *   viewport?: { x: number; y: number; zoom: number };
 *   draft?: boolean;
 *   createdAt: number;
 *   updatedAt: number;
 * }} WorkflowDocument
 */

/** @typedef {{ workflows: WorkflowDocument[] }} WorkflowLibrarySnapshot */

export const WORKFLOW_NODE_TYPES = {
  INPUT: "workflowInput",
  OUTPUT: "workflowOutput",
  AGENT: "workflowAgent",
  SUB_AGENT: "workflowSubAgent",
  NESTED: "workflowNested",
};
