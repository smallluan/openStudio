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
import Select from "../../ui/Select.jsx";
import Switch from "../../ui/Switch.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{ title: string; children: import("react").ReactNode; last?: boolean }} props
 */
function GeneralSettingRow({ title, children, last = false }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5 sm:py-4",
        !last && "border-b border-[color-mix(in_srgb,var(--os-border)_72%,transparent)]",
      )}
    >
      <span className="min-w-0 shrink-0 text-[0.9375rem] font-semibold tracking-tight text-[var(--os-text)]">
        {title}
      </span>
      <div className="flex min-w-0 shrink-0 items-center justify-end">{children}</div>
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
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
          setRawTraceEnabled(Boolean(c.chatLabRawTraceEnabled));
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
    <div className="general-settings mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--os-border)_88%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_96%,var(--os-bg-subtle))] shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_8px_28px_rgba(15,23,42,0.04)]">
        <GeneralSettingRow title={t("settings.appearance")}>
          <Select
            id="settings-appearance"
            ariaLabel={t("settings.appearanceAria")}
            value={theme}
            onChange={(v) => setTheme(v)}
            options={themeOptions}
            className="min-w-[8.5rem]"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.languageShort")}>
          <Select
            id="settings-language"
            ariaLabel={t("settings.languageAria")}
            value={locale}
            onChange={(v) => isLocaleId(v) && setLocale(v)}
            options={languageOptions}
            className="min-w-[8.5rem]"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.uiMotionShort")}>
          <Select
            id="settings-ui-motion"
            ariaLabel={t("settings.uiMotionAria")}
            value={uiMotion}
            onChange={(v) => {
              if (v === "full" || v === "system" || v === "reduced") setUiMotion(v);
            }}
            options={uiMotionOptions}
            className="min-w-[8.5rem]"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.linkOpenModeShort")}>
          <Select
            id="settings-link-open-mode"
            ariaLabel={t("settings.linkOpenModeAria")}
            value={linkOpenMode}
            onChange={(v) => void persistLinkOpenMode(v)}
            options={linkOpenModeOptions}
            className="min-w-[8.5rem]"
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.rawTraceEnabled")}>
          <Switch
            compact
            id="settings-raw-trace"
            label={t("settings.rawTraceEnabledTitle")}
            checked={rawTraceEnabled}
            onCheckedChange={(v) => void persistRawTraceEnabled(v)}
          />
        </GeneralSettingRow>

        <GeneralSettingRow title={t("settings.autoSummarize")} last>
          <Switch
            compact
            id="settings-auto-summarize"
            label={t("settings.autoSummarizeTitle")}
            checked={chatLabAutoTitle}
            onCheckedChange={(v) => void persistChatLabAutoTitle(v)}
          />
        </GeneralSettingRow>
      </div>
    </div>
  );
}
