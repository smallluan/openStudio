import { Settings, ChevronRight } from "lucide-react";
import { Button } from "@open-studio/udesign";
import { Tooltip } from "tdesign-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import NavIcon, { RAIL_ORB_ICON_SIZE, RAIL_ORB_ICON_STROKE } from "../../ui/NavIcon.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{ narrow?: boolean }} props
 */
export default function RailSettingsLink({ narrow = false }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen = location.pathname === "/settings";

  const openSettings = useCallback(() => {
    if (settingsOpen) return;
    const backgroundLocation = location.state?.backgroundLocation ?? location;
    navigate("/settings", { state: { backgroundLocation } });
  }, [navigate, location, settingsOpen]);

  if (narrow) {
    return (
      <div className="app-rail-nav app-rail-nav--collapsed">
        <Tooltip content={t("nav.settings")} placement="right" destroyOnClose>
          <Button
            type="button"
            variant="text"
            aria-label={t("nav.settings")}
            aria-current={settingsOpen ? "page" : undefined}
            className={cn(
              "app-rail-nav-item app-rail-nav-item--collapsed app-rail-settings-link",
              settingsOpen && "app-rail-nav-item--active",
            )}
            onClick={openSettings}
          >
            <NavIcon
              icon={Settings}
              size={RAIL_ORB_ICON_SIZE}
              strokeWidth={RAIL_ORB_ICON_STROKE}
            />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="app-rail-nav">
      <Button
        type="button"
        variant="text"
        block
        aria-label={t("nav.settings")}
        aria-current={settingsOpen ? "page" : undefined}
        className={cn(
          "app-rail-nav-item app-rail-settings-link",
          settingsOpen && "app-rail-nav-item--active",
        )}
        onClick={openSettings}
      >
        <span className="app-rail-nav-item__inner app-rail-settings-link__inner">
          <NavIcon
            icon={Settings}
            size={RAIL_ORB_ICON_SIZE}
            strokeWidth={RAIL_ORB_ICON_STROKE}
          />
          <span className="app-rail-nav-item__label">{t("nav.settings")}</span>
          <ChevronRight className="app-rail-settings-link__chevron" aria-hidden />
        </span>
      </Button>
    </div>
  );
}
