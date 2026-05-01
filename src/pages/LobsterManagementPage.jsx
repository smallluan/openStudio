import { useI18n } from "../context/I18nContext.jsx";

export default function LobsterManagementPage() {
  const { t } = useI18n();
  return (
    <div className="route-page route-page--plain">
      <header className="route-page__header">
        <h1 className="route-page__title">{t("lobsterPage.title")}</h1>
        <p className="route-page__desc muted">{t("lobsterPage.desc")}</p>
      </header>
      <div className="route-page__placeholder">
        <p className="muted">{t("lobsterPage.placeholder")}</p>
      </div>
    </div>
  );
}
