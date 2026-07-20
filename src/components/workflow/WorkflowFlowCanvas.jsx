import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  SelectionMode,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { workflowNodeTypes } from "./nodes/index.js";
import WorkflowStepEdge from "./edges/WorkflowStepEdge.jsx";
import { WorkflowNodeActionsContext } from "./context/WorkflowNodeActionsContext.jsx";
import WorkflowContextMenu from "./WorkflowContextMenu.jsx";
import { WORKFLOW_NODE_TYPES } from "../../workflow/workflowTypes.js";
import { WORKFLOW_DRAG_DATA_KEY } from "./workflowDrag.js";
import {
  copyWorkflowSubgraph,
  createWorkflowNodeId,
  deleteWorkflowNode,
  deleteWorkflowNodes,
  flipWorkflowNode,
  pasteWorkflowSubgraph,
  sanitizeWorkflowNodes,
} from "./utils/workflowNodeHandles.js";
import { computeReachableFromNode, getWorkflowNodeAccentColor, applySubAgentHandoffOnConnect, isValidWorkflowConnection } from "./utils/workflowGraphUtils.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";
import "./workflow-flow.css";

const SNAP_GRID = [16, 16];

const workflowEdgeTypes = { workflowStep: WorkflowStepEdge };

function snapPosition(pos) {
  const [gx, gy] = SNAP_GRID;
  return {
    x: Math.round(pos.x / gx) * gx,
    y: Math.round(pos.y / gy) * gy,
  };
}

/** @param {{ nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[]; viewport?: { x: number; y: number; zoom: number }; onGraphChange: (patch: { nodes?: import('@xyflow/react').Node[]; edges?: import('@xyflow/react').Edge[]; viewport?: { x: number; y: number; zoom: number } }) => void; selectedNodeId: string | null; onSelectedNodeIdChange: (id: string | null) => void; onConfigNodeIdChange: (id: string | null) => void; canvasTool?: 'select' | 'pan'; defaultStudioAgentId?: string | null }} props */
function FlowCanvasInner({
  nodes,
  edges,
  viewport,
  onGraphChange,
  selectedNodeId,
  onSelectedNodeIdChange,
  onConfigNodeIdChange,
  canvasTool = "pan",
  defaultStudioAgentId = null,
}) {
  const { t } = useI18n();
  const { setViewport, screenToFlowPosition } = useReactFlow();
  const nodeDragRef = useRef(false);
  const clipboardRef = useRef(/** @type {{ nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[] } | null} */ (null));
  const [contextMenu, setContextMenu] = useState(
    /** @type {{ kind: 'node' | 'edge' | 'pane'; x: number; y: number; nodeId?: string; edgeId?: string; flowX?: number; flowY?: number } | null} */ (
      null
    ),
  );

  useEffect(() => {
    if (viewport) {
      setViewport(viewport, { duration: 0 });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const defaultEdgeColor = "color-mix(in srgb, var(--os-text-muted) 70%, var(--os-border))";

  const activeNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId],
  );

  const reachable = useMemo(() => {
    if (!selectedNodeId) return { nodeIds: new Set(), edgeIds: new Set() };
    return computeReachableFromNode(selectedNodeId, edges);
  }, [selectedNodeId, edges]);

  const highlightColor = useMemo(
    () => (activeNode?.type ? getWorkflowNodeAccentColor(activeNode.type) : defaultEdgeColor),
    [activeNode?.type, defaultEdgeColor],
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isReachable = selectedNodeId ? reachable.edgeIds.has(edge.id) : false;
        const stroke = isReachable ? highlightColor : defaultEdgeColor;
        return {
          ...edge,
          type: "workflowStep",
          animated: isReachable,
          style: {
            ...edge.style,
            stroke,
            strokeWidth: isReachable ? 2 : 1.6,
            opacity: selectedNodeId && !isReachable ? 0.32 : 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
          },
        };
      }),
    [edges, selectedNodeId, reachable.edgeIds, highlightColor, defaultEdgeColor],
  );

  const applyGraph = useCallback(
    (nextNodes, nextEdges) => {
      onGraphChange({ nodes: nextNodes, edges: nextEdges });
    },
    [onGraphChange],
  );

  const onNodesChange = useCallback(
    (changes) => {
      const meaningfulChanges = changes.filter((change) => change.type !== "select");
      if (!meaningfulChanges.length) return;

      const nextNodes = sanitizeWorkflowNodes(applyNodeChanges(meaningfulChanges, nodes));
      const removedIds = meaningfulChanges.filter((c) => c.type === "remove").map((c) => c.id);
      let nextEdges = edges;
      if (removedIds.length) {
        const idSet = new Set(removedIds);
        nextEdges = edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
        if (selectedNodeId && idSet.has(selectedNodeId)) {
          onSelectedNodeIdChange(null);
          onConfigNodeIdChange(null);
        }
      }
      onGraphChange({ nodes: nextNodes, edges: nextEdges });
    },
    [nodes, edges, onGraphChange, selectedNodeId, onSelectedNodeIdChange, onConfigNodeIdChange],
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onGraphChange({ edges: applyEdgeChanges(changes, edges) });
    },
    [edges, onGraphChange],
  );

  const onConnect = useCallback(
    (connection) => {
      if (!isValidWorkflowConnection(connection, nodes)) return;

      const handoffResult = applySubAgentHandoffOnConnect(connection, nodes, edges);
      if (handoffResult?.consumed) {
        onGraphChange({ nodes: handoffResult.nodes, edges: handoffResult.edges });
        return;
      }

      onGraphChange({
        edges: addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${Date.now()}`,
            type: "workflowStep",
            animated: false,
          },
          edges,
        ),
      });
    },
    [edges, nodes, onGraphChange],
  );

  const isValidConnection = useCallback(
    (connection) => isValidWorkflowConnection(connection, nodes),
    [nodes],
  );

  const onMoveEnd = useCallback(
    (_evt, vp) => {
      onGraphChange({ viewport: vp });
    },
    [onGraphChange],
  );

  const onNodeClick = useCallback(
    (_evt, node) => {
      onSelectedNodeIdChange(node.id);
      if (nodeDragRef.current) {
        nodeDragRef.current = false;
        return;
      }
      onConfigNodeIdChange(node.id);
    },
    [onSelectedNodeIdChange, onConfigNodeIdChange],
  );

  const onNodeDragStart = useCallback(
    (_evt, node) => {
      nodeDragRef.current = true;
      onSelectedNodeIdChange(node.id);
    },
    [onSelectedNodeIdChange],
  );

  const onPaneClick = useCallback(() => {
    onSelectedNodeIdChange(null);
    onConfigNodeIdChange(null);
    setContextMenu(null);
  }, [onSelectedNodeIdChange, onConfigNodeIdChange]);

  const handleDeleteNode = useCallback(
    (nodeId) => {
      const next = deleteWorkflowNode(nodeId, nodes, edges);
      applyGraph(next.nodes, next.edges);
      if (selectedNodeId === nodeId) {
        onSelectedNodeIdChange(null);
        onConfigNodeIdChange(null);
      }
    },
    [nodes, edges, applyGraph, selectedNodeId, onSelectedNodeIdChange, onConfigNodeIdChange],
  );

  const handleFlipNode = useCallback(
    (nodeId, axis) => {
      const next = flipWorkflowNode(nodeId, axis, nodes, edges);
      applyGraph(next.nodes, next.edges);
    },
    [nodes, edges, applyGraph],
  );

  const handleDeleteEdge = useCallback(
    (edgeId) => {
      applyGraph(
        nodes,
        edges.filter((e) => e.id !== edgeId),
      );
    },
    [nodes, edges, applyGraph],
  );

  const handleCopy = useCallback(() => {
    if (selectedNodeId) {
      const targetNodes = nodes.filter((n) => n.id === selectedNodeId);
      if (!targetNodes.length) return;
      const idSet = new Set(targetNodes.map((n) => n.id));
      const subEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
      clipboardRef.current = {
        nodes: structuredClone(targetNodes),
        edges: structuredClone(subEdges),
      };
      return;
    }
    const clip = copyWorkflowSubgraph(nodes, edges);
    if (clip) clipboardRef.current = clip;
  }, [nodes, edges, selectedNodeId]);

  const handlePaste = useCallback(
    (anchorFlow) => {
      if (!clipboardRef.current) return;
      const next = pasteWorkflowSubgraph(clipboardRef.current, anchorFlow, nodes, edges);
      applyGraph(next.nodes, next.edges);
    },
    [nodes, edges, applyGraph],
  );

  const handleDeleteSelected = useCallback(() => {
    const selectedIds = selectedNodeId ? [selectedNodeId] : nodes.filter((n) => n.selected).map((n) => n.id);
    if (!selectedIds.length) return;
    const next = deleteWorkflowNodes(selectedIds, nodes, edges);
    applyGraph(next.nodes, next.edges);
    if (selectedNodeId && selectedIds.includes(selectedNodeId)) {
      onSelectedNodeIdChange(null);
      onConfigNodeIdChange(null);
    }
  }, [nodes, edges, applyGraph, selectedNodeId, onSelectedNodeIdChange, onConfigNodeIdChange]);

  const openNodeConfig = useCallback(
    (nodeId) => {
      onSelectedNodeIdChange(nodeId);
      onConfigNodeIdChange(nodeId);
    },
    [onSelectedNodeIdChange, onConfigNodeIdChange],
  );

  const nodeActions = useMemo(
    () => ({
      deleteNode: handleDeleteNode,
      flipHorizontal: (nodeId) => handleFlipNode(nodeId, "x"),
      flipVertical: (nodeId) => handleFlipNode(nodeId, "y"),
      configureNode: openNodeConfig,
    }),
    [handleDeleteNode, handleFlipNode, openNodeConfig],
  );

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(WORKFLOW_DRAG_DATA_KEY);
      if (!raw) return;

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload?.nodeType) return;

      const position = snapPosition(
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
      const node = createWorkflowNode(payload.nodeType, position, { defaultStudioAgentId });
      onGraphChange({ nodes: [...nodes, node] });
      onSelectedNodeIdChange(node.id);
    },
    [nodes, onGraphChange, onSelectedNodeIdChange, screenToFlowPosition, defaultStudioAgentId],
  );

  const onNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    onSelectedNodeIdChange(node.id);
    setContextMenu({ kind: "node", x: event.clientX, y: event.clientY, nodeId: node.id });
  }, [onSelectedNodeIdChange]);

  const onEdgeContextMenu = useCallback((event, edge) => {
    event.preventDefault();
    setContextMenu({ kind: "edge", x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const onPaneContextMenu = useCallback(
    (event) => {
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setContextMenu({
        kind: "pane",
        x: event.clientX,
        y: event.clientY,
        flowX: position.x,
        flowY: position.y,
      });
    },
    [screenToFlowPosition],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "c") {
        event.preventDefault();
        handleCopy();
      }
      if (meta && event.key.toLowerCase() === "v") {
        event.preventDefault();
        handlePaste();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCopy, handlePaste]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
      })),
    [nodes, selectedNodeId],
  );

  const menuItems = useMemo(() => {
    if (!contextMenu) return [];
    if (contextMenu.kind === "node" && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      return [
        { id: "configure", label: t("workflowPage.ctxConfigure"), onClick: () => openNodeConfig(nodeId) },
        { id: "flip-h", label: t("workflowPage.ctxFlipH"), onClick: () => handleFlipNode(nodeId, "x") },
        { id: "flip-v", label: t("workflowPage.ctxFlipV"), onClick: () => handleFlipNode(nodeId, "y") },
        { id: "delete", label: t("workflowPage.ctxDeleteNode"), onClick: () => handleDeleteNode(nodeId), danger: true },
      ];
    }
    if (contextMenu.kind === "edge" && contextMenu.edgeId) {
      return [
        {
          id: "delete-edge",
          label: t("workflowPage.ctxDeleteEdge"),
          onClick: () => handleDeleteEdge(contextMenu.edgeId),
          danger: true,
        },
      ];
    }
    if (contextMenu.kind === "pane") {
      const hasClipboard = Boolean(clipboardRef.current?.nodes?.length);
      const hasSelection = Boolean(selectedNodeId) || nodes.some((n) => n.selected);
      return [
        {
          id: "paste",
          label: t("workflowPage.ctxPaste"),
          onClick: () => handlePaste(contextMenu.flowX != null ? { x: contextMenu.flowX, y: contextMenu.flowY } : undefined),
          disabled: !hasClipboard,
        },
        { id: "copy", label: t("workflowPage.ctxCopy"), onClick: handleCopy, disabled: !hasSelection },
        {
          id: "delete-selected",
          label: t("workflowPage.ctxDeleteSelected"),
          onClick: handleDeleteSelected,
          disabled: !hasSelection,
          danger: true,
        },
      ];
    }
    return [];
  }, [
    contextMenu,
    t,
    openNodeConfig,
    handleFlipNode,
    handleDeleteNode,
    handleDeleteEdge,
    handlePaste,
    handleCopy,
    handleDeleteSelected,
    nodes,
  ]);

  return (
    <WorkflowNodeActionsContext.Provider value={nodeActions}>
      <ReactFlow
        className={cn(
          "workflow-flow workflow-flow-canvas h-full w-full",
          canvasTool === "pan" && "workflow-flow-canvas--pan",
        )}
        nodes={displayNodes}
        edges={renderedEdges}
        nodeTypes={workflowNodeTypes}
        edgeTypes={workflowEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onMoveEnd={onMoveEnd}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onPaneClick={onPaneClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        snapToGrid
        snapGrid={SNAP_GRID}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={["Backspace", "Delete"]}
        selectionOnDrag={canvasTool === "select"}
        multiSelectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        panOnDrag={canvasTool === "select" ? [1] : true}
        panActivationKeyCode="Space"
        selectionKeyCode={null}
        connectionLineType="smoothstep"
        connectionLineStyle={{ stroke: defaultEdgeColor, strokeWidth: 1.6 }}
        defaultEdgeOptions={{
          type: "workflowStep",
          animated: false,
          style: { stroke: defaultEdgeColor, strokeWidth: 1.6 },
          markerEnd: { type: MarkerType.ArrowClosed, color: defaultEdgeColor },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        {nodes.length <= 40 ? <MiniMap zoomable pannable /> : null}
      </ReactFlow>

      {contextMenu ? (
        <WorkflowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </WorkflowNodeActionsContext.Provider>
  );
}

/** @param {{ nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[]; viewport?: { x: number; y: number; zoom: number }; onGraphChange: (patch: { nodes?: import('@xyflow/react').Node[]; edges?: import('@xyflow/react').Edge[]; viewport?: { x: number; y: number; zoom: number } }) => void; selectedNodeId: string | null; onSelectedNodeIdChange: (id: string | null) => void; onConfigNodeIdChange: (id: string | null) => void; canvasTool?: 'select' | 'pan'; defaultStudioAgentId?: string | null }} props */
export default function WorkflowFlowCanvas(props) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/**
 * @param {typeof WORKFLOW_NODE_TYPES[keyof typeof WORKFLOW_NODE_TYPES]} type
 * @param {{ x: number; y: number }} [position]
 * @param {{ defaultStudioAgentId?: string | null }} [options]
 */
export function createWorkflowNode(type, position, options = {}) {
  const defaultStudioAgentId = options.defaultStudioAgentId ?? null;
  const id = createWorkflowNodeId();
  const base = { id, type, position: position ?? { x: 200, y: 200 } };
  switch (type) {
    case WORKFLOW_NODE_TYPES.INPUT:
      return { ...base, data: { label: "输入", description: "", flipX: false, flipY: false } };
    case WORKFLOW_NODE_TYPES.OUTPUT:
      return { ...base, data: { label: "输出", description: "", flipX: false, flipY: false } };
    case WORKFLOW_NODE_TYPES.AGENT:
      return {
        ...base,
        data: {
          label: "智能体",
          description: "",
          agentId: defaultStudioAgentId,
          skillOverrides: { bind: [], unbind: [] },
          flipX: false,
          flipY: false,
        },
      };
    case WORKFLOW_NODE_TYPES.NESTED:
      return { ...base, data: { label: "嵌套工作流", description: "", workflowId: null, flipX: false, flipY: false } };
    case WORKFLOW_NODE_TYPES.SUB_AGENT:
      return {
        ...base,
        data: {
          label: "子智能体",
          description: "",
          agentId: null,
          task: "",
          flipX: false,
          flipY: false,
        },
      };
    default:
      return { ...base, data: { label: "节点", flipX: false, flipY: false } };
  }
}
