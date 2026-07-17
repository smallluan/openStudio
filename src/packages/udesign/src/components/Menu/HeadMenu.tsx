import { cx } from '../../common/types';
import { MenuProvider } from './context';
import type { HeadMenuProps } from './type';

function resolveTheme(theme: HeadMenuProps['theme'] = 'light') {
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * HeadMenu 顶部导航菜单
 */
export default function HeadMenu(props: HeadMenuProps) {
  const {
    className,
    style,
    expandType = 'normal',
    expanded,
    defaultExpanded,
    logo,
    operations,
    theme = 'light',
    value,
    defaultValue,
    onChange,
    onExpand,
    children,
  } = props;

  const resolvedTheme = resolveTheme(theme);

  return (
    <MenuProvider
      mode="horizontal"
      theme={resolvedTheme}
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
          'udesign-menu--head',
          `udesign-menu--theme-${resolvedTheme}`,
          className,
        )}
        style={style}
        role="navigation"
      >
        {logo ? <div className="udesign-menu__logo">{logo}</div> : null}
        <div className="udesign-menu__body udesign-menu__body--horizontal">{children}</div>
        {operations ? <div className="udesign-menu__operations">{operations}</div> : null}
      </nav>
    </MenuProvider>
  );
}
