import { BarChart3, Cpu, KeyRound, Radio, Settings } from "lucide-react";
import { Menu } from "@open-studio/udesign";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import ChannelSettingsSection from "../components/settings/ChannelSettingsSection.jsx";
import GeneralSettingsSection from "../components/settings/GeneralSettingsSection.jsx";
import TokenUsageSettingsSection from "../components/settings/TokenUsageSettingsSection.jsx";
import WebAccountSettingsSection from "../components/settings/WebAccountSettingsSection.jsx";
import ModelProfilesPanel from "../components/shell/ModelProfilesPanel.jsx";
import { SETTINGS_SECTION_IDS } from "../components/settings/settingsSectionIds.js";
import { ModelSettingsProvider } from "../context/ModelSettingsContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import NavIcon from "../ui/NavIcon.jsx";
import { cn } from "../ui/cn.js";

const SETTINGS_SECTION_ICONS = {
  general: Settings,
  accounts: KeyRound,
  channels: Radio,
  usage: BarChart3,
  model: Cpu,
};

export default function SettingsPage() {
  const { onClose } = useOutletContext() ?? {};
  const { t } = useI18n();
  const { theme } = useTheme();
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
  const accountsSection = section === "accounts";

  return (
    <ModelSettingsProvider>
      <div className="settings-sheet">
        <aside className="settings-sheet__aside">
          <Menu
            className="settings-sheet__menu"
            collapsed={false}
            width="100%"
            theme={theme === "dark" ? "dark" : "light"}
            value={section}
            onChange={(id) => setSection(id)}
          >
            {settingsNavItems.map((item) => (
              <Menu.MenuItem key={item.id} value={item.id} icon={item.icon}>
                {item.label}
              </Menu.MenuItem>
            ))}
          </Menu>
        </aside>

        <div className="settings-sheet__main">
          <header className="settings-sheet__header">
            <h1 id="settings-modal-title" className="sr-only">
              {sectionTitle}
            </h1>
            <ModalCloseButton onClick={onClose} aria-label={t("settings.closeAria")} />
          </header>

          <div
            className={cn(
              "settings-sheet__content",
              modelSection && "settings-sheet__content--model",
              accountsSection && "settings-sheet__content--accounts",
            )}
          >
            {section === "general" ? (
              <div className="settings-sheet__section">
                <GeneralSettingsSection />
              </div>
            ) : null}

            {section === "channels" ? (
              <div className="settings-sheet__section settings-sheet__section--narrow">
                <ChannelSettingsSection />
              </div>
            ) : null}

            {section === "accounts" ? (
              <div className="settings-sheet__section settings-sheet__section--accounts">
                <WebAccountSettingsSection />
              </div>
            ) : null}

            {section === "usage" ? (
              <div className="settings-sheet__section settings-sheet__section--wide">
                <TokenUsageSettingsSection />
              </div>
            ) : null}

            {section === "model" ? (
              <div className="settings-sheet__section settings-sheet__section--model">
                <ModelProfilesPanel />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ModelSettingsProvider>
  );
}
