import type { CSSProperties } from 'react';
import { cx } from '../../common/types';
import { MenuProvider } from './context';
import HeadMenu from './HeadMenu';
import MenuGroup from './MenuGroup';
import MenuItem from './MenuItem';
import Submenu from './Submenu';
import type { MenuProps } from './type';
import './index.less';

function resolveTheme(theme: MenuProps['theme'] = 'light') {
  if (theme === 'dark') return 'dark';
  return 'light';
}

function resolveWidth(
  width: MenuProps['width'],
  collapsed: boolean,
): CSSProperties['width'] {
  const fallbackExpanded = '232px';
  const fallbackCollapsed = '64px';

  if (Array.isArray(width)) {
    const expandedWidth = width[0] ?? fallbackExpanded;
    const collapsedWidth = width[1] ?? fallbackCollapsed;
    return collapsed ? collapsedWidth : expandedWidth;
  }

  if (width != null) {
    return width;
  }

  return collapsed ? fallbackCollapsed : fallbackExpanded;
}

/**
 * Menu 导航菜单
 */
function Menu(props: MenuProps) {
  const {
    className,
    style,
    collapsed = false,
    expandMutex = false,
    expandType = 'normal',
    expanded,
    defaultExpanded,
    logo,
    operations,
    theme = 'light',
    value,
    defaultValue,
    width = '232px',
    onChange,
    onExpand,
    children,
  } = props;

  const resolvedTheme = resolveTheme(theme);
  const menuWidth = resolveWidth(width, collapsed);

  return (
    <MenuProvider
      mode="vertical"
      theme={resolvedTheme}
      collapsed={collapsed}
      expandMutex={expandMutex}
      expandType={expandType}
      expanded={expanded}
      defaultExpanded={defaultExpanded}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      onExpand={onExpand}
    >
      <nav
        className={cx(
          'udesign-menu',
          'udesign-menu--side',
          collapsed && 'udesign-menu--collapsed',
          `udesign-menu--theme-${resolvedTheme}`,
          className,
        )}
        style={{ ...style, width: menuWidth }}
        role="navigation"
      >
        {logo ? <div className="udesign-menu__logo">{logo}</div> : null}
        <div className="udesign-menu__body">{children}</div>
        {operations ? <div className="udesign-menu__operations">{operations}</div> : null}
      </nav>
    </MenuProvider>
  );
}

Menu.HeadMenu = HeadMenu;
Menu.Submenu = Submenu;
Menu.MenuItem = MenuItem;
Menu.MenuGroup = MenuGroup;
Menu.displayName = 'Menu';

export default Menu;
export { HeadMenu, Submenu, MenuItem, MenuGroup };
