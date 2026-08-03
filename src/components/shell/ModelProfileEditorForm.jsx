import { Select as TSelect } from "tdesign-react";
import TextField from "../../ui/TextField.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { useModelSettings } from "../../context/ModelSettingsContext.jsx";
import { osPopupAttach } from "../../ui/osPopupShared.js";

/**
 * @param {{
 *   profile: import("../../context/ModelSettingsContext.jsx").ModelProfileDraft;
 *   mode: "add" | "edit";
 *   hasKey: boolean;
 *   apiKey: string;
 *   onChange: (patch: Partial<import("../../context/ModelSettingsContext.jsx").ModelProfileDraft>) => void;
 *   onApiKeyChange: (key: string) => void;
 * }} props
 */
export default function ModelProfileEditorForm({ profile, mode, hasKey, apiKey, onChange, onApiKeyChange }) {
  const { t } = useI18n();
  const { MODEL_PROVIDER_IDS, providerOptionsWithUnset } = useModelSettings();

  return (
    <div className="flex flex-col gap-3.5 py-1">
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-[var(--os-text-muted)]">{t("userConfig.profileLabel")}</span>
        <TextField
          value={profile.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={t("userConfig.profileLabelPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-[var(--os-text-muted)]">{t("userConfig.provider")}</span>
        <TSelect
          id={`model-provider-${profile.id}`}
          value={profile.provider}
          onChange={(v) =>
            MODEL_PROVIDER_IDS.includes(/** @type {*} */ (v)) ?
              onChange({
                provider: /** @type {(typeof MODEL_PROVIDER_IDS)[number]} */ (v),
                minimaxRegion: v === "minimax" ? profile.minimaxRegion || "cn" : "",
              })
            : onChange({ provider: "", minimaxRegion: "" })
          }
          options={providerOptionsWithUnset}
          placeholder={t("userConfig.providerUnsetOption")}
          popupProps={{
            attach: osPopupAttach,
            placement: "bottom-start",
            zIndex: 2700,
          }}
          className="model-profile-editor__select w-full"
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-[var(--os-text-muted)]">{t("userConfig.modelId")}</span>
        <TextField
          value={profile.modelId ?? ""}
          onChange={(e) => onChange({ modelId: e.target.value })}
          placeholder={t("userConfig.modelIdPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {profile.provider === "minimax" ?
        <div className="flex flex-col gap-1">
          <span className="text-[0.75rem] text-[var(--os-text-muted)]">{t("userConfig.minimaxRegion")}</span>
          <TSelect
            id={`model-minimax-region-${profile.id}`}
            value={profile.minimaxRegion === "intl" ? "intl" : "cn"}
            onChange={(v) => onChange({ minimaxRegion: v === "intl" ? "intl" : "cn" })}
            options={[
              { value: "cn", label: t("userConfig.minimaxRegionOptions.cn") },
              { value: "intl", label: t("userConfig.minimaxRegionOptions.intl") },
            ]}
            popupProps={{
              attach: osPopupAttach,
              placement: "bottom-start",
              zIndex: 2700,
            }}
            className="model-profile-editor__select w-full"
          />
        </div>
      : null}

      {profile.provider === "openai-compatible" || profile.provider === "anthropic-compatible" ?
        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem] text-[var(--os-text-muted)]">{t("userConfig.baseUrl")}</span>
          <TextField
            value={profile.baseUrl ?? ""}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder={t("userConfig.baseUrlPlaceholder")}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      : null}

      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] text-[var(--os-text-muted)]">
          {t("userConfig.apiKey")}
          {mode === "edit" && profile.hasApiKey && !apiKey.trim() ? ` ${t("userConfig.apiKeySavedSuffix")}` : ""}
        </span>
        <TextField
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={t("userConfig.apiKeyPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </div>
  );
}
