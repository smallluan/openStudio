import { Navigate, useLocation, useOutletContext, useParams } from "react-router-dom";
import { useCallback, useEffect } from "react";
import WorkflowEditor from "../components/workflow/WorkflowEditor.jsx";
import { useWorkflowLibrary } from "../workflow/useWorkflowLibrary.js";
import { normalizeWorkflowDocument } from "../workflow/workflowNormalize.js";

export default function WorkflowEditorPage() {
  const { id } = useParams();
  const location = useLocation();
  const { collapsePrimaryRail } = useOutletContext() ?? {};
  const { getWorkflow, updateWorkflow, removeWorkflow } = useWorkflowLibrary();

  useEffect(() => {
    collapsePrimaryRail?.();
  }, [collapsePrimaryRail, id]);

  const stored = id ? getWorkflow(id) : null;
  const bootstrap = location.state?.workflowBootstrap;
  const workflow =
    stored ?? (bootstrap && id && bootstrap.id === id ? normalizeWorkflowDocument(bootstrap) : null);

  const handleSave = useCallback(
    (patch) => {
      if (!id) return;
      updateWorkflow(id, patch);
    },
    [id, updateWorkflow],
  );

  const handleDiscard = useCallback(() => {
    if (!id) return;
    removeWorkflow(id);
  }, [id, removeWorkflow]);

  if (!id || !workflow) {
    return <Navigate to="/workflow" replace />;
  }

  return <WorkflowEditor workflow={workflow} onSave={handleSave} onDiscard={handleDiscard} />;
}
