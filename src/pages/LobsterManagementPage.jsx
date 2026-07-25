import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { Plus } from "lucide-react";
import agentHero from "../assets/images/agent-hero.png";
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
import Avatar from "../ui/Avatar.jsx";
import TextField from "../ui/TextField.jsx";
import Select from "../ui/Select.jsx";
import TransferDialog from "../ui/TransferDialog.jsx";
import { cn } from "../ui/cn.js";

/** @param {{ className?: string; children: React.ReactNode }} props */
function AgentCardShell({ className, children }) {
  return (
    <article
      className={cn(
        "flex min-h-[148px] flex-col rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] p-3.5 transition-[box-shadow,transform] duration-150",
        "hover:shadow-[0_10px_28px_-12px_color-mix(in_srgb,var(--os-shadow-color,#000)_28%,transparent)]",
        className,
      )}
    >
      {children}
    </article>
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
        size="small"
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
  const detailTitleId = useId();
  const { agents, createAgent, removeAgent, patchAgentMeta } = useStudio();
  const { lib } = useSkillLibrary();
  const skillEnv = useSkillEnvironment();

  const [query, setQuery] = useState("");
  const [detailAgentId, setDetailAgentId] = useState(/** @type {string | null} */ (null));
  const [deleteTargetId, setDeleteTargetId] = useState(/** @type {string | null} */ (null));
  const [skillQuery, setSkillQuery] = useState("");
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [editSidebarField, setEditSidebarField] = useState(/** @type {"identity" | "description" | "soul" | "agents" | "user" | "tools" | "memory" | null} */ (null));
  const [createSkillDialogOpen, setCreateSkillDialogOpen] = useState(false);
  const [createSidebarField, setCreateSidebarField] = useState(/** @type {"identity" | "description" | "soul" | "agents" | "user" | "tools" | "memory" | null} */ (null));
  const [provisionNote, setProvisionNote] = useState(/** @type {string | null} */ (null));
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(/** @type {string | null} */ (null));
  const [createSkillQuery, setCreateSkillQuery] = useState("");
  const [createForm, setCreateForm] = useState(() => ({
    name: "",
    description: "",
    avatar: "",
    identityMd: buildIdentityMd({ name: "", description: "", avatar: "" }),
    soulMd: "",
    agentsMd: "",
    userMd: "",
    toolsMd: "",
    memoryMd: "",
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

  const selectableUserSkills = useMemo(
    () => selectableSkills.filter((s) => s.source === "user"),
    [selectableSkills],
  );

  const skillsForMainAgent = selectableSkills;
  const skillsForSubAgent = selectableUserSkills;

  /** @param {boolean} isMain */
  const selectableSkillsForAgent = (isMain) => (isMain ? skillsForMainAgent : skillsForSubAgent);

  /** @param {string[]} skillIds @param {boolean} isMain */
  const filterSkillIdsForAgent = (skillIds, isMain) => {
    if (isMain) return skillIds;
    const allowed = new Set(skillsForSubAgent.map((s) => s.id));
    return skillIds.filter((id) => allowed.has(id));
  };

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

  const detailAgent = detailAgentId ? agents.find((a) => a.id === detailAgentId) ?? null : null;
  const deleteTarget = deleteTargetId ? agents.find((a) => a.id === deleteTargetId) : null;

  const openDetail = useCallback((agentId) => {
    setSkillQuery("");
    setDetailAgentId(agentId);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailAgentId(null);
    setSkillQuery("");
  }, []);

  useEffect(() => {
    if (!detailAgent) return;
    const bridge = window.studioBridge;
    if (!bridge) return;
    let cancelled = false;
    if (!detailAgent.soulMd.trim() && bridge.readAgentSoul) {
      void bridge.readAgentSoul({ gatewayAgentId: detailAgent.gatewayAgentId }).then((r) => {
        if (cancelled || !r?.ok || typeof r.soulMd !== "string" || !r.soulMd.trim()) return;
        patchAgentMeta(detailAgent.id, { soulMd: r.soulMd });
      });
    }
    if (!detailAgent.identityMd?.trim() && bridge.readAgentIdentity) {
      void bridge.readAgentIdentity({ gatewayAgentId: detailAgent.gatewayAgentId }).then((r) => {
        if (cancelled || !r?.ok || typeof r.identityMd !== "string" || !r.identityMd.trim()) return;
        patchAgentMeta(detailAgent.id, { identityMd: r.identityMd });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [detailAgent, patchAgentMeta]);

  const toggleSkill = (skillId) => {
    if (!detailAgent) return;
    const set = new Set(detailAgent.skillIds);
    if (set.has(skillId)) set.delete(skillId);
    else set.add(skillId);
    patchAgentMeta(detailAgent.id, { skillIds: [...set] });
  };

  const handleAvatarUpload = useCallback(
    /** @param {File} file */
    (file) => {
      if (!detailAgent || !file.type.startsWith("image/")) return;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = /** @type {string} */ (e.target?.result);
          if (dataUrl) {
            patchAgentMeta(detailAgent.id, { avatar: dataUrl });
          }
          resolve();
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
    },
    [detailAgent, patchAgentMeta],
  );

  const handleAvatarClear = useCallback(() => {
    if (!detailAgent) return;
    patchAgentMeta(detailAgent.id, { avatar: "" });
  }, [detailAgent, patchAgentMeta]);

  const handleCreateAvatarUpload = useCallback(
    /** @param {File} file */
    (file) => {
      if (!file.type.startsWith("image/")) return;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = /** @type {string} */ (e.target?.result);
          if (dataUrl) {
            setCreateForm((prev) => ({ ...prev, avatar: dataUrl }));
          }
          resolve();
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
    },
    [],
  );

  const handleCreateAvatarClear = useCallback(() => {
    setCreateForm((prev) => ({ ...prev, avatar: "" }));
  }, []);

  const openCreateModal = useCallback(() => {
    setCreateForm({
      name: "",
      description: "",
      avatar: "",
      identityMd: buildIdentityMd({ name: "", description: "", avatar: "" }),
      soulMd: "",
      agentsMd: "",
      userMd: "",
      toolsMd: "",
      memoryMd: "",
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
        avatar: createForm.avatar.trim() || "",
        identityMd: createForm.identityMd.trim(),
        soulMd: createForm.soulMd.trim(),
        agentsMd: createForm.agentsMd.trim(),
        userMd: createForm.userMd.trim(),
        toolsMd: createForm.toolsMd.trim(),
        memoryMd: createForm.memoryMd.trim(),
        skillIds: createForm.skillIds,
      });
      if (!result.ok) {
        setCreateError(t("lobsterPage.createModal.failed"));
        return;
      }
      setCreateOpen(false);
      if (result.id) openDetail(result.id);
      setProvisionNote(t("lobsterPage.provisionDone"));
      window.setTimeout(() => setProvisionNote(null), 4000);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleImportFromFolder = async () => {
    const bridge = window.studioBridge;
    if (!bridge?.pickWorkspaceFolder || !bridge?.readWorkspaceFolder) {
      setCreateError("当前环境不支持文件夹导入");
      return;
    }
    try {
      const pickResult = await bridge.pickWorkspaceFolder();
      if (!pickResult?.ok) {
        if (!pickResult?.canceled) setCreateError("选择文件夹失败");
        return;
      }
      const folderPath = pickResult.path || pickResult.folderPath;
      if (!folderPath) {
        setCreateError("未选择文件夹");
        return;
      }
      const readResult = await bridge.readWorkspaceFolder({ folderPath });
      if (!readResult?.ok) {
        setCreateError("读取文件夹失败：" + (readResult?.reason || "未知错误"));
        return;
      }
      setCreateForm((prev) => ({
        ...prev,
        soulMd: readResult.soulMd != null ? readResult.soulMd : prev.soulMd,
        identityMd: readResult.identityMd != null ? readResult.identityMd : prev.identityMd,
        agentsMd: readResult.agentsMd != null ? readResult.agentsMd : prev.agentsMd,
        userMd: readResult.userMd != null ? readResult.userMd : prev.userMd,
        toolsMd: readResult.toolsMd != null ? readResult.toolsMd : prev.toolsMd,
        memoryMd: readResult.memoryMd != null ? readResult.memoryMd : prev.memoryMd,
      }));
      let importedCount = 0;
      if (readResult.soulMd != null) importedCount++;
      if (readResult.identityMd != null) importedCount++;
      if (readResult.agentsMd != null) importedCount++;
      if (readResult.userMd != null) importedCount++;
      if (readResult.toolsMd != null) importedCount++;
      if (readResult.memoryMd != null) importedCount++;
      if (importedCount === 0) {
        setCreateError("文件夹中未找到任何 .md 配置文件");
        return;
      }
      setProvisionNote(`已从文件夹导入 ${importedCount} 个配置文件`);
      window.setTimeout(() => setProvisionNote(null), 4000);
    } catch (e) {
      setCreateError("导入失败：" + String(e?.message ?? e));
    }
  };

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <section className="mb-6 flex shrink-0 flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 className="text-[1.65rem] font-semibold tracking-tight text-[var(--os-text)]">
            {t("lobsterPage.heroTitle")}
          </h1>
          <p className="max-w-lg text-[0.875rem] leading-relaxed text-[var(--os-text-muted)]">
            {t("lobsterPage.heroDesc")}
          </p>
          <div className="pt-1">
            <Button type="button" theme="primary" icon={<Plus size={16} />} onClick={openCreateModal}>
              {t("lobsterPage.heroCreate")}
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center lg:justify-end">
          <img
            src={agentHero}
            alt=""
            className="h-auto max-h-[min(220px,32vw)] w-full max-w-[min(360px,88vw)] object-contain"
          />
        </div>
      </section>

      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[1.05rem] font-semibold text-[var(--os-text)]">{t("lobsterPage.listTitle")}</h2>
        <div className="w-full min-w-[220px] max-w-md sm:w-72">
          <Input
            type="search"
            prefixIcon={<SearchSparkleIcon className="opacity-75" aria-hidden />}
            clearable
            value={query}
            onChange={(value) => setQuery(value)}
            placeholder={t("lobsterPage.searchPlaceholder")}
            aria-label={t("lobsterPage.searchPlaceholder")}
          />
        </div>
      </div>

      {provisionNote ? (
        <p className="mb-3 text-[0.78rem] text-[var(--os-text-muted)]" role="status">
          {provisionNote}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto pb-10">
        {filteredAgents.length === 0 ? (
          <p className="text-[0.82rem] text-[var(--os-text-muted)]">{t("lobsterPage.emptyList")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredAgents.map((a) => {
              const label = agentDisplayLabel(a);
              const preview = a.description?.trim() || t("skillsPage.noDescription");
              return (
                <AgentCardShell key={a.id} className="group relative">
                  <div className="flex items-start gap-2.5">
                    <Avatar
                      src={agentAvatarGlyph(a)}
                      name={agentDisplayLabel(a)}
                      size="lg"
                      shape="rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[0.9rem] font-semibold text-[var(--os-text)]">{label}</h3>
                    </div>
                  </div>
                  <p
                    className="mt-2 line-clamp-2 min-h-[2.5rem] cursor-default text-[0.78rem] leading-snug text-[var(--os-text-muted)]"
                    title={a.description?.trim() || undefined}
                  >
                    {preview}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] pt-2.5">
                    {a.isMain ? (
                      <span className="rounded-md bg-[color-mix(in_srgb,var(--os-accent)_12%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--os-accent)]">
                        {t("agents.mainBadge")}
                      </span>
                    ) : null}
                    {a.skillIds?.length ? (
                      <span className="rounded-md bg-[color-mix(in_srgb,var(--os-text-muted)_10%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--os-text-muted)]">
                        {t("lobsterPage.skillCount", { n: a.skillIds.length })}
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        "ml-auto flex shrink-0 items-center gap-2",
                        "opacity-0 transition-opacity duration-200 ease-in-out",
                        "pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                        "group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
                      )}
                    >
                      <Button type="button" variant="outline" size="small" onClick={() => openDetail(a.id)}>
                        {t("lobsterPage.actions.edit")}
                      </Button>
                      {!a.isMain ? (
                        <Button
                          type="button"
                          theme="danger"
                          variant="text"
                          size="small"
                          onClick={() => setDeleteTargetId(a.id)}
                        >
                          {t("lobsterPage.actions.delete")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </AgentCardShell>
              );
            })}
          </div>
        )}
      </div>

      {detailAgent ? (
        <Modal onClose={closeDetail} labelledBy={detailTitleId}>
          <div className={cn("flex w-full max-h-[min(90vh,720px)] flex-col bg-[var(--os-bg-modal)]", editSidebarField ? "min-w-[min(100vw-2rem,760px)]" : "min-w-[min(100vw-2rem,440px)]")}>
            <div className="flex shrink-0 items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={detailTitleId} className="text-base font-semibold">
                {t("lobsterPage.editModal.title", { name: agentDisplayLabel(detailAgent) })}
              </h2>
              <ModalCloseButton onClick={closeDetail} />
            </div>
            <div className="flex min-h-0 flex-1">
              <div className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-4", editSidebarField && "border-r border-[color-mix(in_srgb,var(--os-border)_50%,transparent)]")}>
                {/* Content container - narrow and centered */}
                <div className="max-w-md mx-auto w-full flex flex-col gap-5">
                {/* Avatar on top - centered */}
                <div className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)] items-center">
                  <Avatar
                    src={agentAvatarGlyph(detailAgent)}
                    name={agentDisplayLabel(detailAgent)}
                    size="2xl"
                    shape="rounded"
                    editable={true}
                    onUpload={handleAvatarUpload}
                    onDelete={detailAgent.avatar ? handleAvatarClear : undefined}
                  />
                  <div className="relative mt-2 flex items-center justify-center">
                    <Input
                      borderless
                      align="center"
                      autoWidth
                      size="small"
                      value={detailAgent.name}
                      onChange={(name) => patchAgentMeta(detailAgent.id, { name })}
                      placeholder="输入名称"
                    />
                    <div className="absolute -right-6">
                      <Button type="button" variant="text" size="small" title="编辑名称">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                        <path d="m15 5 4 4"/>
                      </svg>
                      </Button>
                    </div>
                  </div>
                </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.fieldIdentity")}</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("identity")}
                  variant="outline"
                  size="small"
                >
                  编辑身份
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.fieldDescription")}</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("description")}
                  variant="outline"
                  size="small"
                >
                  编辑简介
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.fieldSoul")}</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("soul")}
                  variant="outline"
                  size="small"
                >
                  编辑性格
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">工作流</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("agents")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">用户</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("user")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">工具</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("tools")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">记忆</span>
                <Button
                  type="button"
                  onClick={() => setEditSidebarField("memory")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">导入</span>
                <Button
                  type="button"
                  onClick={async () => {
                    const bridge = window.studioBridge;
                    if (!bridge?.pickWorkspaceFolder || !bridge?.readWorkspaceFolder) {
                      setProvisionNote("⚠️ 当前环境不支持文件夹导入");
                      window.setTimeout(() => setProvisionNote(null), 4000);
                      return;
                    }
                    try {
                      const pickResult = await bridge.pickWorkspaceFolder();
                      if (!pickResult?.ok) {
                        if (!pickResult?.canceled) {
                          setProvisionNote("⚠️ 选择文件夹失败");
                          window.setTimeout(() => setProvisionNote(null), 4000);
                        }
                        return;
                      }
                      const folderPath = pickResult.path || pickResult.folderPath;
                      if (!folderPath) {
                        setProvisionNote("⚠️ 未选择文件夹");
                        window.setTimeout(() => setProvisionNote(null), 4000);
                        return;
                      }
                      const readResult = await bridge.readWorkspaceFolder({ folderPath });
                      if (!readResult?.ok) {
                        setProvisionNote("⚠️ 读取文件夹失败：" + (readResult?.reason || "未知错误"));
                        window.setTimeout(() => setProvisionNote(null), 5000);
                        return;
                      }
                      const patch = {};
                      let importedCount = 0;
                      if (readResult.soulMd != null) { patch.soulMd = readResult.soulMd; importedCount++; }
                      if (readResult.identityMd != null) { patch.identityMd = readResult.identityMd; importedCount++; }
                      if (readResult.agentsMd != null) { patch.agentsMd = readResult.agentsMd; importedCount++; }
                      if (readResult.userMd != null) { patch.userMd = readResult.userMd; importedCount++; }
                      if (readResult.toolsMd != null) { patch.toolsMd = readResult.toolsMd; importedCount++; }
                      if (readResult.memoryMd != null) { patch.memoryMd = readResult.memoryMd; importedCount++; }
                      if (importedCount === 0) {
                        setProvisionNote("⚠️ 文件夹中未找到任何 .md 配置文件");
                        window.setTimeout(() => setProvisionNote(null), 4000);
                        return;
                      }
                      patchAgentMeta(detailAgent.id, patch);
                      setProvisionNote(`✅ 已从文件夹导入 ${importedCount} 个配置文件`);
                      window.setTimeout(() => setProvisionNote(null), 4000);
                    } catch (e) {
                      setProvisionNote("⚠️ 导入失败：" + String(e?.message ?? e));
                      window.setTimeout(() => setProvisionNote(null), 5000);
                    }
                  }}
                  theme="primary"
                  variant="outline"
                  size="small"
                >
                  从文件夹导入
                </Button>
              </div>

              {/* Skills selection button */}
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.skillsHeading")}</span>
                <Button
                  type="button"
                  onClick={() => setSkillDialogOpen(true)}
                  variant="outline"
                  size="small"
                >
                  {t("lobsterPage.selectSkills")}
                </Button>
              </div>
            </div>
            </div>
            {editSidebarField && (
              <div className="w-[320px] shrink-0 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[color-mix(in_srgb,var(--os-border)_30%,transparent)]">
                  <span className="text-[0.85rem] font-medium text-[var(--os-text)]">
                    {editSidebarField === 'identity' ? t("lobsterPage.fieldIdentity") : editSidebarField === 'description' ? t("lobsterPage.fieldDescription") : editSidebarField === 'soul' ? t("lobsterPage.fieldSoul") : editSidebarField === 'agents' ? '工作流 (AGENTS.md)' : editSidebarField === 'user' ? '用户 (USER.md)' : editSidebarField === 'tools' ? '工具 (TOOLS.md)' : '记忆 (MEMORY.md)'}
                  </span>
                  <Button
                    type="button"
                    onClick={() => setEditSidebarField(null)}
                    variant="text"
                    size="small"
                  >
                    ✕
                  </Button>
                </div>
                <textarea
                  className="flex-1 w-full resize-none border-none bg-transparent px-4 py-3 font-mono text-[0.78rem] leading-relaxed text-[var(--os-text)] focus:outline-none placeholder:text-[var(--os-text-faint)]"
                  value={
                    editSidebarField === 'identity' ? (detailAgent.identityMd || buildIdentityMd(detailAgent))
                    : editSidebarField === 'description' ? detailAgent.description
                    : editSidebarField === 'soul' ? detailAgent.soulMd
                    : editSidebarField === 'agents' ? (detailAgent.agentsMd || '')
                    : editSidebarField === 'user' ? (detailAgent.userMd || '')
                    : editSidebarField === 'tools' ? (detailAgent.toolsMd || '')
                    : editSidebarField === 'memory' ? (detailAgent.memoryMd || '')
                    : ''
                  }
                  onChange={(e) => {
                    const field = editSidebarField;
                    if (field === 'identity') patchAgentMeta(detailAgent.id, { identityMd: e.target.value });
                    else if (field === 'description') patchAgentMeta(detailAgent.id, { description: e.target.value });
                    else if (field === 'soul') patchAgentMeta(detailAgent.id, { soulMd: e.target.value });
                    else if (field === 'agents') patchAgentMeta(detailAgent.id, { agentsMd: e.target.value });
                    else if (field === 'user') patchAgentMeta(detailAgent.id, { userMd: e.target.value });
                    else if (field === 'tools') patchAgentMeta(detailAgent.id, { toolsMd: e.target.value });
                    else if (field === 'memory') patchAgentMeta(detailAgent.id, { memoryMd: e.target.value });
                  }}
                  placeholder={
                    editSidebarField === 'identity' ? t("lobsterPage.identityPlaceholder")
                    : editSidebarField === 'description' ? t("lobsterPage.descriptionPlaceholder")
                    : editSidebarField === 'soul' ? t("lobsterPage.soulPlaceholder")
                    : ''
                  }
                />
              </div>
            )}
          </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              {!detailAgent.isMain ? (
                <div className="mr-auto">
                  <Button
                    type="button"
                    theme="danger"
                    variant="text"
                    size="small"
                    onClick={() => {
                      closeDetail();
                      setDeleteTargetId(detailAgent.id);
                    }}
                  >
                    {t("lobsterPage.actions.delete")}
                  </Button>
                </div>
              ) : null}
              <Button type="button" theme="primary" onClick={closeDetail}>
                {t("skillsPage.close")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {createOpen ? (
        <Modal onClose={() => !createBusy && setCreateOpen(false)} labelledBy={createTitleId}>
          <div className={cn("flex w-full max-h-[min(90vh,720px)] flex-col bg-[var(--os-bg-modal)]", createSidebarField ? "min-w-[min(100vw-2rem,760px)]" : "min-w-[min(100vw-2rem,440px)]")}>
            <div className="flex shrink-0 items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={createTitleId} className="text-base font-semibold">
                {t("lobsterPage.createModal.title")}
              </h2>
              <ModalCloseButton onClick={() => !createBusy && setCreateOpen(false)} />
            </div>
            <div className="flex min-h-0 flex-1">
              <div className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-4", createSidebarField && "border-r border-[color-mix(in_srgb,var(--os-border)_50%,transparent)]")}>
                {/* Content container - narrow and centered */}
                <div className="max-w-md mx-auto w-full flex flex-col gap-5">
                {/* Avatar on top - centered */}
                <div className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)] items-center">
                  <Avatar
                    src={createForm.avatar}
                    name={createForm.name || "New Agent"}
                    size="2xl"
                    shape="rounded"
                    editable={true}
                    onUpload={handleCreateAvatarUpload}
                    onDelete={createForm.avatar ? handleCreateAvatarClear : undefined}
                  />
                  <div className="relative mt-2 flex items-center justify-center">
                    <Input
                      borderless
                      align="center"
                      autoWidth
                      size="small"
                      value={createForm.name}
                      onChange={(name) => {
                        setCreateForm((prev) => ({
                          ...prev,
                          name,
                          identityMd: syncIdentityNameLine(name, prev.identityMd),
                        }));
                      }}
                      placeholder="输入名称"
                      autofocus
                    />
                    <div className="absolute -right-6">
                      <Button type="button" variant="text" size="small" title="编辑名称">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                          <path d="m15 5 4 4"/>
                        </svg>
                      </Button>
                    </div>
                  </div>
                </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.fieldIdentity")}</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("identity")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.fieldDescription")}</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("description")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.fieldSoul")}</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("soul")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">工作流</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("agents")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">用户</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("user")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">工具</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("tools")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">记忆</span>
                <Button
                  type="button"
                  onClick={() => setCreateSidebarField("memory")}
                  variant="outline"
                  size="small"
                >
                  编辑
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">导入</span>
                <Button
                  type="button"
                  onClick={handleImportFromFolder}
                  theme="primary"
                  variant="outline"
                  size="small"
                >
                  从文件夹导入
                </Button>
              </div>
              <div className="flex flex-row items-center justify-between gap-3 text-[0.75rem] text-[var(--os-text-muted)]">
                <span className="min-w-[80px] shrink-0">{t("lobsterPage.skillsHeading")}</span>
                <Button
                  type="button"
                  onClick={() => setCreateSkillDialogOpen(true)}
                  variant="outline"
                  size="small"
                >
                  {t("lobsterPage.selectSkills")}
                </Button>
              </div>
              {createError ? (
                <p className="text-[0.78rem] text-[var(--os-danger,#b91c1c)]" role="alert">
                  {createError}
                </p>
              ) : null}
              </div>
            </div>
            {createSidebarField && (
              <div className="w-[320px] shrink-0 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[color-mix(in_srgb,var(--os-border)_30%,transparent)]">
                  <span className="text-[0.85rem] font-medium text-[var(--os-text)]">
                    {createSidebarField === 'identity' ? t("lobsterPage.fieldIdentity") : createSidebarField === 'description' ? t("lobsterPage.fieldDescription") : createSidebarField === 'soul' ? t("lobsterPage.fieldSoul") : createSidebarField === 'agents' ? '工作流 (AGENTS.md)' : createSidebarField === 'user' ? '用户 (USER.md)' : createSidebarField === 'tools' ? '工具 (TOOLS.md)' : '记忆 (MEMORY.md)'}
                  </span>
                  <Button
                    type="button"
                    onClick={() => setCreateSidebarField(null)}
                    variant="text"
                    size="small"
                  >
                    ✕
                  </Button>
                </div>
                <textarea
                  className="flex-1 w-full resize-none border-none bg-transparent px-4 py-3 font-mono text-[0.78rem] leading-relaxed text-[var(--os-text)] focus:outline-none placeholder:text-[var(--os-text-faint)]"
                  value={
                    createSidebarField === 'identity' ? createForm.identityMd
                    : createSidebarField === 'description' ? createForm.description
                    : createSidebarField === 'soul' ? createForm.soulMd
                    : createSidebarField === 'agents' ? (createForm.agentsMd || '')
                    : createSidebarField === 'user' ? (createForm.userMd || '')
                    : createSidebarField === 'tools' ? (createForm.toolsMd || '')
                    : createSidebarField === 'memory' ? (createForm.memoryMd || '')
                    : ''
                  }
                  onChange={(e) => {
                    const field = createSidebarField;
                    if (field === 'identity') setCreateForm((prev) => ({ ...prev, identityMd: e.target.value }));
                    else if (field === 'description') setCreateForm((prev) => ({ ...prev, description: e.target.value }));
                    else if (field === 'soul') setCreateForm((prev) => ({ ...prev, soulMd: e.target.value }));
                    else if (field === 'agents') setCreateForm((prev) => ({ ...prev, agentsMd: e.target.value }));
                    else if (field === 'user') setCreateForm((prev) => ({ ...prev, userMd: e.target.value }));
                    else if (field === 'tools') setCreateForm((prev) => ({ ...prev, toolsMd: e.target.value }));
                    else if (field === 'memory') setCreateForm((prev) => ({ ...prev, memoryMd: e.target.value }));
                  }}
                  placeholder={
                    createSidebarField === 'identity' ? t("lobsterPage.identityPlaceholder")
                    : createSidebarField === 'description' ? t("lobsterPage.descriptionPlaceholder")
                    : createSidebarField === 'soul' ? t("lobsterPage.soulPlaceholder")
                    : ''
                  }
                />
              </div>
            )}
          </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <Button type="button" variant="text" disabled={createBusy} onClick={() => setCreateOpen(false)}>
                {t("skillsPage.cancel")}
              </Button>
              <Button
                type="button"
                theme="primary"
                disabled={createBusy}
                onClick={() => void onConfirmCreate()}
              >
                {createBusy ? t("lobsterPage.createModal.busy") : t("lobsterPage.createModal.confirm")}
              </Button>
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
              <Button type="button" variant="text" onClick={() => setDeleteTargetId(null)}>
                {t("skillsPage.cancel")}
              </Button>
              <Button
                type="button"
                theme="danger"
                onClick={() => {
                  removeAgent(deleteTarget.id);
                  setDeleteTargetId(null);
                  if (detailAgentId === deleteTarget.id) closeDetail();
                }}
              >
                {t("lobsterPage.deleteModal.confirm")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Skill Transfer Dialog for Edit Modal */}
      <TransferDialog
        open={skillDialogOpen}
        onOpenChange={setSkillDialogOpen}
        title={t("lobsterPage.skillsDialogTitle")}
        items={selectableSkillsForAgent(Boolean(detailAgent?.isMain)).map((s) => ({ key: s.id, label: s.title }))}
        targetKeys={filterSkillIdsForAgent(detailAgent?.skillIds ?? [], Boolean(detailAgent?.isMain))}
        onConfirm={(targetKeys) => {
          if (detailAgent) {
            patchAgentMeta(detailAgent.id, {
              skillIds: filterSkillIdsForAgent(targetKeys, Boolean(detailAgent.isMain)),
            });
          }
          setSkillDialogOpen(false);
        }}
        sourceTitle={t("lobsterPage.skillsSource")}
        targetTitle={t("lobsterPage.skillsTarget")}
        searchPlaceholder={t("lobsterPage.skillFilterPlaceholder")}
        emptySource={t("lobsterPage.skillsEmpty")}
        emptyTarget={t("lobsterPage.skillsEmptyTarget")}
        showSearch={true}
        confirmLabel={t("lobsterPage.skillsConfirm")}
        cancelLabel={t("skillsPage.cancel")}
      />

      {/* Skill Transfer Dialog for Create Modal */}
      <TransferDialog
        open={createSkillDialogOpen}
        onOpenChange={setCreateSkillDialogOpen}
        title={t("lobsterPage.skillsDialogTitle")}
        items={skillsForSubAgent.map((s) => ({ key: s.id, label: s.title }))}
        targetKeys={filterSkillIdsForAgent(createForm.skillIds, false)}
        onConfirm={(targetKeys) => {
          setCreateForm((prev) => ({ ...prev, skillIds: filterSkillIdsForAgent(targetKeys, false) }));
          setCreateSkillDialogOpen(false);
        }}
        sourceTitle={t("lobsterPage.skillsSource")}
        targetTitle={t("lobsterPage.skillsTarget")}
        searchPlaceholder={t("lobsterPage.skillFilterPlaceholder")}
        emptySource={t("lobsterPage.skillsEmpty")}
        emptyTarget={t("lobsterPage.skillsEmptyTarget")}
        showSearch={true}
        confirmLabel={t("lobsterPage.skillsConfirm")}
        cancelLabel={t("skillsPage.cancel")}
      />
    </div>
  );
}
