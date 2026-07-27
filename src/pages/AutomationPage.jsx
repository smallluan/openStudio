import { useCallback, useMemo, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { DeleteIcon, EditIcon, MoreIcon, PlayCircleIcon } from "tdesign-icons-react";
import { MessagePlugin, Popup, Tabs } from "tdesign-react";
import "tdesign-react/es/message/style/index.css";
import { Clock, History, LayoutGrid, Plus, Archive } from "lucide-react";
import OsEmpty from "../ui/OsEmpty.jsx";
import AutomationTaskDialog from "../components/automation/AutomationTaskDialog.jsx";
import FluidConfirmDialog from "../ui/FluidConfirmDialog.jsx";
import taskHero from "../assets/images/task-hero.png";
import clockIcon from "../assets/images/clock.png";
import heroAvatarLight from "../assets/images/hero-avatar-light.png";
import heroAvatarDark from "../assets/images/hero-avatar-dark.png";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import WechatIcon from "../assets/svg/WechatIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { useStudio } from "../context/StudioContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { cn } from "../ui/cn.js";
import { OS_POPUP_INNER_CLASS, OS_POPUP_OVERLAY_CLASS, osPopupPopperOptions } from "../ui/osPopupShared.js";
import { buildAutomationCronMessage } from "../automation/buildAutomationCronMessage.js";
import {
  automationTaskToDraft,
  emptyAutomationTaskDraft,
} from "../automation/automationTaskToDraft.js";
import { formatAutomationScheduleLabel } from "../automation/formatAutomationScheduleLabel.js";
import {
  automationTaskStatusTone,
  formatAutomationRemainingLabel,
  formatAutomationTaskErrorDetail,
} from "../automation/formatAutomationTaskStatus.js";
import { useAutomationTasks } from "../automation/useAutomationTasks.js";
import { useNowMs } from "../automation/useNowMs.js";
import {
  AUTOMATION_TASK_TAB_ALL,
  AUTOMATION_TASK_TAB_EXPIRED,
  AUTOMATION_TASK_TAB_RECENT,
  AUTOMATION_TASK_TAB_UPCOMING,
  matchesAutomationTaskTab,
} from "../automation/automationTaskFilters.js";

/** @param {{ icon: import("lucide-react").LucideIcon; label: string }} props */
function AutomationTaskTabLabel({ icon: Icon, label }) {
  return (
    <span className="automation-page__task-tab-label">
      <Icon size={14} strokeWidth={2} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

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

/** @param {{ channel: string; className?: string }} props */
function AutomationChannelIcon({ channel, className }) {
  const { theme } = useTheme();
  if (channel === "wechat") {
    return <WechatIcon className={cn("shrink-0", className)} />;
  }
  return (
    <img
      className={cn("shrink-0 rounded object-cover", className)}
      src={theme === "dark" ? heroAvatarDark : heroAvatarLight}
      alt=""
      width={16}
      height={16}
      aria-hidden
    />
  );
}

/**
 * @param {{
 *   task: import("../automation/useAutomationTasks.js").AutomationTaskCard;
 *   nowMs: number;
 *   isRunningNow: boolean;
 *   onRunNow: (e: import("react").MouseEvent, cronJobId: string) => void;
 *   onEdit: (e: import("react").MouseEvent, task: import("../automation/useAutomationTasks.js").AutomationTaskCard) => void;
 *   onDelete: (e: import("react").MouseEvent, cronJobId: string) => void;
 * }} props
 */
function AutomationTaskCard({ task, nowMs, isRunningNow, onRunNow, onEdit, onDelete }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = task.meta && typeof task.meta === "object" ? task.meta : {};
  const scheduleLabel = formatAutomationScheduleLabel(meta, t, task.schedule);
  const remainingLabel = formatAutomationRemainingLabel(task, nowMs, t);
  const statusTone = automationTaskStatusTone(task, nowMs);
  const errorDetail = formatAutomationTaskErrorDetail(task);
  const isJobRunning = task.lastRunStatus === "running" || isRunningNow;
  const statusClass =
    statusTone === "danger"
      ? "text-[var(--os-danger,#ef4444)]"
      : statusTone === "success"
        ? "text-[color-mix(in_srgb,var(--os-success,#22c55e)_88%,var(--os-text))]"
        : statusTone === "accent"
          ? "text-[var(--os-accent,#6366f1)]"
          : "text-[var(--os-text-muted)]";

  const menuContent = (
    <div className="chat-history-card__menu" role="menu">
      <div className="chat-history-card__menu-row">
        <button
          type="button"
          role="menuitem"
          className="chat-history-card__menu-item"
          disabled={isJobRunning || !task.enabled}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            onRunNow(e, task.cronJobId);
          }}
        >
          <span className="chat-history-card__menu-item-icon">
            <PlayCircleIcon size="14px" />
          </span>
          <span className="chat-history-card__menu-item-label">
            {isRunningNow ? t("automationPage.runStatusRunning") : t("automationPage.runNow")}
          </span>
        </button>
      </div>
      <div className="chat-history-card__menu-row chat-history-card__menu-row--with-divider">
        <button
          type="button"
          role="menuitem"
          className="chat-history-card__menu-item"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            onEdit(e, task);
          }}
        >
          <span className="chat-history-card__menu-item-icon">
            <EditIcon size="14px" />
          </span>
          <span className="chat-history-card__menu-item-label">{t("automationPage.edit")}</span>
        </button>
      </div>
      <div className="chat-history-card__menu-row chat-history-card__menu-row--with-divider">
        <button
          type="button"
          role="menuitem"
          className="chat-history-card__menu-item chat-history-card__menu-item--danger"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            onDelete(e, task.cronJobId);
          }}
        >
          <span className="chat-history-card__menu-item-icon">
            <DeleteIcon size="14px" />
          </span>
          <span className="chat-history-card__menu-item-label">{t("automationPage.delete")}</span>
        </button>
      </div>
    </div>
  );

  return (
    <AutomationCardShell>
      <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] px-3.5 py-3">
        <img
          src={clockIcon}
          alt=""
          className="h-6 w-6 shrink-0 object-contain"
          width={24}
          height={24}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.88rem] font-semibold text-[var(--os-text)]">
            {task.name || t("automationPage.unnamed")}
          </h3>
        </div>
        {!task.enabled ? (
          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--os-text-muted)_12%,transparent)] px-2 py-0.5 text-[0.62rem] text-[var(--os-text-muted)]">
            {t("automationPage.disabledBadge")}
          </span>
        ) : null}
        <Popup
          visible={menuOpen}
          trigger="click"
          placement="bottom-end"
          attach="body"
          zIndex={5000}
          destroyOnClose={false}
          overlayClassName={OS_POPUP_OVERLAY_CLASS}
          overlayInnerClassName={OS_POPUP_INNER_CLASS}
          popperOptions={osPopupPopperOptions(6, 8)}
          content={menuContent}
          onVisibleChange={setMenuOpen}
        >
          <Button
            type="button"
            variant="text"
            shape="square"
            size="small"
            className={cn(
              "shrink-0 text-[var(--os-text-muted)] opacity-0 transition-opacity group-hover:opacity-100",
              menuOpen && "opacity-100",
            )}
            aria-label={t("automationPage.taskMoreActions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MoreIcon size="16px" />
          </Button>
        </Popup>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p
          className="line-clamp-2 h-[calc(0.74rem*1.625*2)] shrink-0 text-[0.74rem] leading-relaxed text-[var(--os-text-muted)]"
          title={task.prompt || undefined}
        >
          {task.prompt || "\u00A0"}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[0.68rem] text-[var(--os-text-muted)]">
          <span className="inline-flex items-center gap-1">
            <Clock size={12} aria-hidden />
            {scheduleLabel}
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
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <AutomationChannelIcon channel={task.channel} className="size-4" />
          <span className={cn("truncate text-[0.68rem]", statusClass)}>{remainingLabel}</span>
        </div>
      </div>
    </AutomationCardShell>
  );
}

export default function AutomationPage() {
  const { t } = useI18n();
  const { agentById } = useStudio();
  const [query, setQuery] = useState("");
  const [taskTab, setTaskTab] = useState(AUTOMATION_TASK_TAB_ALL);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(
    /** @type {import("../automation/useAutomationTasks.js").AutomationTaskCard | null} */ (null),
  );
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(/** @type {string | null} */ (null));
  const [runningNowIds, setRunningNowIds] = useState(/** @type {Set<string>} */ (() => new Set()));
  const { tasks, loading, createTask, updateTask, removeTask, runTaskNow } = useAutomationTasks();
  const nowMs = useNowMs();
  const editingTaskId = useMemo(
    () =>
      String(
        editingTask?.cronJobId ??
          (editingTask?.meta && typeof editingTask.meta === "object" ? editingTask.meta.cronJobId : "") ??
          (editingTask?.cronJob && typeof editingTask.cronJob === "object" ? editingTask.cronJob.id : "") ??
          "",
      ).trim(),
    [editingTask],
  );

  const taskDialogInitialDraft = useMemo(() => {
    if (!taskDialogOpen) return emptyAutomationTaskDraft();
    return editingTask ? automationTaskToDraft(editingTask) : emptyAutomationTaskDraft();
  }, [editingTask, taskDialogOpen]);

  const normalizedQuery = query.trim().toLowerCase();

  const taskTabs = useMemo(
    () => [
      {
        value: AUTOMATION_TASK_TAB_ALL,
        label: <AutomationTaskTabLabel icon={LayoutGrid} label={t("automationPage.tabAll")} />,
      },
      {
        value: AUTOMATION_TASK_TAB_EXPIRED,
        label: <AutomationTaskTabLabel icon={Archive} label={t("automationPage.tabExpired")} />,
      },
      {
        value: AUTOMATION_TASK_TAB_UPCOMING,
        label: <AutomationTaskTabLabel icon={Clock} label={t("automationPage.tabUpcoming")} />,
      },
      {
        value: AUTOMATION_TASK_TAB_RECENT,
        label: <AutomationTaskTabLabel icon={History} label={t("automationPage.tabRecent")} />,
      },
    ],
    [t],
  );

  const filtered = useMemo(() => {
    return tasks.filter((task) => {
      if (!matchesAutomationTaskTab(task, taskTab, nowMs)) return false;
      if (!normalizedQuery) return true;
      const hay = `${task.name} ${task.prompt} ${task.channel}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [tasks, normalizedQuery, taskTab, nowMs]);

  const emptyDescription = useMemo(() => {
    if (normalizedQuery) return t("automationPage.emptySearch");
    switch (taskTab) {
      case AUTOMATION_TASK_TAB_EXPIRED:
        return t("automationPage.emptyExpired");
      case AUTOMATION_TASK_TAB_UPCOMING:
        return t("automationPage.emptyUpcoming");
      case AUTOMATION_TASK_TAB_RECENT:
        return t("automationPage.emptyRecent");
      default:
        return t("automationPage.emptyList");
    }
  }, [normalizedQuery, taskTab, t]);

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
        const isEdit = Boolean(editingTask);
        if (isEdit && !editingTaskId) {
          showCreateError(t("automationPage.taskUpdateFailed", { detail: "missing_job_id" }));
          return;
        }
        const result = isEdit
          ? await updateTask(editingTaskId, draft, message)
          : await createTask(draft, message);
        if (result?.ok) {
          setTaskDialogOpen(false);
          setEditingTask(null);
          showCreateSuccess(
            isEdit ? t("automationPage.taskUpdateSuccess") : t("automationPage.taskCreateSuccess"),
          );
          return;
        }
        const err = String(result?.error ?? (isEdit ? "update_failed" : "create_failed"));
        if (err === "missing_gateway_url") {
          showCreateError(t("chatLab.gatewayUrlMissing"));
        } else if (err === "channel_change_not_supported") {
          showCreateError(t("automationPage.taskChannelChangeNotSupported"));
        } else {
          showCreateError(
            isEdit
              ? t("automationPage.taskUpdateFailed", { detail: err })
              : t("automationPage.taskCreateFailed", { detail: err }),
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [agentById, createTask, editingTask, editingTaskId, showCreateError, showCreateSuccess, t, updateTask],
  );

  const handleEdit = useCallback((e, task) => {
    e.stopPropagation();
    setEditingTask(task);
    setTaskDialogOpen(true);
  }, []);

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
              onClick={() => {
                setEditingTask(null);
                setTaskDialogOpen(true);
              }}
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
        <div className="min-w-0 shrink-0">
          <Tabs
            className="automation-page__task-tabs"
            value={taskTab}
            list={taskTabs}
            onChange={(value) => setTaskTab(String(value))}
          />
        </div>
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
          <OsEmpty description={emptyDescription} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((task) => (
              <AutomationTaskCard
                key={task.cronJobId}
                task={task}
                nowMs={nowMs}
                isRunningNow={runningNowIds.has(task.cronJobId)}
                onRunNow={handleRunNow}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {taskDialogOpen ? (
        <AutomationTaskDialog
          key={editingTask ? `__edit__${editingTaskId || "__missing_id__"}` : "__create__"}
          open
          submitting={submitting}
          editingTask={editingTask}
          initialDraft={taskDialogInitialDraft}
          onOpenChange={(open) => {
            if (!submitting) {
              setTaskDialogOpen(open);
              if (!open) setEditingTask(null);
            }
          }}
          onSubmit={handleTaskSubmit}
        />
      ) : null}

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
