import EmptyState from "../../ui/EmptyState.jsx";
import Select from "../../ui/Select.jsx";
import Switch from "../../ui/Switch.jsx";
import TextField from "../../ui/TextField.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { modelProfileSummaryLine, useModelSettings } from "../../context/ModelSettingsContext.jsx";
import { cn } from "../../ui/cn.js";
import ModelSettingsFooter from "./ModelSettingsFooter.jsx";

function IconTrashSmall({ className }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className={cn("shrink-0 text-current", className)}
      aria-hidden
    >
      <path
        d="M6 6.5v5M10 6.5v5M2.5 4h11M13 4l-.652 9.13a1 1 0 01-.992.87H4.644a1 1 0 01-.992-.87L3 4m2.75 0V3a2 2 0 012-2h2.5a2 2 0 012 2v1"
        stroke="currentColor"
        strokeWidth="1.22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ModelProfilesPanel() {
  const { t } = useI18n();
  const {
    MODEL_PROVIDER_IDS,
    profiles,
    selectedId,
    setSelectedId,
    activeId,
    enabledIds,
    setDefaultProfile,
    selectedProfile,
    apiKey,
    setApiKey,
    hasKey,
    providerOptionsWithUnset,
    patchSelected,
    addProfile,
    removeProfile,
    toggleActiveSwitch,
    clearFeedback,
  } = useModelSettings();

  /** @returns {import("react").ReactElement} */
  function profilesListInner() {
    if (profiles.length === 0) {
      return (
        <EmptyState
          hideDecoration
          title={t("userConfig.emptyStateNoProfiles")}
          action={
            <button type="button" className="btn-primary px-4 py-2 text-[0.8125rem]" onClick={addProfile}>
              {t("userConfig.addProfile")}
            </button>
          }
        />
      );
    }

    return (
      <div className="flex flex-col gap-1.5">
        {profiles.map((p) => (
          <div
            key={p.id}
            className={cn(
              "flex min-w-0 gap-1.5 rounded-lg border px-2 py-1.5 transition-[border-color,box-shadow]",
              selectedId === p.id ?
                "border-[color-mix(in_srgb,var(--os-accent)_55%,var(--os-border))] bg-[color-mix(in_srgb,var(--os-accent-muted)_18%,transparent)]"
              : "border-[var(--os-border)] bg-[var(--os-bg-elevated)]",
              activeId === p.id ?
                "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--os-accent)_32%,transparent)]"
              : null,
            )}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedId(p.id);
                clearFeedback();
              }}
              className={cn(
                "min-w-0 flex-1 truncate rounded-md border-none bg-transparent py-1 pl-1.5 pr-1 text-left text-[0.8125rem] font-medium outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--os-bg-hover)_80%,transparent)]",
                "focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
              )}
            >
              <span className="block truncate">{p.label.trim() ? p.label.trim() : modelProfileSummaryLine(p, t)}</span>
              {p.label.trim() ?
                <span className="mt-0.5 block truncate text-[0.6875rem] font-normal text-[var(--os-text-faint)]">
                  {modelProfileSummaryLine(p, t)}
                </span>
              : null}
            </button>
            <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 border-l border-[color-mix(in_srgb,var(--os-border)_85%,transparent)] pl-1.5">
              <div className="-my-px" onMouseDown={(e) => e.preventDefault()}>
                <Switch
                  compact
                  label={t("userConfig.enabledAria")}
                  checked={enabledIds.includes(p.id)}
                  onCheckedChange={(v) => toggleActiveSwitch(p.id, v)}
                />
              </div>
              <button
                type="button"
                className={cn(
                  "min-w-[3.25rem] rounded-md border border-[var(--os-border)] px-1.5 py-0.5 text-[0.62rem] font-semibold",
                  activeId === p.id
                    ? "border-[color-mix(in_srgb,var(--os-accent)_40%,var(--os-border))] bg-[color-mix(in_srgb,var(--os-accent-muted)_26%,transparent)] text-[var(--os-accent)]"
                    : "text-[var(--os-text-faint)] hover:text-[var(--os-text)]",
                )}
                onClick={() => setDefaultProfile(p.id)}
                title={t("userConfig.defaultModel")}
                aria-label={t("userConfig.defaultModel")}
              >
                {activeId === p.id ? t("userConfig.defaultOn") : t("userConfig.defaultSet")}
              </button>
              <button
                type="button"
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border-none bg-transparent text-[var(--os-text-muted)] outline-none transition-colors",
                  "hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-accent)]",
                  "focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
                )}
                aria-label={t("userConfig.removeProfile")}
                title={t("userConfig.removeProfile")}
                onClick={() => removeProfile(p.id)}
              >
                <IconTrashSmall />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /** @returns {import("react").ReactNode} */
  function editorBody() {
    if (!selectedProfile || profiles.length === 0) {
      const noSelectionOnly = profiles.length > 0;
      return (
        <EmptyState
          illustration={
            noSelectionOnly ?
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 4v4m0 8v4M4 12h4m12 0h-4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
              </svg>
            : undefined
          }
          hideDecoration={!noSelectionOnly}
          title={
            profiles.length === 0 ? t("userConfig.emptyStateNoProfiles") : t("userConfig.emptyStateNoSelection")
          }
        />
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--os-border)_70%,transparent)] pb-2.5">
          <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--os-text-faint)]">
            {t("userConfig.profileDetailHeading")}
          </span>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border-none bg-transparent px-2 py-1 text-[0.75rem] font-medium text-[var(--os-text-muted)] outline-none",
              "hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-accent)] focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
            )}
            onClick={() => removeProfile(selectedProfile.id)}
          >
            <IconTrashSmall />
            {t("userConfig.removeProfile")}
          </button>
        </div>

        <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
          <span className="font-medium">{t("userConfig.profileLabel")}</span>
          <TextField
            value={selectedProfile.label ?? ""}
            onChange={(e) => patchSelected({ label: e.target.value })}
            placeholder={t("userConfig.profileLabelPlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
          <span className="font-medium">{t("userConfig.provider")}</span>
          <Select
            id={`model-provider-${selectedProfile.id}`}
            ariaLabel={t("userConfig.providerAria")}
            value={selectedProfile.provider}
            onChange={(v) =>
              MODEL_PROVIDER_IDS.includes(/** @type {*} */ (v)) ?
                patchSelected({
                  provider: /** @type {(typeof MODEL_PROVIDER_IDS)[number]} */ (v),
                })
              : patchSelected({ provider: "" })
            }
            options={providerOptionsWithUnset}
            className="min-w-0 self-start"
          />
        </div>

        <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
          <span className="font-medium">{t("userConfig.modelId")}</span>
          <TextField
            value={selectedProfile.modelId ?? ""}
            onChange={(e) => patchSelected({ modelId: e.target.value })}
            placeholder={t("userConfig.modelIdPlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {selectedProfile.provider === "openai-compatible" || selectedProfile.provider === "deepseek" ?
          <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
            <span className="font-medium">{t("userConfig.baseUrl")}</span>
            <TextField
              value={selectedProfile.baseUrl ?? ""}
              onChange={(e) => patchSelected({ baseUrl: e.target.value })}
              placeholder={t("userConfig.baseUrlPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        : null}

        <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--os-text-muted)]">
          <span className="font-medium">
            {t("userConfig.apiKey")}
            {hasKey ? ` ${t("userConfig.apiKeySavedSuffix")}` : ""}
          </span>
          <TextField
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("userConfig.apiKeyPlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,52rem)] flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--os-border)] bg-[color-mix(in_srgb,var(--os-bg-panel)_92%,transparent)]">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col divide-y divide-[var(--os-border)] overflow-hidden lg:flex-row lg:divide-x lg:divide-y-0">
          <aside className="flex max-h-[38vh] min-h-[10.5rem] min-w-0 shrink-0 flex-col gap-2 px-3 py-3 lg:max-h-none lg:h-auto lg:w-[13.25rem] lg:max-w-[36vw]">
            <span className="shrink-0 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--os-text-faint)]">
              {t("userConfig.providersColumnTitle")}
            </span>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">{profilesListInner()}</div>
            {profiles.length > 0 ?
              <button
                type="button"
                onClick={addProfile}
                className={cn(
                  "flex shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--os-border-strong)] bg-transparent py-2 text-[0.8125rem] font-medium text-[var(--os-text-muted)]",
                  "transition-[color,background,border-color] hover:border-[color-mix(in_srgb,var(--os-accent)_35%,var(--os-border-strong))] hover:bg-[var(--os-bg-hover)] hover:text-[var(--os-text)]",
                )}
              >
                <span aria-hidden className="text-[1rem] leading-none opacity-70">
                  +
                </span>
                {t("userConfig.addProfile")}
              </button>
            : null}
          </aside>
          <div className="flex min-h-[12rem] min-w-0 flex-1 flex-col px-3 py-3">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">{editorBody()}</div>
          </div>
        </div>
      </div>

      <ModelSettingsFooter />
    </div>
  );
}
