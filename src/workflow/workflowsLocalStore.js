/** @typedef {import('./workflowTypes.js').WorkflowLibrarySnapshot} WorkflowLibrarySnapshot */

const STORAGE_KEY = "openstudio_workflows_v1";

/** @returns {WorkflowLibrarySnapshot} */
export function loadWorkflowLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workflows: [] };
    const data = JSON.parse(raw);
    return {
      workflows: Array.isArray(data.workflows) ? data.workflows : [],
    };
  } catch {
    return { workflows: [] };
  }
}

/** @param {WorkflowLibrarySnapshot} lib */
export function saveWorkflowLibrary(lib) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ workflows: lib.workflows }));
  } catch {
    /* ignore quota / private mode */
  }
}
