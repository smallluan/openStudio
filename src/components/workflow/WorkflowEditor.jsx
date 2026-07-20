import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@open-studio/udesign";
import { SaveIcon } from "tdesign-icons-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../context/I18nContext.jsx";
import { useStudio } from "../../context/StudioContext.jsx";
import { agentDisplayLabel } from "../../studio/agents.js";
import { useWorkflowLibrary } from "../../workflow/useWorkflowLibrary.js";
import { WORKFLOW_NODE_TYPES } from "../../workflow/workflowTypes.js";
import { normalizeWorkflowGraph, resolveHandoffAgentId } from "./utils/workflowGraphUtils.js";
import WorkflowFlowCanvas from "./WorkflowFlowCanvas.jsx";
import WorkflowNodeDrawer from "./WorkflowNodeDrawer.jsx";
import WorkflowNodePalette from "./WorkflowNodePalette.jsx";
import WorkflowBreadcrumb from "./WorkflowBreadcrumb.jsx";
import WorkflowCanvasToolbar from "./WorkflowCanvasToolbar.jsx";
import Modal from "../../ui/Modal.jsx";
import ModalCloseButton from "../../ui/ModalCloseButton.jsx";
import TextField from "../../ui/TextField.jsx";
import FluidConfirmDialog from "../../ui/FluidConfirmDialog.jsx";
import "./workflow-flow.css";

/** @typedef {import('../../workflow/workflowTypes.js').WorkflowDocument} WorkflowDocument */

/** @param {{ workflow: WorkflowDocument; onSave: (patch: Partial<WorkflowDocument>) => void; onDiscard?: () => void }} props */
export default function WorkflowEditor({ workflow, onSave, onDiscard }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { agentById, mainAgent } = useStudio();
  const { lib } = useWorkflowLibrary();
  const saveTitleId = useId();

  const [nodes, setNodes] = useState(workflow.nodes);
  const [edges, setEdges] = useState(workflow.edges);
  const [viewport, setViewport] = useState(workflow.viewport);
  const [selectedNodeId, setSelectedNodeId] = useState(/** @type {string | null} */ (null));
  const [configNodeId, setConfigNodeId] = useState(/** @type {string | null} */ (null));
  const [saveOpen, setSaveOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [canvasTool, setCanvasTool] = useState(/** @type {'select' | 'pan'} */ ("pan"));
  const [saveName, setSaveName] = useState(workflow.name);
  const [saveDesc, setSaveDesc] = useState(workflow.description);

  const isDraft = Boolean(workflow.draft);

  useEffect(() => {
    const normalized = normalizeWorkflowGraph(workflow.nodes, workflow.edges);
    setNodes(normalized.nodes);
    setEdges(normalized.edges);
    setViewport(workflow.viewport);
    setSaveName(workflow.name);
    setSaveDesc(workflow.description);
    setSelectedNodeId(null);
    setConfigNodeId(null);
  }, [workflow.id]);

  const enrichedNodes = useMemo(() => {
    return nodes.map((n) => {
      if (n.type === WORKFLOW_NODE_TYPES.AGENT) {
        let agentId = n.data?.agentId;
        if (!agentId && n.data?.handoffSourceNodeId) {
          const parent = nodes.find((candidate) => candidate.id === n.data.handoffSourceNodeId);
          agentId = parent?.data?.agentId ?? null;
        }
        const agent = agentId ? agentById.get(String(agentId)) : null;
        return { ...n, data: { ...n.data, agentName: agent ? agentDisplayLabel(agent) : undefined } };
      }
      if (n.type === WORKFLOW_NODE_TYPES.SUB_AGENT) {
        let agentId = n.data?.agentId;
        if (!agentId) {
          const parentAgentNodeId = resolveHandoffAgentId(n.id, nodes, edges);
          const parent = parentAgentNodeId ? nodes.find((candidate) => candidate.id === parentAgentNodeId) : null;
          agentId = parent?.data?.agentId ?? null;
        }
        const agent = agentId ? agentById.get(String(agentId)) : null;
        return { ...n, data: { ...n.data, agentName: agent ? agentDisplayLabel(agent) : undefined } };
      }
      if (n.type === WORKFLOW_NODE_TYPES.NESTED) {
        const wfId = n.data?.workflowId;
        const wf = wfId ? lib.workflows.find((w) => w.id === wfId) : null;
        return { ...n, data: { ...n.data, workflowName: wf?.name } };
      }
      return n;
    });
  }, [nodes, edges, agentById, lib.workflows]);

  const configNode = useMemo(
    () => (configNodeId ? enrichedNodes.find((n) => n.id === configNodeId) ?? null : null),
    [enrichedNodes, configNodeId],
  );

  const persist = useCallback(
    (patch) => {
      const shouldNormalize = Boolean(patch.nodes || patch.edges);
      const normalized = shouldNormalize
        ? normalizeWorkflowGraph(patch.nodes ?? nodes, patch.edges ?? edges)
        : { nodes: patch.nodes ?? nodes, edges: patch.edges ?? edges };

      if (patch.nodes || shouldNormalize) setNodes(normalized.nodes);
      if (patch.edges || shouldNormalize) setEdges(normalized.edges);
      if (patch.viewport) setViewport(patch.viewport);

      onSave({
        ...patch,
        nodes: normalized.nodes,
        edges: normalized.edges,
        viewport: patch.viewport ?? viewport,
      });
    },
    [nodes, edges, viewport, onSave],
  );

  const onGraphChange = useCallback(
    (patch) => {
      persist(patch);
    },
    [persist],
  );

  const handleNodeApply = useCallback(
    (nodeId, data) => {
      const nextNodes = nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
      persist({ nodes: nextNodes });
      setConfigNodeId(null);
    },
    [nodes, persist],
  );

  const openSaveModal = useCallback(() => {
    setSaveName(workflow.name || saveName);
    setSaveDesc(workflow.description || saveDesc);
    setSaveOpen(true);
  }, [workflow.name, workflow.description, saveName, saveDesc]);

  const handleConfirmSave = useCallback(() => {
    const trimmedName = saveName.trim();
    if (!trimmedName) return;
    const wasDraft = isDraft;
    onSave({
      nodes,
      edges,
      viewport,
      name: trimmedName,
      description: saveDesc.trim(),
      draft: false,
    });
    setSaveOpen(false);
    if (wasDraft) {
      navigate("/workflow");
    }
  }, [saveName, saveDesc, nodes, edges, viewport, isDraft, onSave, navigate]);

  const leaveEditor = useCallback(() => {
    navigate("/workflow");
  }, [navigate]);

  const handleNavigateToList = useCallback(() => {
    if (isDraft) {
      setLeaveConfirmOpen(true);
      return;
    }
    leaveEditor();
  }, [isDraft, leaveEditor]);

  const handleConfirmLeave = useCallback(() => {
    onDiscard?.();
    leaveEditor();
  }, [onDiscard, leaveEditor]);

  const breadcrumbItems = useMemo(() => {
    const currentLabel = isDraft
      ? t("workflowPage.breadcrumbNew")
      : workflow.name?.trim() || t("workflowPage.unnamed");
    return [
      { label: t("workflowPage.breadcrumbHome"), onClick: () => navigate("/chat") },
      { label: t("nav.workflow"), onClick: handleNavigateToList },
      { label: currentLabel },
    ];
  }, [isDraft, workflow.name, t, navigate, handleNavigateToList]);

  return (
    <div className="workflow-editor-shell route-page route-page--workflow flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <header className="workflow-editor-toolbar">
        <WorkflowBreadcrumb items={breadcrumbItems} className="workflow-editor-toolbar__left min-w-0" />
        <WorkflowCanvasToolbar
          className="workflow-editor-toolbar__center"
          canvasTool={canvasTool}
          onCanvasToolChange={setCanvasTool}
        />
        <div className="workflow-editor-toolbar__right">
          <Button type="button" theme="primary" size="small" icon={<SaveIcon />} onClick={openSaveModal}>
            {t("workflowPage.save")}
          </Button>
        </div>
      </header>

      <div className="workflow-editor-body min-h-0 flex-1">
        <WorkflowNodePalette />
        <div className="workflow-editor-canvas-wrap min-h-0 min-w-0 flex-1">
          <WorkflowFlowCanvas
            nodes={enrichedNodes}
            edges={edges}
            viewport={viewport}
            onGraphChange={onGraphChange}
            selectedNodeId={selectedNodeId}
            onSelectedNodeIdChange={setSelectedNodeId}
            onConfigNodeIdChange={setConfigNodeId}
            canvasTool={canvasTool}
            defaultStudioAgentId={mainAgent?.id ?? null}
          />
          <WorkflowNodeDrawer
            node={configNode}
            nodes={nodes}
            edges={edges}
            workflows={lib.workflows.filter((w) => !w.draft && w.id !== workflow.id)}
            currentWorkflowId={workflow.id}
            open={Boolean(configNode)}
            onClose={() => setConfigNodeId(null)}
            onApply={handleNodeApply}
          />
        </div>
      </div>

      {saveOpen ? (
        <Modal onClose={() => setSaveOpen(false)} labelledBy={saveTitleId} width="400px">
          <div className="flex w-full flex-col bg-[var(--os-bg-modal)]">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={saveTitleId} className="text-base font-semibold">
                {t("workflowPage.saveTitle")}
              </h2>
              <ModalCloseButton onClick={() => setSaveOpen(false)} />
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("workflowPage.namePlaceholder")}
                <TextField
                  size="small"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={t("workflowPage.namePlaceholder")}
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("workflowPage.descPlaceholder")}
                <TextField
                  size="small"
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder={t("workflowPage.descPlaceholder")}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <Button type="button" variant="text" onClick={() => setSaveOpen(false)}>
                {t("workflowPage.cancel")}
              </Button>
              <Button type="button" theme="primary" disabled={!saveName.trim()} onClick={handleConfirmSave}>
                {t("workflowPage.save")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <FluidConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        danger
        onConfirm={handleConfirmLeave}
      >
        {t("workflowPage.leaveDraftConfirm")}
      </FluidConfirmDialog>
    </div>
  );
}
