import { Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../../context/I18nContext.jsx";
import NavIcon, { RAIL_ORB_ICON_SIZE, RAIL_ORB_ICON_STROKE } from "../../ui/NavIcon.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{ narrow?: boolean }} props
 */
export default function RailSettingsLink({ narrow = false }) {
  const { t } = useI18n();

  return (
    <NavLink
      to="/settings"
      title={t("nav.settings")}
      aria-label={t("nav.settings")}
      className={({ isActive }) =>
        cn(
          "group relative flex shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none transition-[transform,color] duration-[380ms] ease-[cubic-bezier(0.34,1.2,0.52,1)] focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)] active:scale-[0.96]",
          "text-[var(--os-rail-text-muted)] hover:text-[var(--os-rail-text)]",
          isActive && "text-[var(--os-rail-text)]",
          narrow ? "aspect-square w-[2.25rem] rounded-lg" : "size-[1.68rem] rounded-[10px]",
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
