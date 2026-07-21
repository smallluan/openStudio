/** @param {{ name?: string; description?: string; draft?: boolean }} [partial] */
export function createDefaultWorkflow(partial = {}) {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `wf-${Date.now()}`;
  const now = Date.now();

  return {
    id,
    name: partial.name?.trim() ?? "",
    description: partial.description?.trim() ?? "",
    draft: partial.draft !== false,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}
