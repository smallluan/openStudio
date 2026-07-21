import { Handle } from "@xyflow/react";
import { cn } from "../../../ui/cn.js";
import { useWorkflowNodeActions } from "../context/WorkflowNodeActionsContext.jsx";
import { getWorkflowHandlePositions } from "../utils/workflowNodeHandles.js";
import WorkflowNodeChrome from "./WorkflowNodeChrome.jsx";

/** @param {import('@xyflow/react').NodeProps & { data?: { label?: string; description?: string; agentName?: string; task?: string; isActive?: boolean } }} props */
export default function WorkflowSubAgentNode({ id, data }) {
  const label = data?.label || "子智能体";
  const agentName = data?.agentName;
  const task = data?.task?.trim() ?? "";
  const isActive = Boolean(data?.isActive);
  const { target, source } = getWorkflowHandlePositions(data);
  const chrome = useWorkflowNodeActions(id);
  const flipY = Boolean(data?.flipY);

  return (
    <div className={cn("wf-node wf-node--sub-agent", isActive && "is-selected")}>
      <Handle type="target" position={target} />
      <div className={cn("wf-node__inner", flipY && "is-flip-y")}>
        <div className="wf-node__badge">子智能体节点</div>
        <div className="wf-node__title">{label}</div>
        {agentName ? (
          <div className="wf-node__desc" title={agentName}>
            {agentName}
          </div>
        ) : (
          <div className="wf-node__desc">未选择智能体</div>
        )}
        <div className="wf-node__desc" title={task || undefined}>
          {task || "未配置任务"}
        </div>
      </div>
      {isActive ? (
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
