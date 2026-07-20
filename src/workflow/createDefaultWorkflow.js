import { WORKFLOW_NODE_TYPES } from "./workflowTypes.js";

/** @param {{ name?: string; description?: string; draft?: boolean }} [partial] */
export function createDefaultWorkflow(partial = {}) {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `wf-${Date.now()}`;
  const now = Date.now();
  const inputId = `input-${id}`;
  const outputId = `output-${id}`;
  const agentId = `agent-${id}`;

  return {
    id,
    name: partial.name?.trim() ?? "",
    description: partial.description?.trim() ?? "",
    draft: partial.draft !== false,
    nodes: [
      {
        id: inputId,
        type: WORKFLOW_NODE_TYPES.INPUT,
        position: { x: 80, y: 200 },
        data: { label: "输入", description: "" },
      },
      {
        id: agentId,
        type: WORKFLOW_NODE_TYPES.AGENT,
        position: { x: 320, y: 180 },
        data: {
          label: "智能体",
          description: "",
          agentId: null,
          skillOverrides: { bind: [], unbind: [] },
        },
      },
      {
        id: outputId,
        type: WORKFLOW_NODE_TYPES.OUTPUT,
        position: { x: 560, y: 200 },
        data: { label: "输出", description: "" },
      },
    ],
    edges: [
      { id: `e-${inputId}-${agentId}`, source: inputId, target: agentId },
      { id: `e-${agentId}-${outputId}`, source: agentId, target: outputId },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}
