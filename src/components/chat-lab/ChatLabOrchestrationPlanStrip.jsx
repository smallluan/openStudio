import { useState } from "react";
import { agentDisplayLabel } from "../../studio/agents.js";
import { orchestrationRoleLabel } from "../../studio/orchestrationRoles.js";
import { cn } from "../../ui/cn.js";

/**
 * Compact scrollable phase list above the participant bar (composer scope).
 * @param {{
 *   plan: import("../../studio/orchestration.js").OrchestrationPlan;
 *   run: import("../../studio/orchestration.js").OrchestrationRun;
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   onApprove: () => void;
 *   onReject: () => void;
 *   onRevise: (notes: string) => void;
 *   onResume?: () => void;
 *   disabled?: boolean;
 *   variant?: "strip" | "popup";
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
export default function ChatLabOrchestrationPlanStrip({
  plan,
  run,
  agents,
  onApprove,
  onReject,
  onRevise,
  onResume,
  disabled,
  variant = "strip",
  t,
}) {
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNotes, setReviseNotes] = useState("");
  const awaiting = run.status === "awaiting_approval";
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const activeTaskIds = new Set(
    [
      ...(Array.isArray(run.activeTaskIds) ? run.activeTaskIds : []),
      ...(typeof run.activeTaskId === "string" && run.activeTaskId ? [run.activeTaskId] : []),
    ].filter(Boolean),
  );

  const hasTasks = Boolean(plan?.tasks?.length);
  const userReq = typeof run.userRequirement === "string" ? run.userRequirement.trim() : "";
  const summaryText = typeof plan?.summary === "string" ? plan.summary.trim() : "";
  const showSummary = hasTasks && summaryText && summaryText !== userReq;
  if (!hasTasks && !showSummary) {
    if (!awaiting) return null;
  }

  return (
    <div
      className={cn(
        "chat-lab__orch-plan-strip",
        variant === "popup" && "chat-lab__orch-plan-strip--popup",
      )}
      aria-label={t("orchestration.planCard.title")}
    >
      <div className="chat-lab__orch-plan-strip-head">
        <span className="chat-lab__orch-plan-strip-badge">{t("orchestration.planCard.badge")}</span>
        <span className="chat-lab__orch-plan-strip-title">{t("orchestration.planCard.title")}</span>
        {run.status ? (
          <span className={cn("chat-lab__orch-plan-strip-status", `chat-lab__orch-plan-strip-status--${run.status}`)}>
            {t(`orchestration.runStatus.${run.status}`, { defaultValue: run.status })}
          </span>
        ) : null}
        {run.status === "paused" && onResume ? (
          <button type="button" className="chat-lab__orch-plan-strip-resume" onClick={onResume} disabled={disabled}>
            {t("orchestration.panel.resume")}
          </button>
        ) : null}
      </div>
      {showSummary ? <p className="chat-lab__orch-plan-strip-summary">{plan.summary}</p> : null}
      {hasTasks ? (
      <ol className="chat-lab__orch-plan-strip-phases">
        {plan.tasks.map((task) => {
          const done = task.status === "done";
          const active = activeTaskIds.has(task.id) || task.status === "in_progress";
          const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId) : null;
          const roleLabel = task.ownerRole ? orchestrationRoleLabel(task.ownerRole, t) : "";
          const ownerLabel = owner
            ? agentDisplayLabel(owner)
            : task.ownerAgentId
              ? t("orchestration.planCard.unassignedOwner")
              : roleLabel;
          return (
            <li
              key={task.id}
              className={cn(
                "chat-lab__orch-plan-strip-phase",
                done && "chat-lab__orch-plan-strip-phase--done",
                active && "chat-lab__orch-plan-strip-phase--active",
              )}
            >
              {active && !done ? (
                <span className="chat-lab__orch-plan-strip-phase-spinner" aria-hidden />
              ) : (
                <span className="chat-lab__orch-plan-strip-phase-dot" aria-hidden />
              )}
              <span className="chat-lab__orch-plan-strip-phase-title">{task.title}</span>
              {ownerLabel ? (
                <span className="chat-lab__orch-plan-strip-phase-meta">{ownerLabel}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      ) : null}
      {awaiting ? (
        <div className="chat-lab__orch-plan-strip-actions">
          {!reviseOpen ? (
            <>
              <button
                type="button"
                className="chat-lab__orch-plan-strip-btn chat-lab__orch-plan-strip-btn--primary"
                disabled={disabled}
                onClick={onApprove}
              >
                {t("orchestration.planCard.approve")}
              </button>
              <button
                type="button"
                className="chat-lab__orch-plan-strip-btn"
                disabled={disabled}
                onClick={() => setReviseOpen(true)}
              >
                {t("orchestration.planCard.revise")}
              </button>
              <button
                type="button"
                className="chat-lab__orch-plan-strip-btn chat-lab__orch-plan-strip-btn--danger"
                disabled={disabled}
                onClick={onReject}
              >
                {t("orchestration.planCard.reject")}
              </button>
            </>
          ) : (
            <div className="chat-lab__orch-plan-strip-revise">
              <textarea
                className="chat-lab__orch-plan-strip-revise-input"
                value={reviseNotes}
                onChange={(e) => setReviseNotes(e.target.value)}
                placeholder={t("orchestration.planCard.revisePlaceholder")}
                rows={2}
                disabled={disabled}
              />
              <div className="chat-lab__orch-plan-strip-revise-actions">
                <button
                  type="button"
                  className="chat-lab__orch-plan-strip-btn chat-lab__orch-plan-strip-btn--primary"
                  disabled={disabled || !reviseNotes.trim()}
                  onClick={() => {
                    onRevise(reviseNotes.trim());
                    setReviseOpen(false);
                    setReviseNotes("");
                  }}
                >
                  {t("orchestration.planCard.reviseSubmit")}
                </button>
                <button
                  type="button"
                  className="chat-lab__orch-plan-strip-btn"
                  disabled={disabled}
                  onClick={() => {
                    setReviseOpen(false);
                    setReviseNotes("");
                  }}
                >
                  {t("orchestration.planCard.reviseCancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
