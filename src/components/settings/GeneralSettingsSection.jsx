import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { isLocaleId } from "../../i18n/messages.js";
import { BUILTIN_BRAND_PRESETS } from "../../theme/brandColor.js";
import themeMode1 from "../../assets/images/thememode1.png";
import themeMode2 from "../../assets/images/thememode2.png";
import themeMode3 from "../../assets/images/thememode3.png";
import { Check } from "lucide-react";
import { ColorPicker, RadioGroup, Typography } from "tdesign-react";
import "tdesign-react/es/color-picker/style/index.css";
import "tdesign-react/es/radio/style/index.css";
import { cn } from "../../ui/cn.js";

const SETTINGS_COLOR_PICKER_POPUP = { attach: () => document.body, zIndex: 2600 };

/**
 * ColorPicker preview updates immediately; theme commits on mouseup or popup close.
 *
 * @param {{ value: string; onCommit: (value: string) => void; className?: string }} props
 */
function DeferredThemeColorPicker({ value, onCommit, className }) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const draftRef = useRef(value);
  const committedRef = useRef(value);

  useEffect(() => {
    if (!open) {
      setDraft(value);
      draftRef.current = value;
      committedRef.current = value;
    }
  }, [value, open]);

  const commitDraft = useCallback(() => {
    const next = draftRef.current;
    if (typeof next !== "string" || !next.trim() || next === committedRef.current) return;
    committedRef.current = next;
    onCommit(next);
  }, [onCommit]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseUp = () => commitDraft();
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [open, commitDraft]);

  return (
    <ColorPicker
      borderless
      format="HEX"
      colorModes={["monochrome"]}
      value={draft}
      onChange={(next) => {
        if (typeof next !== "string" || !next.trim()) return;
        setDraft(next);
        draftRef.current = next;
      }}
      popupProps={{
        ...SETTINGS_COLOR_PICKER_POPUP,
        visible: open,
        onVisibleChange: (visible) => {
          setOpen(visible);
          if (!visible) commitDraft();
        },
      }}
      className={className}
    />
  );
}

/**
 * @param {{ title: import("react").ReactNode; description?: string; children: import("react").ReactNode; stacked?: boolean }} props
 */
function GeneralSettingRow({ title, description, children, stacked = false }) {
  return (
    <div className={cn("general-setting-row", stacked && "general-setting-row--stacked")}>
      <div className="general-setting-row__label general-setting-row__label--heading">
        <Typography.Text className="general-setting-row__label-text">{title}</Typography.Text>
        {description ? <span className="general-setting-row__description">{description}</span> : null}
      </div>
      <div
        className={cn(
          "general-setting-row__control",
          stacked && "general-setting-row__control--full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function AppearanceModeCards({ preference, onChange, t }) {
  const modes = [
    { value: "light", image: themeMode1 },
    { value: "dark", image: themeMode2 },
    { value: "system", image: themeMode3 },
  ];

  return (
    <div className="appearance-mode-cards" role="radiogroup" aria-label={t("settings.appearanceAria")}>
      {modes.map(({ value, image }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            className={cn("appearance-mode-card", selected && "appearance-mode-card--selected")}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(value)}
          >
            <span className={cn("appearance-mode-card__preview", `appearance-mode-card__preview--${value}`)}>
              <img src={image} alt="" draggable="false" />
              {selected ? <Check className="appearance-mode-card__check" size={10} strokeWidth={3} aria-hidden="true" /> : null}
            </span>
            <span className="appearance-mode-card__name">{t(`settings.appearanceMode.${value}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Appearance, theme color, and language settings. */
export default function GeneralSettingsSection() {
  const {
    themePreference,
    setTheme,
    brandColor,
    setBrandColorPreset,
    setCustomBrandColor,
    brandPrimary,
  } = useTheme();
  const { t, locale, setLocale } = useI18n();

  const languageOptions = useMemo(
    () => [
      { value: "zh-CN", label: `🇨🇳 ${t("settings.lang.zhCN")}` },
      { value: "zh-TW", label: `🇹🇼 ${t("settings.lang.zhTW")}` },
      { value: "en", label: `🇺🇸 ${t("settings.lang.en")}` },
      { value: "ja", label: `🇯🇵 ${t("settings.lang.ja")}` },
    ],
    [t],
  );

  return (
    <div className="general-settings w-full">
        <GeneralSettingRow
          title={t("settings.appearanceAria")}
          description={t("settings.appearanceHint")}
          stacked
        >
          <AppearanceModeCards preference={themePreference} onChange={setTheme} t={t} />
        </GeneralSettingRow>

        <GeneralSettingRow
          title={t("settings.themeColorShort")}
          description={t("settings.themeColorHint")}
          stacked
        >
          <div className="theme-color-picker" role="group" aria-label={t("settings.themeColorAria")}>
            <div className="theme-color-picker__presets">
              {BUILTIN_BRAND_PRESETS.map((preset) => {
                const selected = brandColor.type === "preset" && brandColor.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="theme-color-option"
                    aria-label={t(`settings.themeColorPresets.${preset.id}`)}
                    aria-pressed={selected}
                    onClick={() => setBrandColorPreset(preset.id)}
                  >
                    <span
                      className={cn(
                        "theme-color-card",
                        `theme-color-card--${preset.id}`,
                        selected && "theme-color-card--selected",
                      )}
                    >
                      {selected ? <Check className="theme-color-card__check" size={14} strokeWidth={3} aria-hidden="true" /> : null}
                    </span>
                    <span className="theme-color-option__label">
                      {t(`settings.themeColorPresets.${preset.id}`)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="theme-color-picker__custom">
              <div className="theme-color-picker__custom-copy">
                <span className="theme-color-picker__custom-hint">
                  {t("settings.themeColorCustomHint")}
                </span>
              </div>
              <div className="theme-color-picker__input">
                <DeferredThemeColorPicker
                  value={brandColor.type === "custom" ? brandColor.color : brandPrimary}
                  onCommit={setCustomBrandColor}
                />
              </div>
            </div>
          </div>
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.languageShort")}>
          <RadioGroup
            id="settings-language"
            value={locale}
            onChange={(v) => isLocaleId(v) && setLocale(v)}
            options={languageOptions}
            theme="button"
            variant="outline"
          />
        </GeneralSettingRow>

    </div>
  );
}
