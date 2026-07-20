import { BaseEdge, Position, getSmoothStepPath } from "@xyflow/react";

/** @param {import('@xyflow/react').EdgeProps} props */
export default function WorkflowStepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: sourcePosition ?? Position.Right,
    targetPosition: targetPosition ?? Position.Left,
    borderRadius: 0,
    offset: 14,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={style}
      className={selected ? "wf-edge-path is-selected" : "wf-edge-path"}
    />
  );
}
