import { Handle } from "@xyflow/react";
import { cn } from "../../../ui/cn.js";
import { useWorkflowNodeActions } from "../context/WorkflowNodeActionsContext.jsx";
import { getWorkflowHandlePositions } from "../utils/workflowNodeHandles.js";
import WorkflowNodeChrome from "./WorkflowNodeChrome.jsx";

/** @param {import('@xyflow/react').NodeProps & { data?: { label?: string; description?: string; workflowName?: string; isActive?: boolean } }} props */
export default function WorkflowNestedNode({ id, data }) {
  const label = data?.label || "嵌套工作流";
  const workflowName = data?.workflowName;
  const isActive = Boolean(data?.isActive);
  const isRuntimeView = Boolean(data?.__runtimeView || data?.__preview);
  const { target, source } = getWorkflowHandlePositions(data);
  const chrome = useWorkflowNodeActions(id);
  const flipY = Boolean(data?.flipY);

  return (
    <div
      className={cn(
        "wf-node wf-node--nested",
        isActive && "is-selected",
        data?.runtimeStatus === "active" && "is-runtime-active",
        data?.runtimeStatus === "completed" && "is-runtime-completed",
      )}
    >
      <Handle type="target" position={target} />
      <div className={cn("wf-node__inner", flipY && "is-flip-y")}>
        <div className="wf-node__badge">嵌套工作流</div>
        <div className="wf-node__title">{label}</div>
        <div className="wf-node__desc">{workflowName || "未选择工作流"}</div>
      </div>
      {isActive && !isRuntimeView ? (
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
