import { useCallback, useEffect, useRef, useState } from "react";
import { createDefaultWorkflow } from "./createDefaultWorkflow.js";
import { normalizeWorkflowDocument } from "./workflowNormalize.js";
import { loadWorkflowLibrary, saveWorkflowLibrary } from "./workflowsLocalStore.js";

const CHANGED_EVENT = "openstudio-workflow-library-changed";

function emitChanged() {
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** @returns {import('./workflowTypes.js').WorkflowLibrarySnapshot} */
export function useWorkflowLibrary() {
  const libRef = useRef(loadWorkflowLibrary());
  const [lib, setLib] = useState(libRef.current);

  const commitLib = useCallback((next) => {
    libRef.current = next;
    saveWorkflowLibrary(next);
    setLib(next);
    emitChanged();
  }, []);

  useEffect(() => {
    const onExternal = () => {
      const fresh = loadWorkflowLibrary();
      libRef.current = fresh;
      setLib(fresh);
    };
    window.addEventListener(CHANGED_EVENT, onExternal);
    return () => window.removeEventListener(CHANGED_EVENT, onExternal);
  }, []);

  const createWorkflow = useCallback(
    (partial) => {
      const doc = createDefaultWorkflow(partial);
      const next = { ...libRef.current, workflows: [...libRef.current.workflows, doc] };
      commitLib(next);
      return doc;
    },
    [commitLib],
  );

  const updateWorkflow = useCallback(
    (id, patch) => {
      const next = {
        ...libRef.current,
        workflows: libRef.current.workflows.map((w) => {
          if (w.id !== id) return w;
          const merged = { ...w, ...patch, updatedAt: Date.now() };
          return normalizeWorkflowDocument(merged) ?? merged;
        }),
      };
      commitLib(next);
    },
    [commitLib],
  );

  const removeWorkflow = useCallback(
    (id) => {
      const next = {
        ...libRef.current,
        workflows: libRef.current.workflows.filter((w) => w.id !== id),
      };
      commitLib(next);
    },
    [commitLib],
  );

  const getWorkflow = useCallback((id) => {
    const raw = libRef.current.workflows.find((w) => w.id === id);
    return raw ? normalizeWorkflowDocument(raw) : null;
  }, []);

  return { lib, createWorkflow, updateWorkflow, removeWorkflow, getWorkflow };
}
