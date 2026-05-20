import { useCallback, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { filterUsableBundledSkills } from "../skills/skillAvailability.js";
import { pathBasename, userSkillDisplayTitle } from "../skills/skillDisplay.js";
import { BUILTIN_CATEGORY_IDS, BUILTIN_SKILL_DEFS } from "../skills/skillsCatalog.js";
import { OPENCLAW_BUNDLED_SKILLS, formatSkillTitle } from "../skills/skillRegistry.js";
import { useSkillEnvironment } from "../skills/useSkillEnvironment.js";
import { useSkillLibrary } from "../skills/useSkillLibrary.js";
import FluidTabBar from "../ui/FluidTabBar.jsx";
import Modal from "../ui/Modal.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import TextField from "../ui/TextField.jsx";
import { cn } from "../ui/cn.js";

const ALL_FILTER = "__all__";

/** Bundled card body: prefer `skillsPage.openclawDesc.<skillId>` when present. */
function openclawCardDescription(skillId, manifestDescription, t) {
  const key = `skillsPage.openclawDesc.${skillId}`;
  const tr = t(key);
  if (tr !== key && String(tr).trim()) return String(tr).trim();
  return manifestDescription;
}

/** @param {{ className?: string; children: React.ReactNode }} props */
function SkillCardShell({ className, children }) {
  return (
    <article
      className={cn(
        "flex min-h-[148px] flex-col rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] p-3.5 shadow-[var(--os-shadow-soft)] transition-[box-shadow,transform] duration-150",
        "hover:shadow-[0_10px_28px_-12px_color-mix(in_srgb,var(--os-shadow-color,#000)_28%,transparent)]",
        className,
      )}
    >
      {children}
    </article>
  );
}

export default function SkillMarketPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { lib, addUserSkill, removeUserSkill, addUserCategory, removeUserCategory } = useSkillLibrary();
  const skillEnv = useSkillEnvironment();
  const canOpenFolder = Boolean(typeof window !== "undefined" && window.studioBridge?.openSkillDirectory);
  const titleId = useId();

  const [filterId, setFilterId] = useState(ALL_FILTER);
  const [query, setQuery] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadPath, setUploadPath] = useState("");
  const [uploadCategoryId, setUploadCategoryId] = useState(BUILTIN_CATEGORY_IDS.GENERAL);

  const [newCatLabel, setNewCatLabel] = useState("");

  const builtinCategoryList = useMemo(
    () => [
      BUILTIN_CATEGORY_IDS.OPENCLAW_BUNDLED,
      BUILTIN_CATEGORY_IDS.GENERAL,
      BUILTIN_CATEGORY_IDS.DEV,
      BUILTIN_CATEGORY_IDS.OFFICE,
      BUILTIN_CATEGORY_IDS.DATA,
    ],
    [],
  );

  const openclawSkillById = useMemo(() => new Map(OPENCLAW_BUNDLED_SKILLS.map((s) => [s.id, s])), []);

  const usableBuiltinDefs = useMemo(() => {
    const usableIds = new Set(
      filterUsableBundledSkills(OPENCLAW_BUNDLED_SKILLS, skillEnv).map((s) => s.id),
    );
    return BUILTIN_SKILL_DEFS.filter((def) => usableIds.has(def.id));
  }, [skillEnv]);

  const openSkillFolder = useCallback(async (payload) => {
    const open = window.studioBridge?.openSkillDirectory;
    if (!open) return;
    try {
      const res = await open(payload);
      if (!res?.ok) {
        const detail =
          res?.message === "path_not_found"
            ? t("skillsPage.openFolderNotFound")
            : res?.message
              ? String(res.message)
              : "";
        window.alert(detail ? `${t("skillsPage.openFolderFailed")}\n${detail}` : t("skillsPage.openFolderFailed"));
      }
    } catch {
      window.alert(t("skillsPage.openFolderFailed"));
    }
  }, [t]);

  const categoryRows = useMemo(() => {
    const builtins = builtinCategoryList.map((id) => ({
      id,
      label: t(`skillsPage.categoryLabels.${id}`),
      removable: false,
    }));
    const users = lib.userCategories.map((c) => ({
      id: c.id,
      label: c.label,
      removable: true,
    }));
    return [...builtins, ...users];
  }, [builtinCategoryList, lib.userCategories, t]);

  const filterTabs = useMemo(
    () => [{ id: ALL_FILTER, label: t("skillsPage.filterAll") }, ...categoryRows.map((row) => ({ id: row.id, label: row.label }))],
    [categoryRows, t],
  );

  const normalizedQuery = query.trim().toLowerCase();

  const matchesQuery = useCallback(
    (title, description) => {
      if (!normalizedQuery) return true;
      return (
        title.toLowerCase().includes(normalizedQuery) || description.toLowerCase().includes(normalizedQuery)
      );
    },
    [normalizedQuery],
  );

  const filteredBuiltin = useMemo(() => {
    return usableBuiltinDefs.filter((def) => {
      if (filterId !== ALL_FILTER && def.categoryId !== filterId) return false;
      const meta = openclawSkillById.get(def.id);
      const title = meta ? formatSkillTitle(meta.name) : def.id;
      const manifestDesc = meta?.description ?? "";
      const desc = openclawCardDescription(def.id, manifestDesc, t);
      return matchesQuery(title, desc);
    });
  }, [filterId, matchesQuery, openclawSkillById, t, usableBuiltinDefs]);

  const filteredUser = useMemo(() => {
    return lib.userSkills.filter((s) => {
      if (filterId !== ALL_FILTER && s.categoryId !== filterId) return false;
      const title = userSkillDisplayTitle(s);
      return matchesQuery(title, s.description);
    });
  }, [filterId, lib.userSkills, matchesQuery]);

  const resetUploadForm = useCallback(() => {
    setUploadTitle("");
    setUploadDesc("");
    setUploadPath("");
    setUploadCategoryId(BUILTIN_CATEGORY_IDS.GENERAL);
  }, []);

  const onConfirmUpload = useCallback(() => {
    const localPath = uploadPath.trim() || undefined;
    const title =
      (localPath ? pathBasename(localPath) : "") ||
      uploadTitle.trim() ||
      t("skillsPage.upload.defaultTitle");
    addUserSkill({
      title,
      description: uploadDesc.trim(),
      categoryId: uploadCategoryId,
      localPath,
      fromNl: false,
    });
    resetUploadForm();
    setUploadOpen(false);
  }, [addUserSkill, resetUploadForm, t, uploadCategoryId, uploadDesc, uploadPath, uploadTitle]);

  const onAddCategory = useCallback(() => {
    const label = newCatLabel.trim();
    if (!label) return;
    addUserCategory(label);
    setNewCatLabel("");
  }, [addUserCategory, newCatLabel]);

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <header className="route-page__header shrink-0">
        <h1 className="route-page__title">{t("skillsPage.title")}</h1>
        {/* <p className="route-page__desc muted">{t("skillsPage.desc")}</p> */}
      </header>

      <div className="mb-4 flex min-h-0 shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-[11px] bg-[var(--os-accent)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-on-accent,#fff)] shadow-sm transition hover:opacity-95"
            onClick={() => setUploadOpen(true)}
          >
            {t("skillsPage.actions.upload")}
          </button>
          <button
            type="button"
            className="rounded-[11px] border border-[color-mix(in_srgb,var(--os-border)_85%,transparent)] bg-[var(--os-bg-elevated)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-text)] transition hover:bg-[color-mix(in_srgb,var(--os-bg-panel)_70%,var(--os-bg-elevated))]"
            onClick={() => navigate("/chat?composeSkill=skill-creator")}
          >
            {t("skillsPage.actions.createNl")}
          </button>
          <button
            type="button"
            className="rounded-[11px] border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] bg-transparent px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-text-muted)] transition hover:border-[var(--os-border)] hover:text-[var(--os-text)]"
            onClick={() => setCatOpen(true)}
          >
            {t("skillsPage.actions.manageCategories")}
          </button>
        </div>

        <label className="relative flex w-full min-w-[220px] max-w-md sm:w-72">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--os-text-muted)]">
            <SearchSparkleIcon className="opacity-75" />
          </span>
          <TextField
            className="h-10 pl-9 text-[0.8125rem]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skillsPage.searchPlaceholder")}
            aria-label={t("skillsPage.searchPlaceholder")}
          />
        </label>
      </div>

      <FluidTabBar
        className="mb-4 shrink-0"
        ariaLabel={t("skillsPage.filterTabsAria")}
        items={filterTabs}
        value={filterId}
        onChange={setFilterId}
      />

      <div className="min-h-0 flex-1 space-y-8 overflow-auto pb-10">
        <section aria-label={t("skillsPage.sectionBuiltin")}>
          <h2 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--os-text-faint)]">
            {t("skillsPage.sectionBuiltin")}  
          </h2>
          {/* <p className="mb-3 text-[0.7rem] leading-snug text-[var(--os-text-faint)]">
            {t("skillsPage.openclawBuiltinDescHint")}
          </p> */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredBuiltin.map((def) => {
              const meta = openclawSkillById.get(def.id);
              const title = meta ? formatSkillTitle(meta.name) : def.id;
              const manifestDesc = meta?.description ?? "";
              const desc = openclawCardDescription(def.id, manifestDesc, t);
              return (
              <SkillCardShell key={def.id}>
                <div className="flex items-start gap-2.5">
                  <span className="text-xl leading-none" aria-hidden>
                    {def.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[0.9rem] font-semibold text-[var(--os-text)]">
                      {title}
                    </h3>
                  </div>
                </div>
                <p
                  className="mt-2 line-clamp-2 min-h-[2.5rem] cursor-default text-[0.78rem] leading-snug text-[var(--os-text-muted)]"
                  title={manifestDesc || undefined}
                >
                  {desc}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] pt-2.5">
                  <span className="rounded-md bg-[color-mix(in_srgb,var(--os-accent)_12%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--os-accent)]">
                    {t("skillsPage.badgeBuiltin")}
                  </span>
                  {canOpenFolder ? (
                    <button
                      type="button"
                      className="ml-auto rounded-lg border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] px-2 py-1 text-[0.7rem] font-medium text-[var(--os-text-muted)] transition hover:border-[var(--os-border)] hover:text-[var(--os-text)]"
                      onClick={() => openSkillFolder({ kind: "bundled", skillId: def.id })}
                    >
                      {t("skillsPage.openFolder")}
                    </button>
                  ) : null}
                </div>
              </SkillCardShell>
            );})}
          </div>
          {filteredBuiltin.length === 0 ? (
            <p className="mt-3 text-[0.82rem] text-[var(--os-text-muted)]">{t("skillsPage.emptyBuiltin")}</p>
          ) : null}
        </section>

        <section aria-label={t("skillsPage.sectionUser")}>
          <h2 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--os-text-faint)]">
            {t("skillsPage.sectionUser")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredUser.map((s) => {
              const displayTitle = userSkillDisplayTitle(s);
              const canOpenUserFolder = canOpenFolder && Boolean(s.localPath?.trim());
              return (
              <SkillCardShell key={s.id} className="group relative">
                <div className="flex items-start gap-2.5">
                  <span className="text-xl leading-none" aria-hidden>
                    {s.fromNl ? "✨" : "📁"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[0.9rem] font-semibold text-[var(--os-text)]">{displayTitle}</h3>
                  </div>
                </div>
                <p
                  className="mt-2 line-clamp-2 min-h-[2.5rem] cursor-default text-[0.78rem] leading-snug text-[var(--os-text-muted)]"
                  title={s.description ? s.description : undefined}
                >
                  {s.description || t("skillsPage.noDescription")}
                </p>
                {s.localPath ? (
                  <p className="mt-1 truncate font-mono text-[0.68rem] text-[var(--os-text-faint)]" title={s.localPath}>
                    {s.localPath}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] pt-2.5">
                  <span className="rounded-md bg-[color-mix(in_srgb,var(--os-text-muted)_10%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--os-text-muted)]">
                    {t("skillsPage.badgeUser")}
                  </span>
                  {canOpenUserFolder ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[color-mix(in_srgb,var(--os-border)_55%,transparent)] px-2 py-1 text-[0.7rem] font-medium text-[var(--os-text-muted)] transition hover:border-[var(--os-border)] hover:text-[var(--os-text)]"
                      onClick={() => openSkillFolder({ kind: "user", localPath: s.localPath })}
                    >
                      {t("skillsPage.openFolder")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ml-auto rounded-lg px-2 py-1 text-[0.7rem] font-medium text-[#c45a5a] opacity-80 transition hover:opacity-100 group-hover:opacity-100"
                    onClick={() => removeUserSkill(s.id)}
                  >
                    {t("skillsPage.delete")}
                  </button>
                </div>
              </SkillCardShell>
            );})}
          </div>
          {filteredUser.length === 0 ? (
            <p className="mt-3 text-[0.82rem] text-[var(--os-text-muted)]">{t("skillsPage.emptyUser")}</p>
          ) : null}
        </section>
      </div>

      {uploadOpen ? (
        <Modal onClose={() => { setUploadOpen(false); resetUploadForm(); }} labelledBy={titleId}>
          <div className="flex w-full min-w-[min(100vw-2rem,440px)] flex-col bg-[var(--os-bg-modal)]">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={titleId} className="text-base font-semibold">
                {t("skillsPage.upload.title")}
              </h2>
              <ModalCloseButton
                onClick={() => {
                  setUploadOpen(false);
                  resetUploadForm();
                }}
              />
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("skillsPage.upload.fieldTitle")}
                <TextField value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("skillsPage.upload.fieldDesc")}
                <textarea
                  className="min-h-[72px] resize-y rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 py-2 text-[0.8125rem] text-[var(--os-text)] placeholder:text-[var(--os-text-faint)] focus-visible:border-[color-mix(in_srgb,var(--os-accent)_38%,var(--os-border))] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--os-focus-ring)_28%,transparent)]"
                  value={uploadDesc}
                  onChange={(e) => setUploadDesc(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("skillsPage.upload.fieldPath")}
                <TextField
                  value={uploadPath}
                  onChange={(e) => setUploadPath(e.target.value)}
                  placeholder={t("skillsPage.upload.pathPlaceholder")}
                />
              </label>
              <p className="text-[0.7rem] leading-snug text-[var(--os-text-faint)]">{t("skillsPage.upload.pathHint")}</p>
              <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
                {t("skillsPage.upload.fieldCategory")}
                <select
                  className="box-border h-8 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-2.5 text-[0.8125rem] text-[var(--os-text)]"
                  value={uploadCategoryId}
                  onChange={(e) => setUploadCategoryId(e.target.value)}
                >
                  {categoryRows.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <button
                type="button"
                className="rounded-[10px] px-3 py-2 text-[0.8rem] text-[var(--os-text-muted)]"
                onClick={() => {
                  setUploadOpen(false);
                  resetUploadForm();
                }}
              >
                {t("skillsPage.cancel")}
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-[var(--os-accent)] px-3.5 py-2 text-[0.8rem] font-medium text-[var(--os-on-accent,#fff)]"
                onClick={onConfirmUpload}
              >
                {t("skillsPage.upload.confirm")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {catOpen ? (
        <Modal onClose={() => setCatOpen(false)} labelledBy={`${titleId}-cat`}>
          <div className="flex w-full min-w-[min(100vw-2rem,420px)] flex-col bg-[var(--os-bg-modal)]">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={`${titleId}-cat`} className="text-base font-semibold">
                {t("skillsPage.catModal.title")}
              </h2>
              <ModalCloseButton onClick={() => setCatOpen(false)} />
            </div>
            <div className="max-h-[min(60vh,360px)] space-y-2 overflow-auto px-5 py-4">
              <p className="text-[0.78rem] text-[var(--os-text-muted)]">{t("skillsPage.catModal.builtinHint")}</p>
              <ul className="space-y-1.5">
                {categoryRows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between rounded-lg border border-[color-mix(in_srgb,var(--os-border)_45%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_80%,transparent)] px-3 py-2 text-[0.8125rem]"
                  >
                    <span>{row.label}</span>
                    {row.removable ? (
                      <button
                        type="button"
                        className="text-[0.72rem] font-medium text-[#c45a5a]"
                        onClick={() => removeUserCategory(row.id)}
                      >
                        {t("skillsPage.delete")}
                      </button>
                    ) : (
                      <span className="text-[0.68rem] text-[var(--os-text-faint)]">{t("skillsPage.catModal.builtin")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <div className="flex gap-2">
                <TextField
                  className="flex-1"
                  value={newCatLabel}
                  onChange={(e) => setNewCatLabel(e.target.value)}
                  placeholder={t("skillsPage.catModal.newPlaceholder")}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-[10px] bg-[var(--os-accent)] px-3 py-2 text-[0.8rem] font-medium text-[var(--os-on-accent,#fff)] disabled:opacity-45"
                  disabled={!newCatLabel.trim()}
                  onClick={onAddCategory}
                >
                  {t("skillsPage.catModal.add")}
                </button>
              </div>
              <button type="button" className="self-end text-[0.8rem] text-[var(--os-text-muted)]" onClick={() => setCatOpen(false)}>
                {t("skillsPage.close")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
