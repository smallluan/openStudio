import { Settings, ChevronRight } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useI18n } from "../../context/I18nContext.jsx";
import NavIcon, { RAIL_ORB_ICON_SIZE, RAIL_ORB_ICON_STROKE } from "../../ui/NavIcon.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{ narrow?: boolean }} props
 */
export default function RailSettingsLink({ narrow = false }) {
  const { t } = useI18n();
  const location = useLocation();

  return (
    <NavLink
      to="/settings"
      state={{ backgroundLocation: location }}
      title={t("nav.settings")}
      aria-label={t("nav.settings")}
      className={({ isActive }) =>
        cn("app-rail-settings-link", narrow && "app-rail-settings-link--narrow", isActive && "app-rail-settings-link--active")
      }
    >
      <NavIcon
        icon={Settings}
        size={RAIL_ORB_ICON_SIZE}
        strokeWidth={RAIL_ORB_ICON_STROKE}
      />
      {!narrow ? (
        <>
          <span className="app-rail-settings-link__label">{t("nav.settings")}</span>
          <ChevronRight className="app-rail-settings-link__chevron" aria-hidden />
        </>
      ) : null}
    </NavLink>
  );
}
