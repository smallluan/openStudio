import { Hand, MousePointer2 } from "lucide-react";
import { Tooltip } from "tdesign-react";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

/** @typedef {'select' | 'pan'} WorkflowCanvasTool */

/**
 * @param {{
 *   canvasTool: WorkflowCanvasTool;
 *   onCanvasToolChange: (tool: WorkflowCanvasTool) => void;
 *   className?: string;
 * }} props
 */
export default function WorkflowCanvasToolbar({ canvasTool, onCanvasToolChange, className }) {
  const { t } = useI18n();

  const tools = [
    {
      id: /** @type {const} */ ("select"),
      label: t("workflowPage.toolSelect"),
      tip: t("workflowPage.toolSelectTip"),
      icon: MousePointer2,
    },
    {
      id: /** @type {const} */ ("pan"),
      label: t("workflowPage.toolPan"),
      tip: t("workflowPage.toolPanTip"),
      icon: Hand,
    },
  ];

  return (
    <div className={cn("workflow-canvas-toolbar", className)} role="toolbar" aria-label={t("workflowPage.canvasToolbar")}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const active = canvasTool === tool.id;
        return (
          <Tooltip key={tool.id} content={tool.tip} placement="bottom" destroyOnClose>
            <button
              type="button"
              className={cn("workflow-canvas-toolbar__btn", active && "is-active")}
              aria-label={tool.label}
              aria-pressed={active}
              onClick={() => onCanvasToolChange(tool.id)}
            >
              <Icon size={16} strokeWidth={2} aria-hidden />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
