import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@open-studio/udesign";
import { CloseIcon } from "tdesign-icons-react";
import { useI18n } from "../../context/I18nContext.jsx";
import { useStudio } from "../../context/StudioContext.jsx";
import { agentDisplayLabel } from "../../studio/agents.js";
import { listSkillsForPicker } from "../../skills/skillRegistry.js";
import { useSkillEnvironment } from "../../skills/useSkillEnvironment.js";
import { WORKFLOW_NODE_TYPES } from "../../workflow/workflowTypes.js";
import { resolveAgentNodeSkills } from "../../workflow/workflowRuntimeRegistry.js";
import TextField from "../../ui/TextField.jsx";
import Select from "../../ui/Select.jsx";
import { cn } from "../../ui/cn.js";

/** @param {{ node: import('@xyflow/react').Node | null; workflows: { id: string; name: string }[]; currentWorkflowId: string; open: boolean; onClose: () => void; onApply: (nodeId: string, data: Record<string, unknown>) => void }} props */
export default function WorkflowNodeDrawer({
  node,
  workflows,
  currentWorkflowId,
  open,
  onClose,
  onApply,
}) {
  const { t } = useI18n();
  const { agentById } = useStudio();
  const skillEnv = useSkillEnvironment();
  const skillPickList = useMemo(() => listSkillsForPicker(skillEnv), [skillEnv]);

  const [draft, setDraft] = useState(/** @type {Record<string, unknown>} */ ({}));

  useEffect(() => {
    if (node?.data) {
      setDraft({ ...node.data });
    } else {
      setDraft({});
    }
  }, [node?.id, node?.data]);

  const nodeType = node?.type ?? "";
  const nodeTypeLabel = useMemo(() => {
    switch (nodeType) {
      case WORKFLOW_NODE_TYPES.INPUT:
        return t("workflowPage.nodeTypeInput");
      case WORKFLOW_NODE_TYPES.OUTPUT:
        return t("workflowPage.nodeTypeOutput");
      case WORKFLOW_NODE_TYPES.AGENT:
        return t("workflowPage.nodeTypeAgent");
      case WORKFLOW_NODE_TYPES.NESTED:
        return t("workflowPage.nodeTypeNested");
      default:
        return "";
    }
  }, [nodeType, t]);

  const agentOptions = useMemo(() => {
    const agents = [...agentById.values()];
    return [
      { value: "", label: t("workflowPage.selectAgent") },
      ...agents.map((a) => ({ value: a.id, label: agentDisplayLabel(a) })),
    ];
  }, [agentById, t]);

  const workflowOptions = useMemo(() => {
    return [
      { value: "", label: t("workflowPage.selectWorkflow") },
      ...workflows
        .filter((w) => w.id !== currentWorkflowId)
        .map((w) => ({ value: w.id, label: w.name })),
    ];
  }, [workflows, currentWorkflowId, t]);

  const selectedAgent = draft.agentId ? agentById.get(String(draft.agentId)) : null;
  const agentBaseSkills = selectedAgent?.skillIds ?? [];
  const skillOverrides = /** @type {{ bind: string[]; unbind: string[] }} */ (
    draft.skillOverrides ?? { bind: [], unbind: [] }
  );

  const effectiveSkills = useMemo(() => {
    if (nodeType !== WORKFLOW_NODE_TYPES.AGENT) return [];
    return resolveAgentNodeSkills(selectedAgent, {
      agentId: draft.agentId ? String(draft.agentId) : null,
      skillOverrides,
    });
  }, [nodeType, selectedAgent, draft.agentId, skillOverrides]);

  const skillLabelById = useMemo(() => {
    const map = new Map();
    for (const s of skillPickList) map.set(s.id, s.label);
    return map;
  }, [skillPickList]);

  const toggleSkillBind = useCallback(
    (skillId) => {
      setDraft((prev) => {
        const ov = /** @type {{ bind: string[]; unbind: string[] }} */ (
          prev.skillOverrides ?? { bind: [], unbind: [] }
        );
        const isBase = agentBaseSkills.includes(skillId);
        const isBound = ov.bind.includes(skillId);
        const isUnbound = ov.unbind.includes(skillId);

        if (isBase) {
          if (isUnbound) {
            return { ...prev, skillOverrides: { ...ov, unbind: ov.unbind.filter((id) => id !== skillId) } };
          }
          return { ...prev, skillOverrides: { ...ov, unbind: [...ov.unbind, skillId] } };
        }

        if (isBound) {
          return { ...prev, skillOverrides: { ...ov, bind: ov.bind.filter((id) => id !== skillId) } };
        }
        return { ...prev, skillOverrides: { ...ov, bind: [...ov.bind, skillId] } };
      });
    },
    [agentBaseSkills],
  );

  const isSkillActiveAtNode = useCallback(
    (skillId) => effectiveSkills.includes(skillId),
    [effectiveSkills],
  );

  const handleApply = useCallback(() => {
    if (!node) return;
    onApply(node.id, draft);
  }, [node, draft, onApply]);

  if (!node) return null;

  return (
    <aside className={cn("workflow-node-drawer", open && "is-open")} aria-hidden={!open}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] px-4 py-3">
        <div>
          <div className="text-[0.68rem] font-medium uppercase tracking-wide text-[var(--os-text-muted)]">
            {nodeTypeLabel}
          </div>
          <div className="text-[0.92rem] font-semibold text-[var(--os-text)]">{t("workflowPage.nodeConfig")}</div>
        </div>
        <Button
          type="button"
          variant="text"
          shape="square"
          size="small"
          icon={<CloseIcon />}
          onClick={onClose}
          aria-label={t("workflowPage.closeDrawer")}
        />
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <div className="space-y-1.5">
          <span className="text-[0.72rem] font-medium text-[var(--os-text-muted)]">
            {t("workflowPage.nodeLabel")}
          </span>
          <TextField
            size="small"
            value={String(draft.label ?? "")}
            onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-[0.72rem] font-medium text-[var(--os-text-muted)]">
            {t("workflowPage.nodeDescription")}
          </span>
          <TextField
            size="small"
            value={String(draft.description ?? "")}
            onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
          />
        </div>

        {nodeType === WORKFLOW_NODE_TYPES.AGENT ? (
          <>
            <div className="space-y-1.5">
              <span className="text-[0.72rem] font-medium text-[var(--os-text-muted)]">
                {t("workflowPage.agentSelect")}
              </span>
              <Select
                value={String(draft.agentId ?? "")}
                onChange={(v) => setDraft((p) => ({ ...p, agentId: v || null }))}
                options={agentOptions}
                ariaLabel={t("workflowPage.agentSelect")}
              />
            </div>

            {selectedAgent ? (
              <div className="space-y-2">
                <div className="text-[0.72rem] font-medium text-[var(--os-text-muted)]">
                  {t("workflowPage.nodeSkills")}
                </div>
                <p className="text-[0.68rem] leading-relaxed text-[var(--os-text-muted)]">
                  {t("workflowPage.nodeSkillsHint")}
                </p>
                <ul className="max-h-[min(36vh,280px)] space-y-1 overflow-auto rounded-[10px] border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] bg-[var(--os-bg-elevated)] p-2">
                  {skillPickList.length === 0 ? (
                    <li className="px-2 py-2 text-[0.72rem] text-[var(--os-text-muted)]">
                      {t("workflowPage.noSkills")}
                    </li>
                  ) : (
                    skillPickList.map((s) => {
                      const isBase = agentBaseSkills.includes(s.id);
                      const active = isSkillActiveAtNode(s.id);
                      return (
                        <li key={s.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[0.74rem] hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_65%,transparent)]">
                            <input
                              type="checkbox"
                              className="accent-[var(--os-accent)]"
                              checked={active}
                              onChange={() => toggleSkillBind(s.id)}
                            />
                            <span className="min-w-0 flex-1 truncate">{s.label}</span>
                            {isBase ? (
                              <span className="shrink-0 text-[0.62rem] text-[var(--os-text-muted)]">
                                {t("workflowPage.agentDefault")}
                              </span>
                            ) : null}
                          </label>
                        </li>
                      );
                    })
                  )}
                </ul>
                {effectiveSkills.length > 0 ? (
                  <div className="text-[0.68rem] text-[var(--os-text-muted)]">
                    {t("workflowPage.effectiveSkills", {
                      n: effectiveSkills.length,
                      names: effectiveSkills.map((id) => skillLabelById.get(id) ?? id).join("、"),
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {nodeType === WORKFLOW_NODE_TYPES.NESTED ? (
          <div className="space-y-1.5">
            <span className="text-[0.72rem] font-medium text-[var(--os-text-muted)]">
              {t("workflowPage.nestedWorkflowSelect")}
            </span>
            <Select
              value={String(draft.workflowId ?? "")}
              onChange={(v) => setDraft((p) => ({ ...p, workflowId: v || null }))}
              options={workflowOptions}
              ariaLabel={t("workflowPage.nestedWorkflowSelect")}
            />
          </div>
        ) : null}

        {nodeType === WORKFLOW_NODE_TYPES.INPUT || nodeType === WORKFLOW_NODE_TYPES.OUTPUT ? (
          <p className="text-[0.72rem] leading-relaxed text-[var(--os-text-muted)]">
            {t("workflowPage.terminalNodeHint")}
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] px-4 py-3">
        <Button type="button" variant="text" size="small" onClick={onClose}>
          {t("workflowPage.cancel")}
        </Button>
        <Button type="button" theme="primary" size="small" onClick={handleApply}>
          {t("workflowPage.apply")}
        </Button>
      </footer>
    </aside>
  );
}
