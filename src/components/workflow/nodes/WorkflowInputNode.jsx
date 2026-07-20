import { Handle } from "@xyflow/react";
import { cn } from "../../../ui/cn.js";
import { useWorkflowNodeActions } from "../context/WorkflowNodeActionsContext.jsx";
import { getWorkflowHandlePositions } from "../utils/workflowNodeHandles.js";
import WorkflowNodeChrome from "./WorkflowNodeChrome.jsx";

/** @param {import('@xyflow/react').NodeProps} props */
export default function WorkflowInputNode({ id, data, selected }) {
  const label = data?.label || "输入";
  const description = data?.description || "";
  const { source } = getWorkflowHandlePositions(data);
  const chrome = useWorkflowNodeActions(id);
  const flipY = Boolean(data?.flipY);

  return (
    <div className={cn("wf-node wf-node--input", selected && "is-selected")}>
      <div className={cn("wf-node__inner", flipY && "is-flip-y")}>
        <div className="wf-node__badge">输入节点</div>
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
      <Handle type="source" position={source} />
    </div>
  );
}
