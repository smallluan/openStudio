import { useCallback, useState } from "react";
import { Button, Switch } from "@open-studio/udesign";
import { Pencil, Trash2 } from "lucide-react";
import EmptyState from "../../ui/EmptyState.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import {
  emptyModelProfileDraft,
  isModelProfilePersistable,
  modelProfileSummaryLine,
  useModelSettings,
} from "../../context/ModelSettingsContext.jsx";
import { cn } from "../../ui/cn.js";
import ModelProfileEditorDialog from "./ModelProfileEditorDialog.jsx";
import ModelProfileEditorForm from "./ModelProfileEditorForm.jsx";

/**
 * @typedef {{
 *   mode: "add" | "edit";
 *   draft: import("../../context/ModelSettingsContext.jsx").ModelProfileDraft;
 *   apiKey: string;
 * }} EditorSession
 */

export default function ModelProfilesPanel() {
  const { t } = useI18n();
  const {
    profiles,
    enabledIds,
    hasKey,
    feedback,
    upsertProfile,
    removeProfile,
    toggleEnabled,
    clearFeedback,
  } = useModelSettings();

  const [editor, setEditor] = useState(/** @type {EditorSession | null} */ (null));
  const [editorError, setEditorError] = useState(/** @type {string | null} */ (null));
  const [saving, setSaving] = useState(false);

  const openAdd = useCallback(() => {
    clearFeedback();
    setEditorError(null);
    setEditor({ mode: "add", draft: emptyModelProfileDraft(), apiKey: "" });
  }, [clearFeedback]);

  const openEdit = useCallback(
    /** @param {string} id */
    (id) => {
      const p = profiles.find((row) => row.id === id);
      if (!p) return;
      clearFeedback();
      setEditorError(null);
      setEditor({
        mode: "edit",
        draft: { ...p },
        apiKey: "",
      });
    },
    [clearFeedback, profiles],
  );

  const closeEditor = useCallback(() => {
    if (saving) return;
    setEditor(null);
    setEditorError(null);
  }, [saving]);

  const patchDraft = useCallback(
    /** @param {Partial<import("../../context/ModelSettingsContext.jsx").ModelProfileDraft>} patch */
    (patch) => {
      setEditor((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur));
      setEditorError(null);
    },
    [],
  );

  const validateDraft = useCallback(
    /** @param {import("../../context/ModelSettingsContext.jsx").ModelProfileDraft} draft */
    (draft) => {
      if (!draft.provider) return t("userConfig.validationPickProvider");
      if (!String(draft.modelId ?? "").trim()) return t("userConfig.validationNeedModelId");
      if (!isModelProfilePersistable(draft)) return t("userConfig.validationPickProvider");
      return null;
    },
    [t],
  );

  const handleConfirm = useCallback(async () => {
    if (!editor || saving) return;
    const err = validateDraft(editor.draft);
    if (err) {
      setEditorError(err);
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      await upsertProfile(editor.draft, { apiKey: editor.apiKey });
      setEditor(null);
    } catch (e) {
      setEditorError(t("userConfig.saveFailed", { message: String(e?.message ?? e) }));
    } finally {
      setSaving(false);
    }
  }, [editor, saving, t, upsertProfile, validateDraft]);

  const handleDelete = useCallback(
    /** @param {string} id */
    (id) => {
      void removeProfile(id);
      if (editor?.draft.id === id) closeEditor();
    },
    [closeEditor, editor, removeProfile],
  );

  const editorTitle =
    editor?.mode === "add" ? t("userConfig.addProfile") : t("userConfig.profileDetailHeading");

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,32rem)] flex-1 flex-col">
      <div className="model-profiles-panel__head mb-1 flex shrink-0 items-center justify-between gap-3 pb-2">
        <span className="text-[0.8125rem] font-medium text-[var(--os-text)]">
          {t("userConfig.providersColumnTitle")}
        </span>
        <Button
          type="button"
          onClick={openAdd}
          className="border-none bg-transparent p-0 text-[0.75rem] font-medium text-[var(--os-text-muted)] underline-offset-2 hover:text-[var(--os-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]"
        >
          + {t("userConfig.addProfile")}
        </Button>
      </div>

      {feedback && !editor ?
        <p role="alert" className="mb-2 text-[0.72rem] leading-snug text-[var(--os-accent)]">
          {feedback.text}
        </p>
      : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {profiles.length === 0 ?
          <EmptyState
            hideDecoration
            title={t("userConfig.emptyStateNoProfiles")}
            action={
              <Button
                type="button"
                className="text-[0.8125rem] font-medium text-[var(--os-accent)] underline-offset-2 hover:underline"
                onClick={openAdd}
              >
                {t("userConfig.addProfile")}
              </Button>
            }
          />
        : <ul className="m-0 list-none p-0">
            {profiles.map((p) => {
              const isEnabled = enabledIds.includes(p.id);
              return (
                <li key={p.id} className="model-profiles-panel__row group flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8125rem] text-[var(--os-text)]">
                      {p.label.trim() ? p.label.trim() : modelProfileSummaryLine(p, t)}
                    </div>
                    {p.label.trim() ?
                      <div className="truncate text-[0.6875rem] text-[var(--os-text-faint)]">
                        {modelProfileSummaryLine(p, t)}
                      </div>
                    : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      type="button"
                      className={cn(
                        "flex size-7 items-center justify-center border-none bg-transparent text-[var(--os-text-muted)] outline-none",
                        "hover:text-[var(--os-text)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
                      )}
                      aria-label={t("userConfig.profileDetailHeading")}
                      title={t("userConfig.profileDetailHeading")}
                      onClick={() => openEdit(p.id)}
                    >
                      <Pencil size={14} strokeWidth={1.6} aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      className={cn(
                        "flex size-7 items-center justify-center border-none bg-transparent text-[var(--os-text-muted)] outline-none",
                        "hover:text-[var(--os-accent)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
                      )}
                      aria-label={t("userConfig.removeProfile")}
                      title={t("userConfig.removeProfile")}
                      onClick={() => handleDelete(p.id)}
                    >
                      <Trash2 size={14} strokeWidth={1.6} aria-hidden />
                    </Button>
                  </div>

                  <div className="shrink-0" onMouseDown={(e) => e.preventDefault()}>
                    <Switch
                      size="small"
                      aria-label={t("userConfig.enabledAria")}
                      value={isEnabled}
                      onChange={(v) => void toggleEnabled(p.id, Boolean(v))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        }
      </div>

      <ModelProfileEditorDialog
        open={Boolean(editor)}
        title={editorTitle}
        error={editorError}
        confirmDisabled={saving}
        onCancel={closeEditor}
        onConfirm={() => void handleConfirm()}
      >
        {editor ?
          <ModelProfileEditorForm
            profile={editor.draft}
            mode={editor.mode}
            hasKey={Boolean(editor.draft.hasApiKey)}
            apiKey={editor.apiKey}
            onChange={patchDraft}
            onApiKeyChange={(key) => {
              setEditor((cur) => (cur ? { ...cur, apiKey: key } : cur));
              setEditorError(null);
            }}
          />
        : null}
      </ModelProfileEditorDialog>
    </div>
  );
}
