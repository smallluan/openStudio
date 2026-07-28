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
import { ColorPicker, Select as TSelect, Switch, Typography } from "tdesign-react";
import "tdesign-react/es/color-picker/style/index.css";
import { cn } from "../../ui/cn.js";

const SETTINGS_SELECT_POPUP = { attach: () => document.body, zIndex: 2600 };
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
 * @param {{ title: string; children: import("react").ReactNode; stacked?: boolean }} props
 */
function GeneralSettingRow({ title, children, stacked = false }) {
  return (
    <div className={cn("general-setting-row", stacked && "general-setting-row--stacked")}>
      <Typography.Text className="general-setting-row__label">{title}</Typography.Text>
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

/** Appearance + language + ChatLab title automation. */
export default function GeneralSettingsSection() {
  const { theme, setTheme, brandColor, setBrandColorPreset, setCustomBrandColor, brandPrimary } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { mode: uiMotion, setMode: setUiMotion } = useMotionPreference();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [chatLabAutoTitle, setChatLabAutoTitle] = useState(false);
  const [chatLabGroupContinuousConversation, setChatLabGroupContinuousConversation] = useState(true);
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);

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

  const themeOptions = useMemo(
    () => [
      { value: "light", label: t("settings.appearanceMode.light") },
      { value: "dark", label: t("settings.appearanceMode.dark") },
    ],
    [t],
  );

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
        <GeneralSettingRow title={t("settings.appearance")}>
          <TSelect
            id="settings-appearance"
            borderless
            value={theme}
            onChange={(v) => setTheme(v)}
            options={themeOptions}
            popupProps={SETTINGS_SELECT_POPUP}
            className="settings-select"
          />
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
