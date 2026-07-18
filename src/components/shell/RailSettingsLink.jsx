import { Settings, ChevronRight } from "lucide-react";
import { Menu } from "@open-studio/udesign";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import NavIcon, { RAIL_ORB_ICON_SIZE, RAIL_ORB_ICON_STROKE } from "../../ui/NavIcon.jsx";
import { cn } from "../../ui/cn.js";

const SETTINGS_ITEM_ID = "settings";
/** Keep Menu controlled without matching any item — settings opens as a modal overlay. */
const MENU_NO_SELECTION = "__rail_settings_none__";

/**
 * @param {{ narrow?: boolean }} props
 */
export default function RailSettingsLink({ narrow = false }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const handleChange = useCallback(
    (value) => {
      if (value !== SETTINGS_ITEM_ID) return;
      const backgroundLocation = location.state?.backgroundLocation ?? location;
      navigate("/settings", { state: { backgroundLocation } });
    },
    [navigate, location],
  );

  return (
    <Menu
      className={cn("app-rail-menu", "app-rail-settings-menu", narrow && "app-rail-settings-menu--narrow")}
      collapsed={narrow}
      width="100%"
      theme={theme === "dark" ? "dark" : "light"}
      value={MENU_NO_SELECTION}
      onChange={handleChange}
    >
      <Menu.MenuItem
        value={SETTINGS_ITEM_ID}
        tooltipProps={{ content: t("nav.settings") }}
        icon={
          <NavIcon
            icon={Settings}
            size={RAIL_ORB_ICON_SIZE}
            strokeWidth={RAIL_ORB_ICON_STROKE}
          />
        }
      >
        <span className="app-rail-settings-menu__inner">
          <span className="app-rail-settings-menu__label">{t("nav.settings")}</span>
          <ChevronRight className="app-rail-settings-menu__chevron" aria-hidden />
        </span>
      </Menu.MenuItem>
    </Menu>
  );
}
