import { useEffect, useId, useMemo, useState } from "react";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useStudio } from "../context/StudioContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { BUILTIN_SKILL_DEFS } from "../skills/skillsCatalog.js";
import { OPENCLAW_BUNDLED_SKILLS, formatSkillTitle } from "../skills/skillRegistry.js";
import { useSkillLibrary } from "../skills/useSkillLibrary.js";
import Modal from "../ui/Modal.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import TextField from "../ui/TextField.jsx";
import { cn } from "../ui/cn.js";

/** @param {{ className?: string; selected?: boolean; onClick?: () => void; children: React.ReactNode }} props */
function AgentListItem({ className, selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col rounded-[12px] border px-3.5 py-3 text-left text-[0.8125rem] transition",
        selected
          ? "border-[color-mix(in_srgb,var(--os-accent)_42%,var(--os-border))] bg-[color-mix(in_srgb,var(--os-accent)_10%,var(--os-bg-panel))]"
          : "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] hover:border-[var(--os-border)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function LobsterManagementPage() {
  const { t } = useI18n();
  const delTitleId = useId();
  const { agents, addAgent, removeAgent, patchAgentMeta } = useStudio();
  const { lib } = useSkillLibrary();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null));
  const [deleteTargetId, setDeleteTargetId] = useState(/** @type {string | null} */ (null));
  const [skillQuery, setSkillQuery] = useState("");

  const openclawById = useMemo(() => new Map(OPENCLAW_BUNDLED_SKILLS.map((s) => [s.id, s])), []);

  const selectableSkills = useMemo(() => {
    const builtins = BUILTIN_SKILL_DEFS.map(({ id }) => {
      const meta = openclawById.get(id);
      const title = meta ? formatSkillTitle(meta.name) : formatSkillTitle(id);
      return { id, title, source: "builtin" };
    });
    const users = lib.userSkills.map((s) => ({
      id: s.id,
      title: s.title?.trim() || s.id,
      source: "user",
    }));
    return [...builtins, ...users];
  }, [lib.userSkills, openclawById]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    if (!normalizedQuery) return agents;
    return agents.filter((a) => {
      const name = (a.name || "").toLowerCase();
      const desc = (a.description || "").toLowerCase();
      return name.includes(normalizedQuery) || desc.includes(normalizedQuery);
    });
  }, [agents, normalizedQuery]);

  useEffect(() => {
    if (agents.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !agents.some((a) => a.id === selectedId)) {
      setSelectedId(agents[0].id);
    }
  }, [agents, selectedId]);

  const selected = agents.find((a) => a.id === selectedId) ?? null;
  const deleteTarget = deleteTargetId ? agents.find((a) => a.id === deleteTargetId) : null;

  const skillNorm = skillQuery.trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!skillNorm) return selectableSkills;
    return selectableSkills.filter((s) => s.title.toLowerCase().includes(skillNorm));
  }, [selectableSkills, skillNorm]);

  const toggleSkill = (skillId) => {
    if (!selected) return;
    const set = new Set(selected.skillIds);
    if (set.has(skillId)) set.delete(skillId);
    else set.add(skillId);
    patchAgentMeta(selected.id, { skillIds: [...set] });
  };

  const onCreate = () => {
    const id = addAgent({ name: t("lobsterPage.defaultNewName") });
    setSelectedId(id);
  };

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <header className="route-page__header shrink-0">
        <h1 className="route-page__title">{t("lobsterPage.title")}</h1>
        <p className="route-page__desc muted">{t("lobsterPage.desc")}</p>
      </header>

      <div className="mb-4 flex min-h-0 shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className="w-fit rounded-[11px] bg-[var(--os-accent)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-on-accent,#fff)] shadow-sm transition hover:opacity-95"
          onClick={onCreate}
        >
          {t("lobsterPage.actions.create")}
        </button>
        <label className="relative flex w-full min-w-[220px] max-w-md sm:w-72">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--os-text-muted)]">
            <SearchSparkleIcon className="opacity-75" />
          </span>
          <TextField
            className="h-10 pl-9 text-[0.8125rem]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("lobsterPage.searchPlaceholder")}
            aria-label={t("lobsterPage.searchPlaceholder")}
          />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <div className="flex min-h-0 flex-col gap-2 overflow-auto lg:max-h-none">
          {filteredAgents.length === 0 ? (
            <p className="text-[0.82rem] text-[var(--os-text-muted)]">{t("lobsterPage.emptyList")}</p>
          ) : (
            filteredAgents.map((a) => {
              const label = a.name?.trim() ? a.name : t("agents.defaultName");
              const preview = a.description?.trim() || t("skillsPage.noDescription");
              return (
                <AgentListItem
                  key={a.id}
                  selected={a.id === selectedId}
                  onClick={() => setSelectedId(a.id)}
                >
                  <span className="font-medium text-[var(--os-text)]">{label}</span>
                  <span className="mt-0.5 line-clamp-2 text-[0.75rem] text-[var(--os-text-muted)]">{preview}</span>
                  {a.skillIds?.length ? (
                    <span className="mt-1.5 text-[0.7rem] text-[var(--os-text-faint)]">
                      {t("lobsterPage.skillCount", { n: a.skillIds.length })}
                    </span>
                  ) : null}
                </AgentListItem>
              );
            })
          )}
        </div>

        <div className="flex min-h-[320px] min-w-0 flex-col rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] p-4 shadow-[var(--os-shadow-soft)]">
          {!selected ? (
            <p className="text-[0.82rem] text-[var(--os-text-muted)]">{t("lobsterPage.noSelection")}</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-[0.9375rem] font-semibold text-[var(--os-text)]">
                  {t("lobsterPage.detailTitle")}
                </h2>
                <button
                  type="button"
                  className="rounded-[10px] border border-[color-mix(in_srgb,var(--os-danger,#b91c1c)_35%,var(--os-border))] px-3 py-1.5 text-[0.78rem] font-medium text-[var(--os-danger,#b91c1c)] transition hover:bg-[color-mix(in_srgb,var(--os-danger,#b91c1c)_8%,transparent)]"
                  onClick={() => setDeleteTargetId(selected.id)}
                >
                  {t("lobsterPage.actions.delete")}
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
                <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  {t("lobsterPage.fieldName")}
                  <TextField
                    value={selected.name}
                    onChange={(e) => patchAgentMeta(selected.id, { name: e.target.value })}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  {t("lobsterPage.fieldDescription")}
                  <textarea
                    className="min-h-[88px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 text-[0.8125rem] text-[var(--os-text)] placeholder:text-[var(--os-text-faint)] focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]"
                    value={selected.description}
                    onChange={(e) => patchAgentMeta(selected.id, { description: e.target.value })}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  {t("lobsterPage.fieldSessionKey")}
                  <TextField
                    value={selected.openclaw?.sessionKey ?? ""}
                    onChange={(e) =>
                      patchAgentMeta(selected.id, { openclaw: { sessionKey: e.target.value } })
                    }
                    placeholder={t("lobsterPage.sessionKeyPlaceholder")}
                  />
                </label>

                <div className="flex min-h-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.75rem] font-medium text-[var(--os-text-muted)]">
                      {t("lobsterPage.skillsHeading")}
                    </span>
                    <TextField
                      className="h-8 max-w-[200px] text-[0.75rem]"
                      value={skillQuery}
                      onChange={(e) => setSkillQuery(e.target.value)}
                      placeholder={t("lobsterPage.skillFilterPlaceholder")}
                      aria-label={t("lobsterPage.skillFilterPlaceholder")}
                    />
                  </div>
                  <p className="text-[0.7rem] leading-snug text-[var(--os-text-faint)]">
                    {t("lobsterPage.skillsHint")}
                  </p>
                  <ul className="max-h-[min(40vh,280px)] space-y-1 overflow-auto rounded-[10px] border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] bg-[var(--os-bg-elevated)] p-2">
                    {filteredSkills.length === 0 ? (
                      <li className="px-2 py-3 text-[0.78rem] text-[var(--os-text-muted)]">
                        {t("lobsterPage.skillsEmpty")}
                      </li>
                    ) : (
                      filteredSkills.map((s) => {
                        const checked = selected.skillIds.includes(s.id);
                        return (
                          <li key={s.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[0.78rem] hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_65%,transparent)]">
                              <input
                                type="checkbox"
                                className="accent-[var(--os-accent)]"
                                checked={checked}
                                onChange={() => toggleSkill(s.id)}
                              />
                              <span className="min-w-0 flex-1 text-[var(--os-text)]">{s.title}</span>
                              <span className="shrink-0 text-[0.65rem] uppercase text-[var(--os-text-faint)]">
                                {s.source === "builtin" ? t("skillsPage.badgeBuiltin") : t("skillsPage.badgeUser")}
                              </span>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {deleteTarget ? (
        <Modal onClose={() => setDeleteTargetId(null)} labelledBy={delTitleId}>
          <div className="flex w-full min-w-[min(100vw-2rem,400px)] flex-col bg-[var(--os-bg-modal)]">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={delTitleId} className="text-base font-semibold">
                {t("lobsterPage.deleteModal.title")}
              </h2>
              <ModalCloseButton onClick={() => setDeleteTargetId(null)} />
            </div>
            <p className="px-5 py-4 text-[0.8125rem] leading-relaxed text-[var(--os-text-muted)]">
              {t("lobsterPage.deleteModal.body", {
                name: deleteTarget.name?.trim() || t("agents.defaultName"),
              })}
            </p>
            <div className="flex justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <button
                type="button"
                className="rounded-[10px] px-3 py-2 text-[0.8rem] text-[var(--os-text-muted)]"
                onClick={() => setDeleteTargetId(null)}
              >
                {t("skillsPage.cancel")}
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-[var(--os-danger,#b91c1c)] px-3.5 py-2 text-[0.8rem] font-medium text-white"
                onClick={() => {
                  removeAgent(deleteTarget.id);
                  setDeleteTargetId(null);
                }}
              >
                {t("lobsterPage.deleteModal.confirm")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
