import { useState } from "react";
import { Button } from "@open-studio/udesign";
import { agentDisplayLabel } from "../../studio/agents.js";
import { orchestrationRoleLabel } from "../../studio/orchestrationRoles.js";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   plan: import("../../studio/orchestration.js").OrchestrationPlan;
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   status: string;
 *   onApprove: () => void;
 *   onReject: () => void;
 *   onRevise: (notes: string) => void;
 *   disabled?: boolean;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
export default function ChatLabOrchestrationPlanCard({
  plan,
  agents,
  status,
  onApprove,
  onReject,
  onRevise,
  disabled,
  t,
}) {
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNotes, setReviseNotes] = useState("");
  const awaiting = status === "awaiting_approval";

  const agentById = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="orch-plan-card">
      <div className="orch-plan-card__header">
        <span className="orch-plan-card__badge">{t("orchestration.planCard.badge")}</span>
        <h3 className="orch-plan-card__title">{t("orchestration.planCard.title")}</h3>
      </div>
      {plan.feasibility ? (
        <p className="orch-plan-card__feasibility">
          <strong>{t("orchestration.planCard.feasibility")}: </strong>
          {plan.feasibility}
        </p>
      ) : null}
      <p className="orch-plan-card__summary">{plan.summary}</p>
      {plan.tasks.length > 0 ? (
        <ul className="orch-plan-card__tasks">
          {plan.tasks.map((task) => {
            const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId) : null;
            const roleLabel = task.ownerRole ? orchestrationRoleLabel(task.ownerRole, t) : "";
            return (
              <li key={task.id} className="orch-plan-card__task">
                <span className="orch-plan-card__task-title">{task.title}</span>
                <span className="orch-plan-card__task-meta">
                  {owner ? agentDisplayLabel(owner) : roleLabel}
                  {task.dependsOn?.length
                    ? ` · ${t("orchestration.planCard.depends", { n: task.dependsOn.length })}`
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {awaiting ? (
        <div className="orch-plan-card__actions">
          {!reviseOpen ? (
            <>
              <Button
                type="button"
                theme="primary"
                size="small"
                className="orch-plan-card__btn orch-plan-card__btn--primary"
                disabled={disabled}
                onClick={onApprove}
              >
                {t("orchestration.planCard.approve")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="small"
                className="orch-plan-card__btn"
                disabled={disabled}
                onClick={() => setReviseOpen(true)}
              >
                {t("orchestration.planCard.revise")}
              </Button>
              <Button
                type="button"
                theme="danger"
                variant="outline"
                size="small"
                className="orch-plan-card__btn orch-plan-card__btn--danger"
                disabled={disabled}
                onClick={onReject}
              >
                {t("orchestration.planCard.reject")}
              </Button>
            </>
          ) : (
            <div className="orch-plan-card__revise">
              <textarea
                className="orch-plan-card__revise-input"
                value={reviseNotes}
                onChange={(e) => setReviseNotes(e.target.value)}
                placeholder={t("orchestration.planCard.revisePlaceholder")}
                rows={3}
                disabled={disabled}
              />
              <div className="orch-plan-card__revise-actions">
                <Button
                  type="button"
                  theme="primary"
                  size="small"
                  className="orch-plan-card__btn orch-plan-card__btn--primary"
                  disabled={disabled || !reviseNotes.trim()}
                  onClick={() => {
                    onRevise(reviseNotes.trim());
                    setReviseOpen(false);
                    setReviseNotes("");
                  }}
                >
                  {t("orchestration.planCard.reviseSubmit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  className="orch-plan-card__btn"
                  disabled={disabled}
                  onClick={() => {
                    setReviseOpen(false);
                    setReviseNotes("");
                  }}
                >
                  {t("orchestration.planCard.reviseCancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className={cn("orch-plan-card__status", `orch-plan-card__status--${status}`)}>
          {t(`orchestration.runStatus.${status}`, { defaultValue: status })}
        </p>
      )}
    </div>
  );
}
