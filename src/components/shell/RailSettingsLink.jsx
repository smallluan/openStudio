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

  if (narrow) {
    // Narrow mode: circular icon button (preserve original style)
    return (
      <NavLink
        to="/settings"
        state={{ backgroundLocation: location }}
        title={t("nav.settings")}
        aria-label={t("nav.settings")}
        className={({ isActive }) =>
          cn(
            "group relative flex shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none transition-[transform,color] duration-[380ms] ease-[cubic-bezier(0.34,1.2,0.52,1)] focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)] active:scale-[0.96]",
            "text-[var(--os-rail-text-muted)] hover:text-[var(--os-rail-text)]",
            isActive && "text-[var(--os-rail-text)]",
            "aspect-square w-[2.25rem] rounded-lg"
          )
        }
      >
        <NavIcon
          icon={Settings}
          className="opacity-[0.92]"
          size={RAIL_ORB_ICON_SIZE}
          strokeWidth={RAIL_ORB_ICON_STROKE}
        />
      </NavLink>
    );
  }

  // Expanded mode: full-width cell with icon, label, and chevron
  return (
    <NavLink
      to="/settings"
      state={{ backgroundLocation: location }}
      title={t("nav.settings")}
      aria-label={t("nav.settings")}
      className={({ isActive }) =>
        cn(
          "fluid-nav__hit group relative flex w-full cursor-pointer items-center justify-between gap-2 border-none bg-transparent outline-none transition-[transform,color,background] duration-[280ms] ease-[cubic-bezier(0.34,1.2,0.52,1)] focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)] active:scale-[0.96] hover:bg-[var(--os-rail-hover-bg)] rounded-[11px] px-2 py-1.5",
          "text-[var(--os-rail-text-muted)] hover:text-[var(--os-rail-text)]",
          isActive && "fluid-nav__hit--router-active"
        )
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <NavIcon
          icon={Settings}
          className="fluid-nav__glyph shrink-0 opacity-[0.92]"
          size={RAIL_ORB_ICON_SIZE}
          strokeWidth={RAIL_ORB_ICON_STROKE}
        />
        <span className="fluid-nav__label min-w-0 truncate text-[0.875rem] font-medium">{t("nav.settings")}</span>
      </div>
      <ChevronRight
        className="w-4 h-4 shrink-0 rail-settings-link__chevron transition-transform duration-[280ms] ease-[cubic-bezier(0.34,1.2,0.52,1)] group-hover:translate-x-0.5"
      />
    </NavLink>
  );
}