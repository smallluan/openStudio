import { useMemo } from "react";
import { ReactFlow, Background, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { workflowNodeTypes } from "./nodes/index.js";
import "./workflow-flow.css";

/** @param {{ nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[]; className?: string }} props */
function FlowPreviewInner({ nodes, edges, className }) {
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        draggable: false,
        selectable: false,
        connectable: false,
        data: { ...n.data, __preview: true },
      })),
    [nodes],
  );

  return (
    <ReactFlow
      className={className}
      nodes={displayNodes}
      edges={edges}
      nodeTypes={workflowNodeTypes}
      fitView
      fitViewOptions={{ padding: 0.35 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} />
    </ReactFlow>
  );
}

/** @param {{ nodes?: import('@xyflow/react').Node[]; edges?: import('@xyflow/react').Edge[]; className?: string }} props */
export default function WorkflowFlowPreview({ nodes = [], edges = [], className = "" }) {
  if (!nodes.length) {
    return (
      <div
        className={`workflow-flow-preview flex items-center justify-center text-[0.72rem] text-[var(--os-text-muted)] ${className}`}
      >
        —
      </div>
    );
  }

  return (
    <div className={`workflow-flow workflow-flow-preview h-full w-full ${className}`}>
      <ReactFlowProvider>
        <FlowPreviewInner nodes={nodes} edges={edges} className="h-full w-full" />
      </ReactFlowProvider>
    </div>
  );
}
