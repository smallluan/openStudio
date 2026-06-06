import { cn } from "./cn.js";

/** Primary rail + settings sheet — match legacy nav stroke weight, slightly compact. */
export const NAV_ICON_SIZE = 18;
export const NAV_ICON_STROKE = 1.3;

/** Footer orb (WeChat / Settings) — same visual scale as before. */
export const RAIL_ORB_ICON_SIZE = 18;
export const RAIL_ORB_ICON_STROKE = 1.3;

/**
 * @param {{
 *   icon: import("lucide-react").LucideIcon;
 *   className?: string;
 *   size?: number;
 *   strokeWidth?: number;
 * }} props
 */
export default function NavIcon({ icon: Icon, className, size = NAV_ICON_SIZE, strokeWidth = NAV_ICON_STROKE }) {
  return (
    <Icon
      className={cn("fluid-nav__glyph shrink-0", className)}
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth
      aria-hidden
    />
  );
}
