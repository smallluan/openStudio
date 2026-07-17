import { useMemo } from "react";
import { Button } from "@open-studio/udesign";
import { agentDisplayLabel } from "../../studio/agents.js";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   run: import("../../studio/orchestration.js").OrchestrationRun | null | undefined;
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   onResume?: () => void;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
export default function ChatLabOrchestrationPanel({ run, agents, onResume, t }) {
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const activeTaskIds = useMemo(
    () =>
      new Set(
        [
          ...(Array.isArray(run?.activeTaskIds) ? run.activeTaskIds : []),
          ...(typeof run?.activeTaskId === "string" && run.activeTaskId ? [run.activeTaskId] : []),
        ].filter(Boolean),
      ),
    [run?.activeTaskId, run?.activeTaskIds],
  );

  const columns = useMemo(() => {
    const tasks = run?.plan?.tasks ?? [];
    return {
      todo: tasks.filter((t) => t.status === "todo" || t.status === "blocked"),
      doing: tasks.filter((t) => t.status === "in_progress" || t.status === "review"),
      done: tasks.filter((t) => t.status === "done"),
    };
  }, [run?.plan?.tasks]);

  if (!run?.plan?.tasks?.length && !run?.status) return null;

  return (
    <aside className="orch-panel" aria-label={t("orchestration.panel.aria")}>
      <div className="orch-panel__header">
        <span className="orch-panel__title">{t("orchestration.panel.title")}</span>
        {run?.status ? (
          <span className={cn("orch-panel__status", `orch-panel__status--${run.status}`)}>
            {t(`orchestration.runStatus.${run.status}`, { defaultValue: run.status })}
          </span>
        ) : null}
        {run?.status === "paused" && onResume ? (
          <Button type="button" theme="primary" variant="outline" size="small" className="orch-panel__resume" onClick={onResume}>
            {t("orchestration.panel.resume")}
          </Button>
        ) : null}
      </div>
      <div className="orch-panel__board">
        {(["todo", "doing", "done"]).map((col) => (
          <div key={col} className="orch-panel__col">
            <h4 className="orch-panel__col-title">{t(`orchestration.panel.col.${col}`)}</h4>
            <ul className="orch-panel__col-list">
              {columns[col].length === 0 ? (
                <li className="orch-panel__col-empty">{t("orchestration.panel.empty")}</li>
              ) : (
                columns[col].map((task) => {
                  const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId) : null;
                  return (
                    <li
                      key={task.id}
                      className={cn(
                        "orch-panel__task",
                        task.status === "in_progress" || activeTaskIds.has(task.id)
                          ? "orch-panel__task--active"
                          : null,
                      )}
                    >
                      <span className="orch-panel__task-title">{task.title}</span>
                      {owner ? (
                        <span className="orch-panel__task-owner">{agentDisplayLabel(owner)}</span>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}
