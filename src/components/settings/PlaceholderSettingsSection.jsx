import { useI18n } from "../../context/I18nContext.jsx";
import { isSettingsSectionId } from "./settingsSectionIds.js";

/** @param {{ sectionId: string }} props */
export default function PlaceholderSettingsSection({ sectionId }) {
  const { t } = useI18n();
  const label = isSettingsSectionId(sectionId) ? t(`settings.sections.${sectionId}`) : sectionId;
  return (
    <div className="rounded-xl border border-dashed border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-8 text-center text-[0.875rem] text-[var(--os-text-muted)]">
      {t("settings.sectionBuilding", { label })}
    </div>
  );
}
