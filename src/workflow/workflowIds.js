/**
 * Build a high-entropy ID segment.
 * Uses UUID when available and falls back to timestamp + random suffix.
 * @param {"node" | "edge"} prefix
 */
function createWorkflowEntityId(prefix) {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  return `${prefix}-${uuid}`;
}

/** @returns {string} */
export function createWorkflowNodeId() {
  return createWorkflowEntityId("node");
}

/** @returns {string} */
export function createWorkflowEdgeId() {
  return createWorkflowEntityId("edge");
}

/**
 * Ensure every edge has a unique ID.
 * Keeps existing IDs when possible, only rewrites missing/duplicate ones.
 * @param {Array<{ id?: string } & Record<string, unknown>>} edges
 */
export function ensureUniqueWorkflowEdgeIds(edges) {
  const used = new Set();
  return edges.map((edge) => {
    const candidate = typeof edge.id === "string" ? edge.id.trim() : "";
    if (candidate && !used.has(candidate)) {
      used.add(candidate);
      return edge;
    }
    const nextId = createWorkflowEdgeId();
    used.add(nextId);
    return { ...edge, id: nextId };
  });
}
