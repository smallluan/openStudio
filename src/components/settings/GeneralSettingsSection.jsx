import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { useMotionPreference } from "../../context/MotionPreferenceContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { isLocaleId } from "../../i18n/messages.js";
import {
  normalizeLinkOpenMode,
  readLinkOpenModeLocal,
  writeLinkOpenModeLocal,
} from "../../chat/chatLabLinkOpenPreference.js";
import { Select as TSelect, Switch, Typography } from "tdesign-react";

const SETTINGS_SELECT_POPUP = { attach: () => document.body, zIndex: 2600 };

/**
 * @param {{ title: string; children: import("react").ReactNode; last?: boolean }} props
 */
function GeneralSettingRow({ title, children }) {
  return (
    <div className="general-setting-row">
      <Typography.Text className="general-setting-row__label">{title}</Typography.Text>
      <div className="general-setting-row__control">{children}</div>
    </div>
  );
}

/** Appearance + language + ChatLab title automation. */
export default function GeneralSettingsSection() {
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { mode: uiMotion, setMode: setUiMotion } = useMotionPreference();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [chatLabAutoTitle, setChatLabAutoTitle] = useState(false);
  const [rawTraceEnabled, setRawTraceEnabled] = useState(false);
  const [chatLabGroupContinuousConversation, setChatLabGroupContinuousConversation] = useState(true);
  const [showAutomationDebugInput, setShowAutomationDebugInput] = useState(false);
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
          setRawTraceEnabled(Boolean(c.chatLabRawTraceEnabled));
          setChatLabGroupContinuousConversation(
            typeof c.chatLabGroupContinuousConversation === "boolean"
              ? c.chatLabGroupContinuousConversation
              : true,
          );
          setShowAutomationDebugInput(Boolean(c.chatLabShowAutomationDebugInput));
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

  const persistRawTraceEnabled = async (next) => {
    setRawTraceEnabled(next);
    try {
      await bridge?.setUserConfig?.({ chatLabRawTraceEnabled: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") setRawTraceEnabled(Boolean(c.chatLabRawTraceEnabled));
      } catch {
        setRawTraceEnabled(false);
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

  const persistShowAutomationDebugInput = async (next) => {
    setShowAutomationDebugInput(next);
    try {
      await bridge?.setUserConfig?.({ chatLabShowAutomationDebugInput: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") setShowAutomationDebugInput(Boolean(c.chatLabShowAutomationDebugInput));
      } catch {
        setShowAutomationDebugInput(false);
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

        <GeneralSettingRow title={t("settings.rawTraceEnabled")}>
          <Switch
            id="settings-raw-trace"
            aria-label={t("settings.rawTraceEnabledTitle")}
            value={rawTraceEnabled}
            onChange={(v) => void persistRawTraceEnabled(Boolean(v))}
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

        <GeneralSettingRow title={t("settings.showAutomationDebugInput")}>
          <Switch
            id="settings-show-automation-debug-input"
            aria-label={t("settings.showAutomationDebugInputTitle")}
            value={showAutomationDebugInput}
            onChange={(v) => void persistShowAutomationDebugInput(Boolean(v))}
          />
        </GeneralSettingRow>
    </div>
  );
}
