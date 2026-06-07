import { useCallback, useEffect, useId, useMemo, useState } from "react";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useStudio } from "../context/StudioContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { agentAvatarGlyph, agentDisplayLabel, buildIdentityMd } from "../studio/agents.js";
import { filterUsableBundledSkills } from "../skills/skillAvailability.js";
import { userSkillDisplayTitle } from "../skills/skillDisplay.js";
import { BUILTIN_SKILL_DEFS } from "../skills/skillsCatalog.js";
import { OPENCLAW_BUNDLED_SKILLS, formatSkillTitle } from "../skills/skillRegistry.js";
import { useSkillEnvironment } from "../skills/useSkillEnvironment.js";
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

/** @param {string} name @param {string} identityMd */
function syncIdentityNameLine(name, identityMd) {
  const trimmed = name.trim();
  if (!trimmed || !identityMd.trim()) return identityMd;
  if (/\*\*Name:\*\*/i.test(identityMd)) {
    return identityMd.replace(/\*\*Name:\*\*\s*.+/i, `**Name:** ${trimmed}`);
  }
  return identityMd;
}

/** @param {{ skills: { id: string; title: string; source: string }[]; selectedIds: string[]; onToggle: (id: string) => void; query: string; onQueryChange: (v: string) => void; filterPlaceholder: string; emptyLabel: string; builtinBadge: string; userBadge: string }} props */
function AgentSkillPicker({
  skills,
  selectedIds,
  onToggle,
  query,
  onQueryChange,
  filterPlaceholder,
  emptyLabel,
  builtinBadge,
  userBadge,
}) {
  const norm = query.trim().toLowerCase();
  const filtered = norm ? skills.filter((s) => s.title.toLowerCase().includes(norm)) : skills;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <TextField
        className="h-8 max-w-full text-[0.75rem]"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={filterPlaceholder}
        aria-label={filterPlaceholder}
      />
      <ul className="max-h-[min(32vh,220px)] space-y-1 overflow-auto rounded-[10px] border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] bg-[var(--os-bg-elevated)] p-2">
        {filtered.length === 0 ? (
          <li className="px-2 py-3 text-[0.78rem] text-[var(--os-text-muted)]">{emptyLabel}</li>
        ) : (
          filtered.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[0.78rem] hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_65%,transparent)]">
                <input
                  type="checkbox"
                  className="accent-[var(--os-accent)]"
                  checked={selectedIds.includes(s.id)}
                  onChange={() => onToggle(s.id)}
                />
                <span className="min-w-0 flex-1 text-[var(--os-text)]">{s.title}</span>
                <span className="shrink-0 text-[0.65rem] uppercase text-[var(--os-text-faint)]">
                  {s.source === "builtin" ? builtinBadge : userBadge}
                </span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default function LobsterManagementPage() {
  const { t } = useI18n();
  const delTitleId = useId();
  const createTitleId = useId();
  const { agents, createAgent, removeAgent, patchAgentMeta } = useStudio();
  const { lib } = useSkillLibrary();
  const skillEnv = useSkillEnvironment();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null));
  const [deleteTargetId, setDeleteTargetId] = useState(/** @type {string | null} */ (null));
  const [skillQuery, setSkillQuery] = useState("");
  const [provisionNote, setProvisionNote] = useState(/** @type {string | null} */ (null));
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(/** @type {string | null} */ (null));
  const [createSkillQuery, setCreateSkillQuery] = useState("");
  const [createForm, setCreateForm] = useState(() => ({
    name: "",
    description: "",
    avatar: "🦞",
    identityMd: buildIdentityMd({ name: "", description: "", avatar: "🦞" }),
    soulMd: "",
    skillIds: /** @type {string[]} */ ([]),
  }));

  const openclawById = useMemo(() => new Map(OPENCLAW_BUNDLED_SKILLS.map((s) => [s.id, s])), []);

  const selectableSkills = useMemo(() => {
    const usableIds = new Set(
      filterUsableBundledSkills(OPENCLAW_BUNDLED_SKILLS, skillEnv).map((s) => s.id),
    );
    const builtins = BUILTIN_SKILL_DEFS.filter((def) => usableIds.has(def.id)).map(({ id }) => {
      const meta = openclawById.get(id);
      const title = meta ? formatSkillTitle(meta.name) : formatSkillTitle(id);
      return { id, title, source: "builtin" };
    });
    const users = lib.userSkills.map((s) => ({
      id: s.id,
      title: userSkillDisplayTitle(s),
      source: "user",
    }));
    return [...builtins, ...users];
  }, [lib.userSkills, openclawById, skillEnv]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    if (!normalizedQuery) return agents;
    return agents.filter((a) => {
      const name = (a.name || "").toLowerCase();
      const desc = (a.description || "").toLowerCase();
      const gid = (a.gatewayAgentId || "").toLowerCase();
      return name.includes(normalizedQuery) || desc.includes(normalizedQuery) || gid.includes(normalizedQuery);
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

  useEffect(() => {
    if (!selected) return;
    const bridge = window.studioBridge;
    if (!bridge) return;
    let cancelled = false;
    if (!selected.soulMd.trim() && bridge.readAgentSoul) {
      void bridge.readAgentSoul({ gatewayAgentId: selected.gatewayAgentId }).then((r) => {
        if (cancelled || !r?.ok || typeof r.soulMd !== "string" || !r.soulMd.trim()) return;
        patchAgentMeta(selected.id, { soulMd: r.soulMd });
      });
    }
    if (!selected.identityMd?.trim() && bridge.readAgentIdentity) {
      void bridge.readAgentIdentity({ gatewayAgentId: selected.gatewayAgentId }).then((r) => {
        if (cancelled || !r?.ok || typeof r.identityMd !== "string" || !r.identityMd.trim()) return;
        patchAgentMeta(selected.id, { identityMd: r.identityMd });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [patchAgentMeta, selected]);

  const toggleSkill = (skillId) => {
    if (!selected) return;
    const set = new Set(selected.skillIds);
    if (set.has(skillId)) set.delete(skillId);
    else set.add(skillId);
    patchAgentMeta(selected.id, { skillIds: [...set] });
  };

  const openCreateModal = useCallback(() => {
    setCreateForm({
      name: "",
      description: "",
      avatar: "🦞",
      identityMd: buildIdentityMd({ name: "", description: "", avatar: "🦞" }),
      soulMd: "",
      skillIds: [],
    });
    setCreateSkillQuery("");
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const toggleCreateSkill = (skillId) => {
    setCreateForm((prev) => {
      const set = new Set(prev.skillIds);
      if (set.has(skillId)) set.delete(skillId);
      else set.add(skillId);
      return { ...prev, skillIds: [...set] };
    });
  };

  const onConfirmCreate = async () => {
    const name = createForm.name.trim();
    if (!name) {
      setCreateError(t("lobsterPage.createModal.nameRequired"));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const result = await createAgent({
        name,
        description: createForm.description.trim(),
        avatar: createForm.avatar.trim() || "🦞",
        identityMd: createForm.identityMd.trim(),
        soulMd: createForm.soulMd.trim(),
        skillIds: createForm.skillIds,
      });
      if (!result.ok) {
        setCreateError(t("lobsterPage.createModal.failed"));
        return;
      }
      setCreateOpen(false);
      if (result.id) setSelectedId(result.id);
      setProvisionNote(t("lobsterPage.provisionDone"));
      window.setTimeout(() => setProvisionNote(null), 4000);
    } finally {
      setCreateBusy(false);
    }
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
          onClick={openCreateModal}
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

      {provisionNote ? (
        <p className="mb-3 text-[0.78rem] text-[var(--os-text-muted)]" role="status">
          {provisionNote}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <div className="flex min-h-0 flex-col gap-2 overflow-auto lg:max-h-none">
          {filteredAgents.length === 0 ? (
            <p className="text-[0.82rem] text-[var(--os-text-muted)]">{t("lobsterPage.emptyList")}</p>
          ) : (
            filteredAgents.map((a) => {
              const label = agentDisplayLabel(a);
              const preview = a.description?.trim() || t("skillsPage.noDescription");
              return (
                <AgentListItem
                  key={a.id}
                  selected={a.id === selectedId}
                  onClick={() => setSelectedId(a.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base" aria-hidden>
                      {agentAvatarGlyph(a)}
                    </span>
                    <span className="font-medium text-[var(--os-text)]">{label}</span>
                    {a.isMain ? (
                      <span className="rounded-md bg-[color-mix(in_srgb,var(--os-accent)_12%,transparent)] px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wide text-[var(--os-accent)]">
                        {t("agents.mainBadge")}
                      </span>
                    ) : null}
                  </div>
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
                {!selected.isMain ? (
                  <button
                    type="button"
                    className="rounded-[10px] border border-[color-mix(in_srgb,var(--os-danger,#b91c1c)_35%,var(--os-border))] px-3 py-1.5 text-[0.78rem] font-medium text-[var(--os-danger,#b91c1c)] transition hover:bg-[color-mix(in_srgb,var(--os-danger,#b91c1c)_8%,transparent)]"
                    onClick={() => setDeleteTargetId(selected.id)}
                  >
                    {t("lobsterPage.actions.delete")}
                  </button>
                ) : null}
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
                  {t("lobsterPage.fieldAvatar")}
                  <TextField
                    value={selected.avatar}
                    onChange={(e) => patchAgentMeta(selected.id, { avatar: e.target.value })}
                    placeholder={t("lobsterPage.avatarPlaceholder")}
                    maxLength={8}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  {t("lobsterPage.fieldIdentity")}
                  <textarea
                    className="min-h-[120px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 font-mono text-[0.78rem] leading-relaxed text-[var(--os-text)] placeholder:text-[var(--os-text-faint)] focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]"
                    value={selected.identityMd || buildIdentityMd(selected)}
                    onChange={(e) => patchAgentMeta(selected.id, { identityMd: e.target.value })}
                    placeholder={t("lobsterPage.identityPlaceholder")}
                  />
                  <span className="text-[0.68rem] text-[var(--os-text-faint)]">{t("lobsterPage.identityHint")}</span>
                </label>

                <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  {t("lobsterPage.fieldDescription")}
                  <textarea
                    className="min-h-[72px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 text-[0.8125rem] text-[var(--os-text)] placeholder:text-[var(--os-text-faint)] focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]"
                    value={selected.description}
                    onChange={(e) => patchAgentMeta(selected.id, { description: e.target.value })}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  {t("lobsterPage.fieldSoul")}
                  <textarea
                    className="min-h-[140px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 font-mono text-[0.78rem] leading-relaxed text-[var(--os-text)] placeholder:text-[var(--os-text-faint)] focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]"
                    value={selected.soulMd}
                    onChange={(e) => patchAgentMeta(selected.id, { soulMd: e.target.value })}
                    placeholder={t("lobsterPage.soulPlaceholder")}
                  />
                  <span className="text-[0.68rem] text-[var(--os-text-faint)]">{t("lobsterPage.soulHint")}</span>
                </label>

                <div className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                  <span>{t("lobsterPage.fieldGatewayId")}</span>
                  <code className="rounded-lg border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] bg-[var(--os-bg-elevated)] px-2.5 py-2 text-[0.78rem] text-[var(--os-text)]">
                    {selected.gatewayAgentId}
                  </code>
                  <span className="text-[0.68rem] text-[var(--os-text-faint)]">
                    {t("lobsterPage.gatewayIdHint", {
                      session: selected.openclaw?.sessionKey ?? "",
                    })}
                  </span>
                </div>

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
                  <AgentSkillPicker
                    skills={selectableSkills}
                    selectedIds={selected.skillIds}
                    onToggle={toggleSkill}
                    query={skillQuery}
                    onQueryChange={setSkillQuery}
                    filterPlaceholder={t("lobsterPage.skillFilterPlaceholder")}
                    emptyLabel={t("lobsterPage.skillsEmpty")}
                    builtinBadge={t("skillsPage.badgeBuiltin")}
                    userBadge={t("skillsPage.badgeUser")}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {createOpen ? (
        <Modal onClose={() => !createBusy && setCreateOpen(false)} labelledBy={createTitleId}>
          <div className="flex w-full min-w-[min(100vw-2rem,520px)] max-h-[min(90vh,720px)] flex-col bg-[var(--os-bg-modal)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={createTitleId} className="text-base font-semibold">
                {t("lobsterPage.createModal.title")}
              </h2>
              <ModalCloseButton onClick={() => !createBusy && setCreateOpen(false)} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4">
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("lobsterPage.fieldName")}
                <TextField
                  value={createForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCreateForm((prev) => ({
                      ...prev,
                      name,
                      identityMd: syncIdentityNameLine(name, prev.identityMd),
                    }));
                  }}
                  placeholder={t("lobsterPage.createModal.namePlaceholder")}
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("lobsterPage.fieldAvatar")}
                <TextField
                  value={createForm.avatar}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, avatar: e.target.value }))}
                  placeholder={t("lobsterPage.avatarPlaceholder")}
                  maxLength={8}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("lobsterPage.fieldIdentity")}
                <textarea
                  className="min-h-[100px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 font-mono text-[0.78rem] leading-relaxed text-[var(--os-text)]"
                  value={createForm.identityMd}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, identityMd: e.target.value }))}
                  placeholder={t("lobsterPage.identityPlaceholder")}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("lobsterPage.fieldDescription")}
                <textarea
                  className="min-h-[64px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 text-[0.8125rem] text-[var(--os-text)]"
                  value={createForm.description}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("lobsterPage.fieldSoul")}
                <textarea
                  className="min-h-[100px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 font-mono text-[0.78rem] leading-relaxed text-[var(--os-text)]"
                  value={createForm.soulMd}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, soulMd: e.target.value }))}
                  placeholder={t("lobsterPage.soulPlaceholder")}
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[0.75rem] font-medium text-[var(--os-text-muted)]">
                  {t("lobsterPage.skillsHeading")}
                </span>
                <AgentSkillPicker
                  skills={selectableSkills}
                  selectedIds={createForm.skillIds}
                  onToggle={toggleCreateSkill}
                  query={createSkillQuery}
                  onQueryChange={setCreateSkillQuery}
                  filterPlaceholder={t("lobsterPage.skillFilterPlaceholder")}
                  emptyLabel={t("lobsterPage.skillsEmpty")}
                  builtinBadge={t("skillsPage.badgeBuiltin")}
                  userBadge={t("skillsPage.badgeUser")}
                />
              </div>
              {createError ? (
                <p className="text-[0.78rem] text-[var(--os-danger,#b91c1c)]" role="alert">
                  {createError}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <button
                type="button"
                className="rounded-[10px] px-3 py-2 text-[0.8rem] text-[var(--os-text-muted)]"
                disabled={createBusy}
                onClick={() => setCreateOpen(false)}
              >
                {t("skillsPage.cancel")}
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-[var(--os-accent)] px-3.5 py-2 text-[0.8rem] font-medium text-[var(--os-on-accent,#fff)] disabled:opacity-60"
                disabled={createBusy}
                onClick={() => void onConfirmCreate()}
              >
                {createBusy ? t("lobsterPage.createModal.busy") : t("lobsterPage.createModal.confirm")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

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
