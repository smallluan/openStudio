import { DeleteIcon, MirrorIcon, SwapIcon } from "tdesign-icons-react";
import { cn } from "../../../ui/cn.js";

/** @param {{ onDelete?: () => void; onFlipHorizontal?: () => void; onFlipVertical?: () => void; className?: string; flipVerticalDisabled?: boolean }} props */
export default function WorkflowNodeChrome({
  onDelete,
  onFlipHorizontal,
  onFlipVertical,
  className,
  flipVerticalDisabled = false,
}) {
  const stopBubble = (event) => {
    event.stopPropagation();
  };

  return (
    <div
      className={cn("wf-node-chrome nodrag nopan", className)}
      onMouseDown={stopBubble}
      onClick={stopBubble}
    >
      <button type="button" className="wf-node-chrome__btn" title="删除节点" onClick={() => onDelete?.()}>
        <DeleteIcon size="13px" />
      </button>
      <button type="button" className="wf-node-chrome__btn" title="水平翻转" onClick={() => onFlipHorizontal?.()}>
        <SwapIcon size="13px" />
      </button>
      <button
        type="button"
        className="wf-node-chrome__btn"
        title="垂直翻转"
        disabled={flipVerticalDisabled}
        onClick={() => onFlipVertical?.()}
      >
        <MirrorIcon size="13px" />
      </button>
    </div>
  );
}
