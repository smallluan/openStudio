import { useCallback } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { WORKFLOW_NODE_TYPES } from "../../workflow/workflowTypes.js";
import { WORKFLOW_DRAG_DATA_KEY } from "./workflowDrag.js";
import { cn } from "../../ui/cn.js";

/** @param {{ type: string; label: string; theme: string }} item */
function PaletteItem({ item }) {
  const handleDragStart = useCallback(
    (event) => {
      event.dataTransfer.setData(
        WORKFLOW_DRAG_DATA_KEY,
        JSON.stringify({ nodeType: item.type, label: item.label }),
      );
      event.dataTransfer.effectAllowed = "copy";
    },
    [item.type, item.label],
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        "workflow-palette-item",
        `workflow-palette-item--${item.theme}`,
      )}
    >
      <span className="workflow-palette-item__dot" aria-hidden />
      <span className="workflow-palette-item__label">{item.label}</span>
    </div>
  );
}

export default function WorkflowNodePalette() {
  const { t } = useI18n();

  const items = [
    { type: WORKFLOW_NODE_TYPES.INPUT, label: t("workflowPage.addInput"), theme: "input" },
    { type: WORKFLOW_NODE_TYPES.OUTPUT, label: t("workflowPage.addOutput"), theme: "output" },
    { type: WORKFLOW_NODE_TYPES.AGENT, label: t("workflowPage.addAgent"), theme: "agent" },
    { type: WORKFLOW_NODE_TYPES.NESTED, label: t("workflowPage.addNested"), theme: "nested" },
  ];

  return (
    <aside className="workflow-node-aside">
      <div className="workflow-node-aside__title">{t("workflowPage.nodePaletteTitle")}</div>
      <p className="workflow-node-aside__hint">{t("workflowPage.nodePaletteHint")}</p>
      <div className="workflow-node-aside__list">
        {items.map((item) => (
          <PaletteItem key={item.type} item={item} />
        ))}
      </div>
    </aside>
  );
}
