import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { useMotionPreference } from "../../context/MotionPreferenceContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { isLocaleId } from "../../i18n/messages.js";
import {
  normalizeLinkOpenMode,
  readLinkOpenModeLocal,
  writeLinkOpenModeLocal,
} from "../../chat/chatLabLinkOpenPreference.js";
import { BUILTIN_BRAND_PRESETS } from "../../theme/brandColor.js";
import themeMode1 from "../../assets/images/thememode1.png";
import themeMode2 from "../../assets/images/thememode2.png";
import themeMode3 from "../../assets/images/thememode3.png";
import { Check } from "lucide-react";
import { ColorPicker, Input, Select as TSelect, Switch, Typography } from "tdesign-react";
import "tdesign-react/es/color-picker/style/index.css";
import { cn } from "../../ui/cn.js";

const SETTINGS_SELECT_POPUP = { attach: () => document.body, zIndex: 2600 };
const SETTINGS_COLOR_PICKER_POPUP = { attach: () => document.body, zIndex: 2600 };
const BROWSER_AUTOMATION_MAX_STEPS_DEFAULT = 20;
const BROWSER_AUTOMATION_MAX_STEPS_MIN = 1;
const BROWSER_AUTOMATION_MAX_STEPS_MAX = 100;

function normalizeBrowserAutomationMaxSteps(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return BROWSER_AUTOMATION_MAX_STEPS_DEFAULT;
  return Math.min(BROWSER_AUTOMATION_MAX_STEPS_MAX, Math.max(BROWSER_AUTOMATION_MAX_STEPS_MIN, Math.floor(n)));
}

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
 * @param {{ title: string; description?: string; children: import("react").ReactNode; stacked?: boolean }} props
 */
function GeneralSettingRow({ title, description, children, stacked = false }) {
  return (
    <div className={cn("general-setting-row", stacked && "general-setting-row--stacked")}>
      <div className="general-setting-row__label">
        <Typography.Text>{title}</Typography.Text>
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

/** Appearance + language + ChatLab title automation. */
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
  const { mode: uiMotion, setMode: setUiMotion } = useMotionPreference();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [chatLabAutoTitle, setChatLabAutoTitle] = useState(false);
  const [chatLabGroupContinuousConversation, setChatLabGroupContinuousConversation] = useState(true);
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);
  const [browserAutomationMaxSteps, setBrowserAutomationMaxSteps] = useState(
    BROWSER_AUTOMATION_MAX_STEPS_DEFAULT,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
          setChatLabGroupContinuousConversation(
            typeof c.chatLabGroupContinuousConversation === "boolean"
              ? c.chatLabGroupContinuousConversation
              : true,
          );
          setBrowserAutomationMaxSteps(
            normalizeBrowserAutomationMaxSteps(c.chatLabBrowserAutomationMaxSteps),
          );
          if (c.chatLabLinkOpenMode === "external" || c.chatLabLinkOpenMode === "sidebar") {
            const mode = normalizeLinkOpenMode(c.chatLabLinkOpenMode);
            setLinkOpenMode(mode);
            writeLinkOpenModeLocal(mode);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const persistChatLabAutoTitle = async (next) => {
    setChatLabAutoTitle(next);
    try {
      await bridge?.setUserConfig?.({ chatLabAutoTitle: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
      } catch {
        setChatLabAutoTitle(false);
      }
    }
  };

  const persistChatLabGroupContinuousConversation = async (next) => {
    setChatLabGroupContinuousConversation(next);
    try {
      await bridge?.setUserConfig?.({ chatLabGroupContinuousConversation: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") {
          setChatLabGroupContinuousConversation(
            typeof c.chatLabGroupContinuousConversation === "boolean"
              ? c.chatLabGroupContinuousConversation
              : true,
          );
        }
      } catch {
        setChatLabGroupContinuousConversation(true);
      }
    }
  };

  const persistLinkOpenMode = async (next) => {
    const mode = normalizeLinkOpenMode(next);
    setLinkOpenMode(mode);
    writeLinkOpenModeLocal(mode);
    try {
      await bridge?.setUserConfig?.({ chatLabLinkOpenMode: mode });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object" && (c.chatLabLinkOpenMode === "external" || c.chatLabLinkOpenMode === "sidebar")) {
          const restored = normalizeLinkOpenMode(c.chatLabLinkOpenMode);
          setLinkOpenMode(restored);
          writeLinkOpenModeLocal(restored);
        }
      } catch {
        setLinkOpenMode(readLinkOpenModeLocal());
      }
    }
  };

  const persistBrowserAutomationMaxSteps = async (next) => {
    const value = normalizeBrowserAutomationMaxSteps(next);
    setBrowserAutomationMaxSteps(value);
    try {
      await bridge?.setUserConfig?.({ chatLabBrowserAutomationMaxSteps: value });
      window.dispatchEvent(
        new CustomEvent("openstudio-chatlab-browser-automation-max-steps", {
          detail: { maxSteps: value },
        }),
      );
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") {
          setBrowserAutomationMaxSteps(
            normalizeBrowserAutomationMaxSteps(c.chatLabBrowserAutomationMaxSteps),
          );
        }
      } catch {
        setBrowserAutomationMaxSteps(BROWSER_AUTOMATION_MAX_STEPS_DEFAULT);
      }
    }
  };

  const languageOptions = useMemo(
    () => [
      { value: "zh-CN", label: t("settings.lang.zhCN") },
      { value: "zh-TW", label: t("settings.lang.zhTW") },
      { value: "en", label: t("settings.lang.en") },
      { value: "ja", label: t("settings.lang.ja") },
    ],
    [t],
  );

  const uiMotionOptions = useMemo(
    () => [
      { value: "full", label: t("settings.uiMotion.full") },
      { value: "system", label: t("settings.uiMotion.system") },
      { value: "reduced", label: t("settings.uiMotion.reduced") },
    ],
    [t],
  );

  const linkOpenModeOptions = useMemo(
    () => [
      { value: "sidebar", label: t("settings.linkOpenMode.sidebar") },
      { value: "external", label: t("settings.linkOpenMode.external") },
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

        <GeneralSettingRow title={t("settings.themeColorShort")} stacked>
          <div className="theme-color-picker" role="group" aria-label={t("settings.themeColorAria")}>
            <div className="theme-color-picker__presets">
              {BUILTIN_BRAND_PRESETS.map((preset) => {
                const selected = brandColor.type === "preset" && brandColor.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn("theme-color-card", selected && "theme-color-card--selected")}
                    style={{ backgroundColor: preset.color }}
                    aria-label={t(`settings.themeColorPresets.${preset.id}`)}
                    aria-pressed={selected}
                    onClick={() => setBrandColorPreset(preset.id)}
                  />
                );
              })}
            </div>
            <div className="theme-color-picker__custom">
              <span className="theme-color-picker__custom-label">{t("settings.themeColorCustom")}</span>
              <DeferredThemeColorPicker
                value={brandColor.type === "custom" ? brandColor.color : brandPrimary}
                onCommit={setCustomBrandColor}
                className="theme-color-picker__input"
              />
            </div>
          </div>
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.languageShort")}>
          <TSelect
            id="settings-language"
            borderless
            value={locale}
            onChange={(v) => isLocaleId(v) && setLocale(v)}
            options={languageOptions}
            popupProps={SETTINGS_SELECT_POPUP}
            className="settings-select"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.uiMotionShort")}>
          <TSelect
            id="settings-ui-motion"
            borderless
            value={uiMotion}
            onChange={(v) => {
              if (v === "full" || v === "system" || v === "reduced") setUiMotion(v);
            }}
            options={uiMotionOptions}
            popupProps={SETTINGS_SELECT_POPUP}
            className="settings-select"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.linkOpenModeShort")}>
          <TSelect
            id="settings-link-open-mode"
            borderless
            value={linkOpenMode}
            onChange={(v) => void persistLinkOpenMode(v)}
            options={linkOpenModeOptions}
            popupProps={SETTINGS_SELECT_POPUP}
            className="settings-select"
          />
        </GeneralSettingRow>

        <GeneralSettingRow
          title={t("settings.browserAutomationMaxSteps")}
        >
          <Input
            id="settings-browser-automation-max-steps"
            type="number"
            min={BROWSER_AUTOMATION_MAX_STEPS_MIN}
            max={BROWSER_AUTOMATION_MAX_STEPS_MAX}
            value={String(browserAutomationMaxSteps)}
            onChange={(value) => {
              const n = Number.parseInt(String(value ?? ""), 10);
              if (Number.isFinite(n)) setBrowserAutomationMaxSteps(normalizeBrowserAutomationMaxSteps(n));
            }}
            onBlur={() => void persistBrowserAutomationMaxSteps(browserAutomationMaxSteps)}
            className="settings-number-input"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.autoSummarize")}>
          <Switch
            id="settings-auto-summarize"
            aria-label={t("settings.autoSummarizeTitle")}
            value={chatLabAutoTitle}
            onChange={(v) => void persistChatLabAutoTitle(Boolean(v))}
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.groupContinuousConversation")}>
          <Switch
            id="settings-group-continuous-conversation"
            aria-label={t("settings.groupContinuousConversationAria")}
            value={chatLabGroupContinuousConversation}
            onChange={(v) => void persistChatLabGroupContinuousConversation(Boolean(v))}
          />
        </GeneralSettingRow>
    </div>
  );
}
