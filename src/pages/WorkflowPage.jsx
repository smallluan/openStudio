import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "@open-studio/udesign";
import { Empty } from "tdesign-react";
import { AddIcon } from "tdesign-icons-react";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import WorkflowBreadcrumb from "../components/workflow/WorkflowBreadcrumb.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { useWorkflowLibrary } from "../workflow/useWorkflowLibrary.js";
import WorkflowFlowPreview from "../components/workflow/WorkflowFlowPreview.jsx";
import FluidConfirmDialog from "../ui/FluidConfirmDialog.jsx";
import { cn } from "../ui/cn.js";

/** @param {{ className?: string; children: React.ReactNode; onClick?: () => void }} props */
function WorkflowCardShell({ className, children, onClick }) {
  return (
    <article
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "group relative flex min-h-[200px] cursor-pointer flex-col overflow-hidden rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] transition-[box-shadow,transform] duration-150",
        "hover:shadow-[0_10px_28px_-12px_color-mix(in_srgb,var(--os-shadow-color,#000)_28%,transparent)]",
        className,
      )}
    >
      {children}
    </article>
  );
}

export default function WorkflowPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { lib, createWorkflow, removeWorkflow } = useWorkflowLibrary();

  const [query, setQuery] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(/** @type {string | null} */ (null));

  const savedWorkflows = useMemo(() => lib.workflows.filter((w) => !w.draft), [lib.workflows]);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return savedWorkflows;
    return savedWorkflows.filter((w) => {
      const hay = `${w.name} ${w.description}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [savedWorkflows, normalizedQuery]);

  const openEditor = useCallback(
    (id) => {
      navigate(`/workflow/${id}`);
    },
    [navigate],
  );

  const handleCreate = useCallback(() => {
    const doc = createWorkflow({ draft: true });
    navigate(`/workflow/${doc.id}`, { state: { workflowBootstrap: doc } });
  }, [createWorkflow, navigate]);

  const handleDelete = useCallback((e, id) => {
    e.stopPropagation();
    setPendingDeleteId(id);
    setDeleteConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteId) {
      removeWorkflow(pendingDeleteId);
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, removeWorkflow]);

  const breadcrumbItems = useMemo(
    () => [
      { label: t("workflowPage.breadcrumbHome"), onClick: () => navigate("/chat") },
      { label: t("nav.workflow") },
    ],
    [t, navigate],
  );

  return (
    <div className="route-page route-page--workflow flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <div className="mb-4 flex shrink-0 flex-col gap-3">
        <WorkflowBreadcrumb items={breadcrumbItems} />
        <div className="flex min-h-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full min-w-[220px] max-w-md sm:w-72">
            <Input
              type="search"
              prefixIcon={<SearchSparkleIcon className="opacity-75" aria-hidden />}
              clearable
              value={query}
              onChange={(value) => setQuery(value)}
              placeholder={t("workflowPage.searchPlaceholder")}
              aria-label={t("workflowPage.searchPlaceholder")}
            />
          </div>
          <Button type="button" theme="primary" icon={<AddIcon />} onClick={handleCreate}>
            {t("workflowPage.create")}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto pb-10",
          filtered.length === 0 && "flex items-center justify-center pb-0",
        )}
      >
        {filtered.length === 0 ? (
          <Empty description={t("workflowPage.empty")} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((w) => (
              <WorkflowCardShell key={w.id} onClick={() => openEditor(w.id)}>
                <div className="h-[120px] shrink-0 overflow-hidden border-b border-[color-mix(in_srgb,var(--os-border)_45%,transparent)]">
                  <WorkflowFlowPreview nodes={w.nodes} edges={w.edges} className="h-full" />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3.5">
                  <h2 className="truncate text-[0.88rem] font-semibold text-[var(--os-text)]">
                    {w.name || t("workflowPage.unnamed")}
                  </h2>
                  {w.description ? (
                    <p className="line-clamp-2 text-[0.74rem] leading-relaxed text-[var(--os-text-muted)]">
                      {w.description}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-[0.68rem] text-[var(--os-text-muted)]">
                      {t("workflowPage.nodeCount", { n: w.nodes?.length ?? 0 })}
                    </span>
                    <button
                      type="button"
                      className="rounded-md px-2 py-0.5 text-[0.68rem] text-[var(--os-text-muted)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--os-danger,#ef4444)_12%,transparent)] hover:text-[var(--os-danger,#ef4444)] group-hover:opacity-100"
                      onClick={(e) => handleDelete(e, w.id)}
                    >
                      {t("workflowPage.delete")}
                    </button>
                  </div>
                </div>
              </WorkflowCardShell>
            ))}
          </div>
        )}
      </div>

      <FluidConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setPendingDeleteId(null);
        }}
        danger
        onConfirm={handleConfirmDelete}
      >
        {t("workflowPage.deleteConfirm")}
      </FluidConfirmDialog>
    </div>
  );
}
