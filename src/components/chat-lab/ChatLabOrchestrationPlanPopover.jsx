import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";
import ChatLabOrchestrationPlanStrip from "./ChatLabOrchestrationPlanStrip.jsx";

function PlanChevron({ open }) {
  return (
    <svg
      className={cn("chat-lab__pill-chevron shrink-0 transition-transform duration-200", open && "rotate-180")}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Compact plan progress chip in the composer toolbar; full plan in a popup.
 * @param {{
 *   plan: import("../../studio/orchestration.js").OrchestrationPlan;
 *   run: import("../../studio/orchestration.js").OrchestrationRun;
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   onApprove: () => void;
 *   onReject: () => void;
 *   onRevise: (notes: string) => void;
 *   onResume?: () => void;
 *   actionsDisabled?: boolean;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
function OrchestrationPlanStatusPanel({ run, t }) {
  return (
    <div className="chat-lab__orch-plan-strip chat-lab__orch-plan-strip--popup">
      <div className="chat-lab__orch-plan-strip-head">
        <span className="chat-lab__orch-plan-strip-badge">{t("orchestration.planCard.badge")}</span>
        <span className="chat-lab__orch-plan-strip-title">{t("orchestration.planCard.title")}</span>
        {run.status ? (
          <span className={cn("chat-lab__orch-plan-strip-status", `chat-lab__orch-plan-strip-status--${run.status}`)}>
            {t(`orchestration.runStatus.${run.status}`, { defaultValue: run.status })}
          </span>
        ) : null}
      </div>
      <p className="chat-lab__orch-plan-strip-planning-hint" role="status">
        {t(`orchestration.planProgress.statusHint.${run.status}`, {
          defaultValue: t("orchestration.planProgress.planningHint"),
        })}
      </p>
    </div>
  );
}

export default function ChatLabOrchestrationPlanPopover({
  plan,
  run,
  agents,
  onApprove,
  onReject,
  onRevise,
  onResume,
  actionsDisabled = false,
  t,
}) {
  const autoId = useId();
  const panelId = `${autoId}-orch-plan`;
  const [open, setOpen] = useState(false);
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);
  const approvalAutoOpenRef = useRef(/** @type {string | null} */ (null));

  const awaiting = run.status === "awaiting_approval";
  const tasks = plan?.tasks ?? [];
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  const hasActive = tasks.some((task) => task.status === "in_progress" || task.id === run.activeTaskId);
  const orchVisible =
    Boolean(run.status && run.status !== "failed") &&
    (total > 0 || ["planning", "revising", "running", "awaiting_approval", "paused"].includes(run.status));
  const planningLike = run.status === "planning" || run.status === "revising";
  const progressLabel = awaiting
    ? t("orchestration.planProgress.awaitingShort")
    : total > 0
      ? `${done}/${total}`
      : t(`orchestration.runStatus.${run.status}`, { defaultValue: run.status });
  const pillBusy = awaiting || hasActive || planningLike;

  useEffect(() => {
    if (!awaiting) {
      approvalAutoOpenRef.current = null;
      return;
    }
    const token = String(run.updatedAt ?? "");
    if (approvalAutoOpenRef.current === token) return;
    approvalAutoOpenRef.current = token;
    setOpen(true);
  }, [awaiting, run.updatedAt]);

  const handleApprove = useCallback(() => {
    onApprove();
    setOpen(false);
  }, [onApprove]);

  const handleReject = useCallback(() => {
    onReject();
    setOpen(false);
  }, [onReject]);

  const handleRevise = useCallback(
    (notes) => {
      onRevise(notes);
      setOpen(false);
    },
    [onRevise],
  );

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "top-start",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  if (!orchVisible) return null;

  return (
    <>
      <Button
        ref={refs.setReference}
        type="button"
        className={cn(
          "chat-lab__pill-btn chat-lab__orch-plan-pill",
          (hasActive || planningLike) && "chat-lab__orch-plan-pill--active",
          awaiting && "chat-lab__orch-plan-pill--awaiting",
        )}
        title={awaiting ? t("orchestration.planProgress.awaitingHint") : t("orchestration.planProgress.hint")}
        aria-label={awaiting ? t("orchestration.planProgress.awaitingHint") : t("orchestration.planProgress.hint")}
        aria-haspopup="dialog"
        aria-expanded={present}
        aria-controls={present ? panelId : undefined}
        {...getReferenceProps()}
      >
        {pillBusy ? (
          <span
            className={cn(
              "chat-lab__orch-plan-pill-spinner",
              awaiting && "chat-lab__orch-plan-pill-spinner--awaiting",
            )}
            aria-hidden
          />
        ) : (
          <span className="chat-lab__orch-plan-pill-dot" aria-hidden />
        )}
        <span className="chat-lab__orch-plan-pill-label">{progressLabel}</span>
        <PlanChevron open={present} />
      </Button>

      {present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="outline-none z-[400] w-[min(100vw-2rem,380px)] max-w-[min(100vw-2rem,380px)]"
              {...getFloatingProps()}
            >
              <FluidPopupAnimatedSurface
                key={surfaceKey}
                leaving={leaving}
                finishLeave={finishLeave}
                placement={context.placement}
                morphBr="14px"
                className={cn(
                  "chat-lab__orch-plan-popover flex w-full flex-col overflow-hidden rounded-[14px] border",
                  "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[var(--os-bg-modal)]",
                  "shadow-[var(--os-shadow-soft)]",
                )}
              >
                <div id={panelId} className="chat-lab__orch-plan-popover-inner">
                  {plan && (total > 0 || run.status === "awaiting_approval") ? (
                    <ChatLabOrchestrationPlanStrip
                      plan={plan}
                      run={run}
                      agents={agents}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      onRevise={handleRevise}
                      onResume={onResume}
                      disabled={actionsDisabled}
                      t={t}
                      variant="popup"
                    />
                  ) : (
                    <OrchestrationPlanStatusPanel run={run} t={t} />
                  )}
                </div>
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
