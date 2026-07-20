import { Handle } from "@xyflow/react";
import { cn } from "../../../ui/cn.js";
import { useWorkflowNodeActions } from "../context/WorkflowNodeActionsContext.jsx";
import { getWorkflowHandlePositions } from "../utils/workflowNodeHandles.js";
import WorkflowNodeChrome from "./WorkflowNodeChrome.jsx";

/** @param {import('@xyflow/react').NodeProps} props */
export default function WorkflowOutputNode({ id, data, selected }) {
  const label = data?.label || "输出";
  const description = data?.description || "";
  const { target } = getWorkflowHandlePositions(data);
  const chrome = useWorkflowNodeActions(id);
  const flipY = Boolean(data?.flipY);

  return (
    <div className={cn("wf-node wf-node--output", selected && "is-selected")}>
      <Handle type="target" position={target} />
      <div className={cn("wf-node__inner", flipY && "is-flip-y")}>
        <div className="wf-node__badge">输出节点</div>
        <div className="wf-node__title">{label}</div>
        {description ? <div className="wf-node__desc">{description}</div> : null}
      </div>
      {selected ? (
        <WorkflowNodeChrome
          onDelete={chrome.onDelete}
          onFlipHorizontal={chrome.onFlipHorizontal}
          onFlipVertical={chrome.onFlipVertical}
          flipVerticalDisabled
        />
      ) : null}
    </div>
  );
}
