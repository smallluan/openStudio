import { Handle } from "@xyflow/react";
import { cn } from "../../../ui/cn.js";
import { useWorkflowNodeActions } from "../context/WorkflowNodeActionsContext.jsx";
import { getWorkflowHandlePositions } from "../utils/workflowNodeHandles.js";
import WorkflowNodeChrome from "./WorkflowNodeChrome.jsx";

/** @param {import('@xyflow/react').NodeProps & { data?: { label?: string; description?: string; agentName?: string } }} props */
export default function WorkflowAgentNode({ id, data, selected }) {
  const label = data?.label || "智能体";
  const description = data?.description || "";
  const agentName = data?.agentName;
  const { target, source } = getWorkflowHandlePositions(data);
  const chrome = useWorkflowNodeActions(id);
  const flipY = Boolean(data?.flipY);

  return (
    <div className={cn("wf-node wf-node--agent", selected && "is-selected")}>
      <Handle type="target" position={target} />
      <div className={cn("wf-node__inner", flipY && "is-flip-y")}>
        <div className="wf-node__badge">智能体节点</div>
        <div className="wf-node__title">{label}</div>
        {agentName ? (
          <div className="wf-node__desc" title={agentName}>
            {agentName}
          </div>
        ) : description ? (
          <div className="wf-node__desc">{description}</div>
        ) : (
          <div className="wf-node__desc">未选择智能体</div>
        )}
      </div>
      {selected ? (
        <WorkflowNodeChrome
          onDelete={chrome.onDelete}
          onFlipHorizontal={chrome.onFlipHorizontal}
          onFlipVertical={chrome.onFlipVertical}
        />
      ) : null}
      <Handle type="source" position={source} />
    </div>
  );
}
