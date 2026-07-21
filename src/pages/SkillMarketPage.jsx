import { useCallback, useId, useMemo, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { Space, Tabs } from "tdesign-react";
import OsEmpty from "../ui/OsEmpty.jsx";
import { AddIcon, FolderIcon } from "tdesign-icons-react";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { filterUsableBundledSkills } from "../skills/skillAvailability.js";
import { pathBasename, userSkillDisplayTitle } from "../skills/skillDisplay.js";
import { BUILTIN_SKILL_DEFS } from "../skills/skillsCatalog.js";
import { OPENCLAW_BUNDLED_SKILLS, formatSkillTitle } from "../skills/skillRegistry.js";
import { useSkillEnvironment } from "../skills/useSkillEnvironment.js";
import { useSkillLibrary } from "../skills/useSkillLibrary.js";
import Modal from "../ui/Modal.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import TextField from "../ui/TextField.jsx";
import { cn } from "../ui/cn.js";

const ALL_FILTER = "__all__";
const BUILTIN_FILTER = "__builtin__";
const OTHER_FILTER = "__other__";

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
        "relative flex min-h-[168px] flex-col overflow-hidden rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-panel)_88%,var(--os-bg-elevated))] p-3.5 transition-[box-shadow,transform] duration-150",
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
  const { lib, addUserSkill, removeUserSkill, addUserCategory } = useSkillLibrary();
  const skillEnv = useSkillEnvironment();
  const canOpenFolder = Boolean(typeof window !== "undefined" && window.studioBridge?.openSkillDirectory);
  const uploadTitleId = useId();
  const addCategoryTitleId = useId();

  const [filterId, setFilterId] = useState(ALL_FILTER);
  const [query, setQuery] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadPath, setUploadPath] = useState("");
  const [uploadCategoryId, setUploadCategoryId] = useState(OTHER_FILTER);

  const openclawSkillById = useMemo(() => new Map(OPENCLAW_BUNDLED_SKILLS.map((s) => [s.id, s])), []);

  const usableBuiltinDefs = useMemo(() => {
    if (skillEnv.loading) return [];
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

  const customCategoryMap = useMemo(() => {
    return new Map(lib.userCategories.map((c) => [c.id, c.label]));
  }, [lib.userCategories]);

  const categoryTabs = useMemo(() => {
    return [
      { id: ALL_FILTER, label: "全部" },
      { id: BUILTIN_FILTER, label: "内置" },
      { id: OTHER_FILTER, label: "其他" },
      ...lib.userCategories.map((c) => ({ id: c.id, label: c.label })),
    ];
  }, [lib.userCategories]);

  const uploadCategoryOptions = useMemo(() => {
    return [{ id: OTHER_FILTER, label: "其他" }, ...lib.userCategories];
  }, [lib.userCategories]);

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
      if (filterId !== ALL_FILTER && filterId !== BUILTIN_FILTER) return false;
      const meta = openclawSkillById.get(def.id);
      const title = meta ? formatSkillTitle(meta.name) : def.id;
      const manifestDesc = meta?.description ?? "";
      const desc = openclawCardDescription(def.id, manifestDesc, t);
      return matchesQuery(title, desc);
    });
  }, [filterId, matchesQuery, openclawSkillById, t, usableBuiltinDefs]);

  const filteredUser = useMemo(() => {
    return lib.userSkills.filter((s) => {
      const categoryId = customCategoryMap.has(s.categoryId) ? s.categoryId : OTHER_FILTER;
      if (filterId === BUILTIN_FILTER) return false;
      if (filterId !== ALL_FILTER && filterId !== categoryId) return false;
      const title = userSkillDisplayTitle(s);
      return matchesQuery(title, s.description);
    });
  }, [customCategoryMap, filterId, lib.userSkills, matchesQuery]);

  const shouldShowBuiltinLoading = skillEnv.loading && (filterId === ALL_FILTER || filterId === BUILTIN_FILTER);
  const visibleCount = filteredBuiltin.length + filteredUser.length;
  const shouldShowEmpty = !shouldShowBuiltinLoading && visibleCount === 0;

  const resetUploadForm = useCallback(() => {
    setUploadTitle("");
    setUploadDesc("");
    setUploadPath("");
    setUploadCategoryId(OTHER_FILTER);
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
      categoryId: uploadCategoryId || OTHER_FILTER,
      localPath,
      fromNl: false,
    });
    resetUploadForm();
    setUploadOpen(false);
  }, [addUserSkill, resetUploadForm, t, uploadCategoryId, uploadDesc, uploadPath, uploadTitle]);

  const onAddCategory = useCallback(() => {
    setNewCategoryLabel("");
    setAddCategoryOpen(true);
  }, []);

  const onConfirmAddCategory = useCallback(() => {
    const label = newCategoryLabel.trim();
    if (!label) return;
    if (["全部", "内置", "其他"].includes(label)) {
      window.alert("该分类名已被占用");
      return;
    }
    const exists = lib.userCategories.some((c) => c.label.trim().toLowerCase() === label.toLowerCase());
    if (exists) {
      window.alert("分类已存在");
      return;
    }
    const id = addUserCategory(label);
    if (id) {
      setFilterId(id);
      setAddCategoryOpen(false);
      setNewCategoryLabel("");
    }
  }, [addUserCategory, lib.userCategories, newCategoryLabel]);

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <div style={{ marginBottom: 16 }}>
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 auto", maxWidth: "calc(100% - 380px)" }}>
            <Space align="center" size={6}>
              <div style={{ minWidth: 0 }}>
                <Tabs
                  value={filterId}
                  list={categoryTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
                  onChange={(value) => setFilterId(String(value))}
                />
              </div>
              <Button type="button" variant="text" shape="square" size="small" icon={<AddIcon />} onClick={onAddCategory} aria-label="新增分类" />
            </Space>
          </div>
          <Space align="center" size={8} style={{ flexShrink: 0 }}>
            <Input
              type="search"
              style={{ width: 220 }}
              prefixIcon={<SearchSparkleIcon aria-hidden />}
              clearable
              value={query}
              onChange={(value) => setQuery(value)}
              placeholder={t("skillsPage.searchPlaceholder")}
              aria-label={t("skillsPage.searchPlaceholder")}
            />
            <Button type="button" theme="primary" icon={<AddIcon />} onClick={() => setUploadOpen(true)}>
              {t("skillsPage.actions.upload")}
            </Button>
          </Space>
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto pb-10",
          (shouldShowBuiltinLoading || shouldShowEmpty) && "flex items-center justify-center pb-0",
        )}
      >
        {shouldShowBuiltinLoading ? (
          <OsEmpty description="正在加载技能..." />
        ) : shouldShowEmpty ? (
          <OsEmpty description={t("skillsPage.emptyBuiltin")} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredBuiltin.map((def) => {
              const meta = openclawSkillById.get(def.id);
              const title = meta ? formatSkillTitle(meta.name) : def.id;
              const manifestDesc = meta?.description ?? "";
              const desc = openclawCardDescription(def.id, manifestDesc, t);
              return (
                <SkillCardShell key={def.id} className="group">
                  <div className="flex items-start gap-2.5">
                    <span className="text-xl leading-none" aria-hidden>
                      {def.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[0.9rem] font-semibold text-[var(--os-text)]">
                        {title}
                      </h3>
                    </div>
                    <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--os-accent)_12%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--os-accent)]">
                      {t("skillsPage.badgeBuiltin")}
                    </span>
                  </div>
                  <p
                    className="mt-2 flex-1 cursor-default whitespace-pre-wrap text-[0.78rem] leading-snug text-[var(--os-text-muted)]"
                    title={manifestDesc || undefined}
                  >
                    {desc}
                  </p>
                  {canOpenFolder ? (
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-x-0 bottom-0 z-[1] opacity-0 transition-opacity duration-200 ease-in-out",
                        "group-hover:opacity-100 group-focus-within:opacity-100",
                      )}
                      aria-hidden
                    >
                      <div className="h-14 bg-gradient-to-b from-transparent to-[var(--os-bg-elevated)]" />
                      <div className="-mt-1 flex items-center justify-end px-3.5 pb-3.5">
                        <div className="pointer-events-auto">
                          <Button
                            type="button"
                            variant="outline"
                            size="small"
                            icon={<FolderIcon />}
                            onClick={() => openSkillFolder({ kind: "bundled", skillId: def.id })}
                          >
                            {t("skillsPage.openFolder")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </SkillCardShell>
              );
            })}
            {filteredUser.map((s) => {
              const displayTitle = userSkillDisplayTitle(s);
              const canOpenUserFolder = canOpenFolder && Boolean(s.localPath?.trim());
              const badgeLabel = customCategoryMap.get(s.categoryId) || "其他";
              return (
                <SkillCardShell key={s.id} className="group relative">
                  <div className="flex items-start gap-2.5">
                    <span className="text-xl leading-none" aria-hidden>
                      {s.fromNl ? "✨" : "📁"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[0.9rem] font-semibold text-[var(--os-text)]">{displayTitle}</h3>
                    </div>
                    <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--os-text-muted)_10%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--os-text-muted)]">
                      {badgeLabel}
                    </span>
                  </div>
                  <p
                    className="mt-2 flex-1 cursor-default whitespace-pre-wrap text-[0.78rem] leading-snug text-[var(--os-text-muted)]"
                    title={s.description ? s.description : undefined}
                  >
                    {s.description || t("skillsPage.noDescription")}
                  </p>
                  {s.localPath ? (
                    <p className="mt-1 truncate font-mono text-[0.68rem] text-[var(--os-text-faint)]" title={s.localPath}>
                      {s.localPath}
                    </p>
                  ) : null}
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-x-0 bottom-0 z-[1] opacity-0 transition-opacity duration-200 ease-in-out",
                      "group-hover:opacity-100 group-focus-within:opacity-100",
                    )}
                    aria-hidden
                  >
                    <div className="h-14 bg-gradient-to-b from-transparent to-[var(--os-bg-elevated)]" />
                    <div className="-mt-1 flex items-center justify-end gap-2 px-3.5 pb-3.5">
                      {canOpenUserFolder ? (
                        <div className="pointer-events-auto">
                          <Button
                            type="button"
                            variant="outline"
                            size="small"
                            icon={<FolderIcon />}
                            onClick={() => openSkillFolder({ kind: "user", localPath: s.localPath })}
                          >
                            {t("skillsPage.openFolder")}
                          </Button>
                        </div>
                      ) : null}
                      <div className="pointer-events-auto">
                        <Button
                          type="button"
                          theme="danger"
                          variant="text"
                          size="small"
                          onClick={() => removeUserSkill(s.id)}
                        >
                          {t("skillsPage.delete")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </SkillCardShell>
              );
            })}
          </div>
        )}
      </div>

      {uploadOpen ? (
        <Modal onClose={() => { setUploadOpen(false); resetUploadForm(); }} labelledBy={uploadTitleId}>
          <div className="flex w-full min-w-[min(100vw-2rem,440px)] flex-col bg-[var(--os-bg-modal)]">
            <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <h2 id={uploadTitleId} className="text-base font-semibold">
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
                  {uploadCategoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
              <Button
                type="button"
                variant="text"
                onClick={() => {
                  setUploadOpen(false);
                  resetUploadForm();
                }}
              >
                {t("skillsPage.cancel")}
              </Button>
              <Button type="button" theme="primary" onClick={onConfirmUpload}>
                {t("skillsPage.upload.confirm")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {addCategoryOpen ? (
        <Modal onClose={() => setAddCategoryOpen(false)} labelledBy={addCategoryTitleId} width="360px">
          <div className="flex w-full flex-col bg-[var(--os-bg-modal)]">
            <div className="flex items-center justify-between px-3 py-2">
              <h2 id={addCategoryTitleId} className="text-sm font-semibold">新增分类</h2>
              <ModalCloseButton onClick={() => setAddCategoryOpen(false)} />
            </div>
            <div className="px-3 pb-2">
              <TextField
                value={newCategoryLabel}
                onChange={(e) => setNewCategoryLabel(e.target.value)}
                placeholder="输入分类名称"
              />
            </div>
            <div className="flex justify-end gap-2 px-3 pb-3">
              <Button type="button" variant="text" onClick={() => setAddCategoryOpen(false)}>
                {t("skillsPage.cancel")}
              </Button>
              <Button type="button" theme="primary" disabled={!newCategoryLabel.trim()} onClick={onConfirmAddCategory}>
                确认
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
