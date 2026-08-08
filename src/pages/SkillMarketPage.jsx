import { useCallback, useId, useMemo, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { Space, Tabs } from "tdesign-react";
import OsEmpty from "../ui/OsEmpty.jsx";
import { AddIcon, AppIcon, FolderIcon } from "tdesign-icons-react";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { filterUsableBundledSkills } from "../skills/skillAvailability.js";
import { userSkillDisplayTitle } from "../skills/skillDisplay.js";
import { parseSkillFrontmatter } from "../skills/skillFrontmatter.js";
import { BUILTIN_SKILL_DEFS } from "../skills/skillsCatalog.js";
import { OPENCLAW_BUNDLED_SKILLS, formatSkillTitle } from "../skills/skillRegistry.js";
import { useSkillEnvironment } from "../skills/useSkillEnvironment.js";
import { useSkillLibrary } from "../skills/useSkillLibrary.js";
import Modal from "../ui/Modal.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import FluidConfirmDialog from "../ui/FluidConfirmDialog.jsx";
import TextField from "../ui/TextField.jsx";
import { cn } from "../ui/cn.js";

const APP_BUILTIN_FILTER = "__app_builtin__";
const OPENCLAW_BUILTIN_FILTER = "__openclaw_builtin__";
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
  const addCategoryTitleId = useId();

  const [filterId, setFilterId] = useState(APP_BUILTIN_FILTER);
  const [query, setQuery] = useState("");

  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [uploadingSkill, setUploadingSkill] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

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
      { id: APP_BUILTIN_FILTER, label: t("skillsPage.filterAppBuiltin"), icon: <AppIcon /> },
      { id: OTHER_FILTER, label: t("skillsPage.filterLocalUpload"), icon: <FolderIcon /> },
      { id: OPENCLAW_BUILTIN_FILTER, label: t("skillsPage.filterOpenclawBuiltin"), icon: <AppIcon /> },
      ...lib.userCategories.map((c) => ({ id: c.id, label: c.label })),
    ];
  }, [lib.userCategories, t]);

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
      if (filterId !== OPENCLAW_BUILTIN_FILTER) return false;
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
      if (filterId === APP_BUILTIN_FILTER || filterId === OPENCLAW_BUILTIN_FILTER) return false;
      if (filterId !== categoryId) return false;
      const title = userSkillDisplayTitle(s);
      return matchesQuery(title, s.description);
    });
  }, [customCategoryMap, filterId, lib.userSkills, matchesQuery]);

  const shouldShowBuiltinLoading = skillEnv.loading && filterId === OPENCLAW_BUILTIN_FILTER;
  const visibleCount = filteredBuiltin.length + filteredUser.length;
  const shouldShowEmpty = !shouldShowBuiltinLoading && visibleCount === 0;

  const uploadSkillFromFolder = useCallback(async () => {
    if (uploadingSkill) return;
    const pickFolder = window.studioBridge?.pickWorkspaceFolder;
    if (!pickFolder) {
      window.alert(t("skillsPage.upload.chooseFolderFailed"));
      return;
    }
    setUploadingSkill(true);
    try {
      const result = await pickFolder();
      if (result?.canceled) return;
      if (!result?.ok || !result.path) {
        window.alert(t("skillsPage.upload.chooseFolderFailed"));
        return;
      }
      const localPath = String(result.path).trim();
      const readSkillFile = window.studioBridge?.readSkillFile;
      if (!readSkillFile) {
        window.alert(t("skillsPage.upload.metadataReadFailed"));
        return;
      }
      const fileResult = await readSkillFile({ kind: "user", localPath });
      if (!fileResult?.ok) {
        window.alert(t("skillsPage.upload.metadataReadFailed"));
        return;
      }
      const metadata = parseSkillFrontmatter(fileResult.content);
      const title = metadata.name.trim();
      const description = metadata.description.trim();
      if (!title || !description) {
        window.alert(t("skillsPage.upload.metadataRequired"));
        return;
      }
      addUserSkill({
        title,
        description,
        icon: metadata.icon,
        categoryId: OTHER_FILTER,
        localPath,
        fromNl: false,
      });
    } catch {
      window.alert(t("skillsPage.upload.metadataReadFailed"));
    } finally {
      setUploadingSkill(false);
    }
  }, [addUserSkill, t, uploadingSkill]);

  const requestRemoveUserSkill = useCallback((id) => {
    setPendingDeleteId(id);
    setDeleteConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    removeUserSkill(pendingDeleteId);
    setPendingDeleteId(null);
    setDeleteConfirmOpen(false);
  }, [pendingDeleteId, removeUserSkill]);

  const onAddCategory = useCallback(() => {
    setNewCategoryLabel("");
    setAddCategoryOpen(true);
  }, []);

  const onConfirmAddCategory = useCallback(() => {
    const label = newCategoryLabel.trim();
    if (!label) return;
    if (
      [
        t("skillsPage.filterAll"),
        t("skillsPage.filterAppBuiltin"),
        t("skillsPage.filterLocalUpload"),
        t("skillsPage.filterOpenclawBuiltin"),
        "全部",
        "内置",
        "其他",
      ].includes(label)
    ) {
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
  }, [addUserCategory, lib.userCategories, newCategoryLabel, t]);

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <div style={{ marginBottom: 16 }}>
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 auto", maxWidth: "calc(100% - 380px)" }}>
            <Space align="center" size={6}>
              <div style={{ minWidth: 0 }}>
                <Tabs
                  value={filterId}
                  list={categoryTabs.map((tab) => ({
                    value: tab.id,
                    label: tab.icon ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex text-[0.9em]" aria-hidden>
                          {tab.icon}
                        </span>
                        {tab.label}
                      </span>
                    ) : (
                      tab.label
                    ),
                  }))}
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
            <Button
              type="button"
              theme="primary"
              icon={<AddIcon />}
              disabled={uploadingSkill}
              onClick={uploadSkillFromFolder}
            >
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
          <OsEmpty
            description={
              filterId === APP_BUILTIN_FILTER
                ? t("skillsPage.emptyAppBuiltin")
                : filterId === OPENCLAW_BUILTIN_FILTER
                  ? t("skillsPage.emptyBuiltin")
                  : t("skillsPage.emptyUser")
            }
          />
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
              return (
                <SkillCardShell key={s.id} className="group relative">
                  <div className="flex items-start gap-2.5">
                    <span className="text-xl leading-none" aria-hidden>
                      {s.icon || (s.fromNl ? "✨" : "📁")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[0.9rem] font-semibold text-[var(--os-text)]">{displayTitle}</h3>
                    </div>
                  </div>
                  <p
                    className="mt-2 flex-1 cursor-default whitespace-pre-wrap text-[0.78rem] leading-snug text-[var(--os-text-muted)]"
                    title={s.description ? s.description : undefined}
                  >
                    {s.description || t("skillsPage.noDescription")}
                  </p>
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
                          onClick={() => requestRemoveUserSkill(s.id)}
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

      <FluidConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setPendingDeleteId(null);
        }}
        danger
        onConfirm={handleConfirmDelete}
      >
        {t("skillsPage.deleteConfirm")}
      </FluidConfirmDialog>

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
