import { cx } from '../../common/types';
import type { MenuGroupProps } from './type';

/**
 * MenuGroup 菜单分组
 */
export default function MenuGroup(props: MenuGroupProps) {
  const { className, style, title, children } = props;

  return (
    <div className={cx('udesign-menu__group', className)} style={style} role="group">
      {title ? <div className="udesign-menu__group-title">{title}</div> : null}
      <div className="udesign-menu__group-content">{children}</div>
    </div>
  );
}
