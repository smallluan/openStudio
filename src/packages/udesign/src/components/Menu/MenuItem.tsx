import {
  useCallback,
  useId,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { cx } from '../../common/types';
import Popup from '../Popup';
import { useMenuContext } from './context';
import type { MenuItemProps, MenuValue } from './type';

function ChevronIcon({ expanded }: { expanded?: boolean }) {
  return (
    <svg
      className={cx('udesign-menu__chevron', expanded && 'udesign-menu__chevron--expanded')}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      focusable="false"
      aria-hidden
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function resolveMenuValue(value: MenuValue | undefined, fallback: string): MenuValue {
  return value ?? fallback;
}

/**
 * MenuItem 菜单项
 */
export default function MenuItem(props: MenuItemProps) {
  const {
    className,
    style,
    children,
    content,
    disabled = false,
    href,
    icon,
    target = '_self',
    tooltipProps,
    value,
    onClick,
  } = props;

  const menu = useMenuContext();
  const autoId = useId();
  const itemValue = resolveMenuValue(value, autoId);
  const active = menu.isActive(itemValue);
  const label = content ?? children;

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      menu.setActiveValue(itemValue);
      onClick?.({ e, value: itemValue });
    },
    [disabled, itemValue, menu, onClick],
  );

  const itemClassName = cx(
    'udesign-menu__item',
    active && 'udesign-menu__item--active',
    disabled && 'udesign-menu__item--disabled',
    menu.collapsed && menu.mode === 'vertical' && 'udesign-menu__item--collapsed',
    menu.mode === 'horizontal' && 'udesign-menu__item--horizontal',
    className,
  );

  const inner = (
    <>
      {icon ? <span className="udesign-menu__icon">{icon}</span> : null}
      {menu.collapsed && menu.mode === 'vertical' ? null : (
        <span className="udesign-menu__text">{label}</span>
      )}
    </>
  );

  const node =
    href && !disabled ? (
      <a
        className={itemClassName}
        style={style}
        href={href}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        aria-current={active ? 'page' : undefined}
        aria-disabled={disabled || undefined}
        onClick={handleClick}
      >
        {inner}
      </a>
    ) : (
      <button
        type="button"
        className={itemClassName}
        style={style}
        disabled={disabled}
        aria-current={active ? 'page' : undefined}
        onClick={handleClick}
      >
        {inner}
      </button>
    );

  if (menu.collapsed && menu.mode === 'vertical' && label) {
    return (
      <Popup
        trigger="hover"
        placement="right-top"
        content={label}
        delay={[200, 0]}
        {...tooltipProps}
      >
        {node}
      </Popup>
    );
  }

  return node;
}

export { ChevronIcon, resolveMenuValue };
