import WorkflowInputNode from "./WorkflowInputNode.jsx";
import WorkflowOutputNode from "./WorkflowOutputNode.jsx";
import WorkflowAgentNode from "./WorkflowAgentNode.jsx";
import WorkflowNestedNode from "./WorkflowNestedNode.jsx";

export const workflowNodeTypes = {
  workflowInput: WorkflowInputNode,
  workflowOutput: WorkflowOutputNode,
  workflowAgent: WorkflowAgentNode,
  workflowNested: WorkflowNestedNode,
};
