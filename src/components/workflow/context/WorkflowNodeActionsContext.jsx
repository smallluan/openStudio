import { createContext, useContext } from "react";

/** @typedef {{
 *   deleteNode: (nodeId: string) => void;
 *   flipHorizontal: (nodeId: string) => void;
 *   flipVertical: (nodeId: string) => void;
 *   configureNode: (nodeId: string) => void;
 * }} WorkflowNodeActionsValue */

export const WorkflowNodeActionsContext = createContext(/** @type {WorkflowNodeActionsValue | null} */ (null));

/** @param {string} nodeId */
export function useWorkflowNodeActions(nodeId) {
  const actions = useContext(WorkflowNodeActionsContext);
  return {
    onDelete: () => actions?.deleteNode(nodeId),
    onFlipHorizontal: () => actions?.flipHorizontal(nodeId),
    onFlipVertical: () => actions?.flipVertical(nodeId),
    onConfigure: () => actions?.configureNode(nodeId),
  };
}
