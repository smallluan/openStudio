import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { SettingsCell, SettingsCellRow } from "../components/settings/SettingsCells.jsx";
import FluidNavMenu from "../components/shell/FluidNavMenu.jsx";
import ModelAdvancedPanel from "../components/shell/ModelAdvancedPanel.jsx";
import ModelProfilesPanel from "../components/shell/ModelProfilesPanel.jsx";
import { ModelSettingsProvider } from "../context/ModelSettingsContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { isLocaleId } from "../i18n/messages.js";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import Select from "../ui/Select.jsx";
import Switch from "../ui/Switch.jsx";
import { cn } from "../ui/cn.js";

const SECTION_IDS = /** @type {const} */ ([
  "general",
  "usage",
  "skills",
  "remote",
  "model",
  "modelAdvanced",
  "about",
]);

export default function SettingsPage() {
  const { onClose } = useOutletContext() ?? {};
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const [section, setSection] = useState(/** @type {(typeof SECTION_IDS)[number]} */ ("general"));
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [chatLabAutoTitle, setChatLabAutoTitle] = useState(false);

  useEffect(() => {
    if (section !== "general") return;
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
  }, [bridge, section]);

  const persistChatLabAutoTitle = async (next) => {
    setChatLabAutoTitle(next);
    try {
      await bridge?.setUserConfig?.({ chatLabAutoTitle: next });
    } catch {
      /* revert on failure */
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

  const settingsNavItems = useMemo(
    () => SECTION_IDS.map((id) => ({ id, label: t(`settings.sections.${id}`) })),
    [t],
  );

  const sectionTitle =
    SECTION_IDS.includes(section) ? t(`settings.sections.${section}`) : t("settings.title");

  const modelSection = section === "model" || section === "modelAdvanced";

  return (
    <ModelSettingsProvider>
      <div className="flex h-[min(560px,78vh)] w-full max-w-full min-h-0 flex-col overflow-hidden sm:h-[min(640px,82vh)] sm:flex-row">
        <aside className="settings-sheet__aside flex h-full min-h-0 shrink-0 flex-col sm:w-[212px]">
          <div className="flex h-full min-h-0 flex-col gap-3 px-2 py-4 sm:px-3">
            <p className="hidden px-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--os-text-faint)] sm:block">
              {t("settings.title")}
            </p>
            <FluidNavMenu
              router={false}
              selectedId={section}
              onSelect={(id) => setSection(id)}
              primaryItems={settingsNavItems}
              primaryTrackClassName="flex gap-1 overflow-x-auto pb-1 sm:flex-col sm:gap-2 sm:overflow-visible sm:pb-0"
              className="sm:flex-1 sm:min-h-0"
            />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <h1 id="settings-modal-title" className="truncate text-lg font-semibold tracking-tight">
                {sectionTitle}
              </h1>
            </div>
            <ModalCloseButton onClick={onClose} aria-label={t("settings.closeAria")} />
          </header>

          <div
            className={cn(
              "min-h-0 flex-1",
              modelSection ? "flex flex-col overflow-hidden px-5 pb-4 pt-2" : "overflow-y-auto overscroll-contain px-5 py-5",
            )}
          >
            {section === "general" ? (
              <div className="mx-auto flex max-w-xl flex-col gap-6">
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
                      id="theme-appearance"
                      ariaLabel={t("settings.appearanceAria")}
                      value={theme}
                      onChange={(v) => setTheme(v)}
                      options={themeOptions}
                    />
                  </SettingsCell>
                  <SettingsCell label={t("settings.language")}>
                    <Select
                      id="app-language"
                      ariaLabel={t("settings.languageAria")}
                      value={locale}
                      onChange={(v) => isLocaleId(v) && setLocale(v)}
                      options={languageOptions}
                    />
                  </SettingsCell>
                </SettingsCellRow>

                <div className="rounded-xl border border-[var(--os-border)] px-3">
                  <Switch
                    id="sw-auto-chat-title"
                    label={t("settings.autoSummarizeTitle")}
                    checked={chatLabAutoTitle}
                    onCheckedChange={(v) => void persistChatLabAutoTitle(v)}
                  />
                </div>
              </div>
            ) : null}

            {section === "model" ?
              <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,52rem)] flex-1 flex-col">
                <ModelProfilesPanel />
              </div>
            : null}

            {section === "modelAdvanced" ?
              <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,52rem)] flex-1 flex-col">
                <ModelAdvancedPanel />
              </div>
            : null}

            {section !== "general" && !modelSection ?
              <div className="mx-auto max-w-xl rounded-xl border border-dashed border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-8 text-center text-[0.875rem] text-[var(--os-text-muted)]">
                {t("settings.sectionBuilding", {
                  label: t(`settings.sections.${section}`),
                })}
              </div>
            : null}
          </div>
        </div>
      </div>
    </ModelSettingsProvider>
  );
}
