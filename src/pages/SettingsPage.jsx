import { BarChart3, Cpu, Radio, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import ChannelSettingsSection from "../components/settings/ChannelSettingsSection.jsx";
import GeneralSettingsSection from "../components/settings/GeneralSettingsSection.jsx";
import TokenUsageSettingsSection from "../components/settings/TokenUsageSettingsSection.jsx";
import FluidNavMenu from "../components/shell/FluidNavMenu.jsx";
import ModelProfilesPanel from "../components/shell/ModelProfilesPanel.jsx";
import { SETTINGS_SECTION_IDS } from "../components/settings/settingsSectionIds.js";
import { ModelSettingsProvider } from "../context/ModelSettingsContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import NavIcon from "../ui/NavIcon.jsx";
import { cn } from "../ui/cn.js";

const SETTINGS_SECTION_ICONS = {
  general: Settings,
  channels: Radio,
  usage: BarChart3,
  model: Cpu,
};

export default function SettingsPage() {
  const { onClose } = useOutletContext() ?? {};
  const { t } = useI18n();
  const [section, setSection] = useState(/** @type {(typeof SETTINGS_SECTION_IDS)[number]} */ ("general"));

  const settingsNavItems = useMemo(
    () =>
      SETTINGS_SECTION_IDS.map((id) => {
        const Icon = SETTINGS_SECTION_ICONS[id] ?? Settings;
        return {
          id,
          label: t(`settings.sections.${id}`),
          icon: <NavIcon icon={Icon} />,
        };
      }),
    [t],
  );

  const sectionTitle =
    SETTINGS_SECTION_IDS.includes(section) ? t(`settings.sections.${section}`) : t("settings.title");

  const modelSection = section === "model";

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
          <header className="settings-sheet__header flex shrink-0 items-center justify-between gap-4 px-5 py-3.5">
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
              <div className="mx-auto flex w-full max-w-lg flex-col px-1 py-2 sm:px-2">
                <GeneralSettingsSection />
              </div>
            ) : null}

            {section === "channels" ? (
              <div className="mx-auto flex w-full max-w-lg flex-col px-1 py-2 sm:px-2">
                <ChannelSettingsSection />
              </div>
            ) : null}

            {section === "usage" ? (
              <div className="mx-auto flex w-full max-w-3xl flex-col px-1 py-2 sm:px-2">
                <TokenUsageSettingsSection />
              </div>
            ) : null}

            {section === "model" ? (
              <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,52rem)] flex-1 flex-col">
                <ModelProfilesPanel />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ModelSettingsProvider>
  );
}
