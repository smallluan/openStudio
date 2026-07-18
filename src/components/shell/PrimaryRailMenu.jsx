import { Button } from "@open-studio/udesign";
import { Tag, Tooltip } from "tdesign-react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { cn } from "../../ui/cn.js";

/**
 * @param {import("react-router-dom").Location} location
 * @param {{ to?: string; end?: boolean; isActive?: (loc: import("react-router-dom").Location) => boolean }} item
 */
function isRailItemActive(location, item) {
  if (typeof item.isActive === "function") {
    return item.isActive(location);
  }
  if (!item.to) return false;
  return Boolean(matchPath({ path: item.to, end: item.end ?? false }, location.pathname));
}

/**
 * @param {{
 *   collapsed?: boolean;
 *   items: Array<{
 *     id: string;
 *     label: string;
 *     icon?: import("react").ReactNode;
 *     to?: string;
 *     end?: boolean;
 *     state?: unknown;
 *     badge?: string;
 *     isActive?: (loc: import("react-router-dom").Location) => boolean;
 *   }>;
 * }} props
 */
export default function PrimaryRailMenu({ collapsed = false, items }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavigate = useCallback(
    (item) => {
      if (!item.to) return;
      navigate(item.to, { state: item.state });
    },
    [navigate],
  );

  return (
    <nav
      className={cn("app-rail-nav", collapsed && "app-rail-nav--collapsed")}
      aria-label="Primary navigation"
    >
      {items.map((item) => {
        if (!item.to) return null;
        const active = isRailItemActive(location, item);
        const button = (
          <Button
            type="button"
            variant="text"
            block={!collapsed}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "app-rail-nav-item",
              collapsed && "app-rail-nav-item--collapsed",
              active && "app-rail-nav-item--active",
            )}
            onClick={() => handleNavigate(item)}
          >
            {collapsed ? (
              item.icon
            ) : (
              <span className="app-rail-nav-item__inner">
                {item.icon}
                <span className="app-rail-nav-item__label">{item.label}</span>
                {item.badge ? (
                  <Tag size="small" theme="success" variant="light" className="app-rail-nav-item__badge">
                    {item.badge}
                  </Tag>
                ) : null}
              </span>
            )}
          </Button>
        );

        if (!collapsed) return button;

        return (
          <Tooltip key={item.id} content={item.label} placement="right" destroyOnClose>
            {button}
          </Tooltip>
        );
      })}
    </nav>
  );
}
