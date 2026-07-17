import { useCallback, useEffect, useId, type MouseEvent as ReactMouseEvent } from 'react';
import { cx } from '../../common/types';
import Popup from '../Popup';
import { SubmenuLevelProvider, useMenuContext } from './context';
import { ChevronIcon, resolveMenuValue } from './MenuItem';
import type { SubmenuProps } from './type';

/**
 * Submenu 子菜单
 */
export default function Submenu(props: SubmenuProps) {
  const {
    className,
    style,
    children,
    content,
    disabled = false,
    icon,
    popupProps,
    title,
    value,
  } = props;

  const menu = useMenuContext();
  const autoId = useId();
  const subValue = resolveMenuValue(value, autoId);
  const parentValue = menu.parentSubmenuValue;
  const expanded = menu.isExpanded(subValue);
  const label = title ?? content ?? children;
  const usePopup = menu.expandType === 'popup';

  useEffect(() => {
    menu.registerSubmenu(subValue, parentValue);
    return () => menu.unregisterSubmenu(subValue);
  }, [menu, parentValue, subValue]);

  const handleToggle = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (disabled) return;
      menu.toggleExpand(subValue, parentValue);
    },
    [disabled, menu, parentValue, subValue],
  );

  const triggerClassName = cx(
    'udesign-menu__submenu-trigger',
    expanded && 'udesign-menu__submenu-trigger--expanded',
    disabled && 'udesign-menu__submenu-trigger--disabled',
    menu.collapsed && menu.mode === 'vertical' && 'udesign-menu__submenu-trigger--collapsed',
    menu.mode === 'horizontal' && 'udesign-menu__submenu-trigger--horizontal',
    className,
  );

  const trigger = (
    <button
      type="button"
      className={triggerClassName}
      style={style}
      disabled={disabled}
      aria-expanded={expanded}
      onClick={usePopup ? undefined : handleToggle}
    >
      {icon ? <span className="udesign-menu__icon">{icon}</span> : null}
      {menu.collapsed && menu.mode === 'vertical' ? null : (
        <span className="udesign-menu__text">{label}</span>
      )}
      {!menu.collapsed || menu.mode === 'horizontal' ? (
        <ChevronIcon expanded={expanded} />
      ) : null}
    </button>
  );

  const panel = (
    <SubmenuLevelProvider level={menu.level + 1} parentSubmenuValue={subValue}>
      <div
        className={cx(
          'udesign-menu__submenu-panel',
          usePopup && 'udesign-menu__submenu-panel--popup',
          menu.mode === 'horizontal' && 'udesign-menu__submenu-panel--horizontal',
        )}
        role="group"
      >
        {children}
      </div>
    </SubmenuLevelProvider>
  );

  const triggerWithTooltip =
    menu.collapsed && menu.mode === 'vertical' && label && !usePopup ? (
      <Popup trigger="hover" placement="right-top" content={label} delay={[200, 0]}>
        {trigger}
      </Popup>
    ) : (
      trigger
    );

  if (usePopup) {
    const popupPlacement =
      menu.mode === 'horizontal' ? ('bottom-left' as const) : ('right-top' as const);

    return (
      <div className={cx('udesign-menu__submenu', 'udesign-menu__submenu--popup')}>
        <Popup
          trigger="click"
          placement={popupPlacement}
          visible={expanded}
          onVisibleChange={(visible) => {
            if (visible !== expanded) {
              menu.toggleExpand(subValue, parentValue);
            }
          }}
          overlayClassName="udesign-menu__submenu-popup"
          overlayInnerClassName="udesign-menu__submenu-popup-inner"
          content={panel}
          disabled={disabled}
          {...popupProps}
        >
          {trigger}
        </Popup>
      </div>
    );
  }

  return (
    <div className={cx('udesign-menu__submenu', expanded && 'udesign-menu__submenu--expanded')}>
      {triggerWithTooltip}
      {expanded ? panel : null}
    </div>
  );
}
