import { useCallback, useMemo, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { MessagePlugin } from "tdesign-react";
import "tdesign-react/es/message/style/index.css";
import { Bot, Clock, Plus, Radio } from "lucide-react";
import OsEmpty from "../ui/OsEmpty.jsx";
import AutomationTaskDialog from "../components/automation/AutomationTaskDialog.jsx";
import FluidConfirmDialog from "../ui/FluidConfirmDialog.jsx";
import taskHero from "../assets/images/task-hero.png";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { useStudio } from "../context/StudioContext.jsx";
import { cn } from "../ui/cn.js";
import { buildAutomationCronMessage } from "../automation/buildAutomationCronMessage.js";
import {
  formatAutomationChannelLabel,
  formatAutomationScheduleLabel,
} from "../automation/formatAutomationScheduleLabel.js";
import {
  automationTaskStatusTone,
  formatAutomationTaskErrorDetail,
  formatAutomationTaskStatusLabel,
} from "../automation/formatAutomationTaskStatus.js";
import { useAutomationTasks } from "../automation/useAutomationTasks.js";
import { useNowMs } from "../automation/useNowMs.js";

/** @param {{ className?: string; children: React.ReactNode }} props */
function AutomationCardShell({ className, children }) {
  return (
    <article
      className={cn(
        "group relative flex min-h-[168px] flex-col overflow-hidden rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] transition-[box-shadow,transform] duration-150",
        "hover:shadow-[0_10px_28px_-12px_color-mix(in_srgb,var(--os-shadow-color,#000)_28%,transparent)]",
        className,
      )}
    >
      {children}
    </article>
  );
}

export default function AutomationPage() {
  const { t } = useI18n();
  const { agentById } = useStudio();
  const [query, setQuery] = useState("");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(/** @type {string | null} */ (null));
  const [runningNowIds, setRunningNowIds] = useState(/** @type {Set<string>} */ (() => new Set()));
  const { tasks, loading, createTask, removeTask, runTaskNow } = useAutomationTasks();
  const nowMs = useNowMs();

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return tasks;
    return tasks.filter((task) => {
      const hay = `${task.name} ${task.prompt} ${task.channel}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [tasks, normalizedQuery]);

  const showCreateError = useCallback((content) => {
    MessagePlugin.error({
      content,
      attach: () => document.body,
      placement: "top",
      duration: 4000,
      zIndex: 10001,
    });
  }, []);

  const showCreateSuccess = useCallback((content) => {
    MessagePlugin.success({
      content,
      attach: () => document.body,
      placement: "top",
      duration: 2500,
      zIndex: 10001,
    });
  }, []);

  const handleTaskSubmit = useCallback(
    async (draft) => {
      setSubmitting(true);
      try {
        const message = buildAutomationCronMessage(draft, { agentById });
        const result = await createTask(draft, message);
        if (result?.ok) {
          setTaskDialogOpen(false);
          showCreateSuccess(t("automationPage.taskCreateSuccess"));
          return;
        }
        const err = String(result?.error ?? "create_failed");
        if (err === "missing_gateway_url") {
          showCreateError(t("chatLab.gatewayUrlMissing"));
        } else {
          showCreateError(t("automationPage.taskCreateFailed", { detail: err }));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [agentById, createTask, showCreateError, showCreateSuccess, t],
  );

  const handleDelete = useCallback((e, cronJobId) => {
    e.stopPropagation();
    setPendingDeleteId(cronJobId);
    setDeleteConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    const result = await removeTask(pendingDeleteId);
    if (!result?.ok) {
      showCreateError(t("automationPage.taskDeleteFailed", { detail: String(result?.error ?? "") }));
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, removeTask, showCreateError, t]);

  const handleRunNow = useCallback(
    async (e, cronJobId) => {
      e.stopPropagation();
      if (runningNowIds.has(cronJobId)) return;
      setRunningNowIds((prev) => new Set(prev).add(cronJobId));
      try {
        const result = await runTaskNow(cronJobId);
        if (result?.ok) {
          showCreateSuccess(t("automationPage.runNowSuccess"));
        } else {
          showCreateError(t("automationPage.runNowFailed", { detail: String(result?.error ?? "") }));
        }
      } finally {
        setRunningNowIds((prev) => {
          const next = new Set(prev);
          next.delete(cronJobId);
          return next;
        });
      }
    },
    [runningNowIds, runTaskNow, showCreateError, showCreateSuccess, t],
  );

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <section className="mb-6 flex shrink-0 flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 className="text-[1.65rem] font-semibold tracking-tight text-[var(--os-text)]">
            {t("automationPage.heroTitle")}
          </h1>
          <p className="max-w-lg text-[0.875rem] leading-relaxed text-[var(--os-text-muted)]">
            {t("automationPage.heroDesc")}
          </p>
          <div className="pt-1">
            <Button
              type="button"
              theme="primary"
              icon={<Plus size={16} />}
              onClick={() => setTaskDialogOpen(true)}
            >
              {t("automationPage.heroCreate")}
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center lg:justify-end">
          <img
            src={taskHero}
            alt=""
            className="h-auto max-h-[min(220px,32vw)] w-full max-w-[min(360px,88vw)] object-contain"
          />
        </div>
      </section>

      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[1.05rem] font-semibold text-[var(--os-text)]">{t("automationPage.listTitle")}</h2>
        <div className="w-full min-w-[220px] max-w-md sm:w-72">
          <Input
            type="search"
            prefixIcon={<SearchSparkleIcon className="opacity-75" aria-hidden />}
            clearable
            value={query}
            onChange={(value) => setQuery(value)}
            placeholder={t("automationPage.searchPlaceholder")}
            aria-label={t("automationPage.searchPlaceholder")}
          />
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto pb-10",
          filtered.length === 0 && "flex items-center justify-center pb-0",
        )}
      >
        {loading ? (
          <p className="text-[0.82rem] text-[var(--os-text-muted)]">{t("automationPage.loading")}</p>
        ) : filtered.length === 0 ? (
          <OsEmpty description={t("automationPage.emptyList")} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((task) => {
              const meta = task.meta && typeof task.meta === "object" ? task.meta : {};
              const scheduleLabel = formatAutomationScheduleLabel(meta, t);
              const channelLabel = formatAutomationChannelLabel(task.channel, t);
              const statusLabel = formatAutomationTaskStatusLabel(task, nowMs, t);
              const statusTone = automationTaskStatusTone(task, nowMs);
              const errorDetail = formatAutomationTaskErrorDetail(task);
              const isRunningNow = runningNowIds.has(task.cronJobId);
              const isJobRunning = task.lastRunStatus === "running" || isRunningNow;
              const statusClass =
                statusTone === "danger"
                  ? "text-[var(--os-danger,#ef4444)]"
                  : statusTone === "success"
                    ? "text-[color-mix(in_srgb,var(--os-success,#22c55e)_88%,var(--os-text))]"
                    : statusTone === "accent"
                      ? "text-[var(--os-accent,#6366f1)]"
                      : "text-[var(--os-text-muted)]";
              return (
                <AutomationCardShell key={task.cronJobId}>
                  <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-3.5 py-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--os-accent,#6366f1)_14%,transparent)] text-[var(--os-accent,#6366f1)]"
                      aria-hidden
                    >
                      <Bot size={16} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[0.88rem] font-semibold text-[var(--os-text)]">
                        {task.name || t("automationPage.unnamed")}
                      </h3>
                      <p className="truncate text-[0.68rem] text-[var(--os-text-muted)]">{channelLabel}</p>
                    </div>
                    {!task.enabled ? (
                      <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--os-text-muted)_12%,transparent)] px-2 py-0.5 text-[0.62rem] text-[var(--os-text-muted)]">
                        {t("automationPage.disabledBadge")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3.5">
                    {task.prompt ? (
                      <p className="line-clamp-3 text-[0.74rem] leading-relaxed text-[var(--os-text-muted)]">
                        {task.prompt}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-[0.68rem] text-[var(--os-text-muted)]">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} aria-hidden />
                        {scheduleLabel}
                      </span>
                      <span className={cn("inline-flex items-center gap-1", statusClass)}>
                        <Radio size={12} aria-hidden />
                        {statusLabel}
                      </span>
                    </div>
                    {errorDetail ? (
                      <p
                        className="line-clamp-2 text-[0.66rem] leading-relaxed text-[var(--os-danger,#ef4444)]"
                        title={errorDetail}
                      >
                        {errorDetail}
                      </p>
                    ) : null}
                    <div className="mt-auto flex items-center justify-end gap-1 pt-2">
                      <button
                        type="button"
                        disabled={isJobRunning || !task.enabled}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[0.68rem] text-[var(--os-text-muted)] opacity-0 transition-opacity group-hover:opacity-100",
                          "hover:bg-[color-mix(in_srgb,var(--os-accent,#6366f1)_12%,transparent)] hover:text-[var(--os-accent,#6366f1)]",
                          isJobRunning && "cursor-wait opacity-60",
                        )}
                        onClick={(e) => handleRunNow(e, task.cronJobId)}
                      >
                        {isRunningNow ? t("automationPage.runStatusRunning") : t("automationPage.runNow")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-0.5 text-[0.68rem] text-[var(--os-text-muted)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--os-danger,#ef4444)_12%,transparent)] hover:text-[var(--os-danger,#ef4444)] group-hover:opacity-100"
                        onClick={(e) => handleDelete(e, task.cronJobId)}
                      >
                        {t("automationPage.delete")}
                      </button>
                    </div>
                  </div>
                </AutomationCardShell>
              );
            })}
          </div>
        )}
      </div>

      <AutomationTaskDialog
        open={taskDialogOpen}
        submitting={submitting}
        onOpenChange={(open) => {
          if (!submitting) setTaskDialogOpen(open);
        }}
        onSubmit={handleTaskSubmit}
      />

      <FluidConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setPendingDeleteId(null);
        }}
        danger
        onConfirm={handleConfirmDelete}
      >
        {t("automationPage.deleteConfirm")}
      </FluidConfirmDialog>
    </div>
  );
}
