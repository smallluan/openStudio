import { Menu } from "@open-studio/udesign";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useTheme } from "../../context/ThemeContext.jsx";

/**
 * @param {import("react-router-dom").Location} location
 * @param {Array<{ id: string; to?: string; end?: boolean; isActive?: (loc: import("react-router-dom").Location) => boolean }>} items
 */
function resolveActiveItemId(location, items) {
  for (const item of items) {
    if (!item.to) continue;
    if (typeof item.isActive === "function") {
      try {
        if (item.isActive(location)) return item.id;
      } catch {
        /* ignore */
      }
      continue;
    }
    const matched = matchPath({ path: item.to, end: item.end ?? false }, location.pathname);
    if (matched) return item.id;
  }
  return undefined;
}

/**
 * @param {{
 *   collapsed?: boolean;
 *   items: Array<{ id: string; label: string; icon?: import("react").ReactNode; to?: string; end?: boolean; state?: unknown; isActive?: (loc: import("react-router-dom").Location) => boolean }>;
 * }} props
 */
export default function PrimaryRailMenu({ collapsed = false, items }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const activeValue = useMemo(() => resolveActiveItemId(location, items), [items, location]);

  const handleChange = useCallback(
    (value) => {
      const item = items.find((entry) => entry.id === value);
      if (!item?.to) return;
      navigate(item.to, { state: item.state });
    },
    [items, navigate],
  );

  return (
    <Menu
      className="app-rail-menu"
      collapsed={collapsed}
      width="100%"
      theme={theme === "dark" ? "dark" : "light"}
      value={activeValue}
      onChange={handleChange}
    >
      {items.map((item) => (
        <Menu.MenuItem key={item.id} value={item.id} icon={item.icon}>
          {item.label}
        </Menu.MenuItem>
      ))}
    </Menu>
  );
}
