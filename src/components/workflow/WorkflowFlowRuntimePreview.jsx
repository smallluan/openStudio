import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  ReactFlowProvider,
  useReactFlow,
  useNodesInitialized,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { workflowNodeTypes } from "./nodes/index.js";
import WorkflowStepEdge from "./edges/WorkflowStepEdge.jsx";
import { buildWorkflowRuntimeDisplayGraph } from "./utils/workflowRuntimeDisplayUtils.js";
import "./workflow-flow.css";

const workflowEdgeTypes = { workflowStep: WorkflowStepEdge };

/** @param {{ focusNodeIds: string[] }} props */
function FocusActiveNodes({ focusNodeIds }) {
  const { fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const prevKeyRef = useRef("");

  const focusActive = useCallback(async () => {
    const existing = new Set(getNodes().map((n) => n.id));
    const validIds = focusNodeIds.filter((id) => existing.has(id));
    const key = validIds.length ? validIds.join("|") : "__full__";
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    if (!validIds.length) {
      await fitView({ padding: 0.45, duration: 200, maxZoom: 0.85, minZoom: 0.2 });
      return;
    }

    const multi = validIds.length > 1;
    const ok = await fitView({
      nodes: validIds.map((id) => ({ id })),
      padding: multi ? 1.05 : 0.9,
      duration: 400,
      maxZoom: multi ? 0.72 : 0.82,
      minZoom: 0.28,
    });

    if (!ok) {
      prevKeyRef.current = "";
      await fitView({ padding: 0.45, duration: 200, maxZoom: 0.85, minZoom: 0.2 });
    }
  }, [focusNodeIds, fitView, getNodes]);

  useEffect(() => {
    if (!nodesInitialized) return undefined;
    const frame = requestAnimationFrame(() => {
      void focusActive();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusActive, nodesInitialized]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void focusActive();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [focusNodeIds, focusActive]);

  return null;
}

/**
 * @param {{
 *   nodes: import('@xyflow/react').Node[];
 *   edges: import('@xyflow/react').Edge[];
 *   runtime: import('../../workflow/workflowRuntimeRegistry.js').WorkflowSessionRuntimeState | null | undefined;
 *   liveExecution?: import('../../workflow/workflowLiveExecution.js').WorkflowLiveExecution | null;
 *   agentById: Map<string, import('../../studio/agents.js').StudioAgent>;
 *   workflows?: Array<{ id: string; name?: string }>;
 *   className?: string;
 * }} props
 */
function FlowRuntimePreviewInner({ nodes, edges, runtime, liveExecution, agentById, workflows, className }) {
  const { displayNodes, displayEdges, focusNodeIds } = useMemo(() => {
    const graph = buildWorkflowRuntimeDisplayGraph({
      nodes,
      edges,
      runtime,
      liveExecution,
      agentById,
      workflows,
    });
    return {
      displayNodes: graph.nodes,
      displayEdges: graph.edges,
      focusNodeIds: graph.focusNodeIds,
    };
  }, [nodes, edges, runtime, liveExecution, agentById, workflows]);

  return (
    <ReactFlow
      className={className}
      nodes={displayNodes}
      edges={displayEdges}
      nodeTypes={workflowNodeTypes}
      edgeTypes={workflowEdgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling
      minZoom={0.15}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} />
      <FocusActiveNodes focusNodeIds={focusNodeIds} />
    </ReactFlow>
  );
}

/**
 * Read-only workflow diagram with live runtime highlighting for Chat Lab float panel.
 * @param {{
 *   nodes?: import('@xyflow/react').Node[];
 *   edges?: import('@xyflow/react').Edge[];
 *   runtime?: import('../../workflow/workflowRuntimeRegistry.js').WorkflowSessionRuntimeState | null;
 *   liveExecution?: import('../../workflow/workflowLiveExecution.js').WorkflowLiveExecution | null;
 *   agentById: Map<string, import('../../studio/agents.js').StudioAgent>;
 *   workflows?: Array<{ id: string; name?: string }>;
 *   className?: string;
 * }} props
 */
export default function WorkflowFlowRuntimePreview({
  nodes = [],
  edges = [],
  runtime = null,
  liveExecution = null,
  agentById,
  workflows = [],
  className = "",
}) {
  if (!nodes.length) {
    return (
      <div
        className={`workflow-flow-runtime workflow-flow-runtime--empty flex items-center justify-center text-[0.72rem] text-[var(--os-text-muted)] ${className}`}
      >
        —
      </div>
    );
  }

  return (
    <div className={`workflow-flow workflow-flow-runtime h-full w-full ${className}`}>
      <ReactFlowProvider>
        <FlowRuntimePreviewInner
          nodes={nodes}
          edges={edges}
          runtime={runtime}
          liveExecution={liveExecution}
          agentById={agentById}
          workflows={workflows}
          className="h-full w-full"
        />
      </ReactFlowProvider>
    </div>
  );
}
