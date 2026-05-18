import { useEffect, useMemo, useState } from "react";
import { SettingsCell, SettingsCellRow } from "./SettingsCells.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { isLocaleId } from "../../i18n/messages.js";
import Select from "../../ui/Select.jsx";
import Switch from "../../ui/Switch.jsx";

/** Appearance + language + ChatLab title automation (used by modal settings + rail popover). */
export default function GeneralSettingsSection() {
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [chatLabAutoTitle, setChatLabAutoTitle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4 rounded-xl border border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[var(--os-border)] bg-[var(--os-bg-elevated)] text-2xl"
          aria-hidden
        >
          🐾
        </div>
        <div className="min-w-0">
          <div className="text-[0.75rem] text-[var(--os-text-muted)]">{t("settings.avatar")}</div>
          <div className="truncate text-[0.9rem] font-medium">{t("settings.localAccount")}</div>
        </div>
      </div>

      <SettingsCellRow>
        <SettingsCell label={t("settings.appearance")}>
          <Select
            id="rail-theme-appearance"
            ariaLabel={t("settings.appearanceAria")}
            value={theme}
            onChange={(v) => setTheme(v)}
            options={themeOptions}
          />
        </SettingsCell>
        <SettingsCell label={t("settings.language")}>
          <Select
            id="rail-app-language"
            ariaLabel={t("settings.languageAria")}
            value={locale}
            onChange={(v) => isLocaleId(v) && setLocale(v)}
            options={languageOptions}
          />
        </SettingsCell>
      </SettingsCellRow>

      <div className="rounded-xl border border-[var(--os-border)] px-3">
        <Switch
          id="rail-sw-auto-chat-title"
          label={t("settings.autoSummarizeTitle")}
          checked={chatLabAutoTitle}
          onCheckedChange={(v) => void persistChatLabAutoTitle(v)}
        />
      </div>

      {bridge?.openLogsDirectory ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="rounded-full border border-[var(--os-border)] bg-[var(--os-bg-elevated)] px-4 py-2 text-sm font-medium text-[color:var(--os-text)] transition hover:bg-[var(--os-bg-subtle)]"
            aria-label={t("settings.openLogsAria")}
            onClick={() => void bridge.openLogsDirectory?.()}
          >
            {t("settings.openLogsFolder")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
