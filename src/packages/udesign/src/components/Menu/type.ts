import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import type { PopupProps } from '../Popup/type';
import type { ClassName, TNode } from '../../common/types';

export type { ClassName, TNode };

/** 通用元素类型 */
export type TElement = ReactElement;

/** 菜单项唯一标识 */
export type MenuValue = string | number;

/** 菜单展开方式 */
export type MenuExpandType = 'normal' | 'popup';

/** 菜单主题 */
export type MenuTheme = 'light' | 'dark' | 'global' | 'system';

/** HeadMenu 主题（不含 global/system） */
export type HeadMenuTheme = 'light' | 'dark';

/** 链接跳转方式 */
export type MenuItemTarget = '_blank' | '_self' | '_parent' | '_top';

/** Tooltip 透传属性（Tooltip 组件开发中，暂映射 Popup 常用字段） */
export type MenuTooltipProps = Partial<
  Pick<
    PopupProps,
    | 'placement'
    | 'delay'
    | 'overlayClassName'
    | 'overlayInnerClassName'
    | 'overlayStyle'
    | 'overlayInnerStyle'
    | 'zIndex'
  >
>;

export interface MenuClickContext {
  e: MouseEvent<HTMLElement>;
  value: MenuValue;
}

/**
 * Menu Props — 侧边导航菜单
 */
export interface MenuProps {
  /** 类名 */
  className?: ClassName;
  /** 样式 */
  style?: CSSProperties;
  /** 是否收起菜单 */
  collapsed?: boolean;
  /** 同级别互斥展开 */
  expandMutex?: boolean;
  /** 二级菜单展开方式：平铺展开 / 浮层展开 */
  expandType?: MenuExpandType;
  /** 子菜单展开的导航集合（受控） */
  expanded?: MenuValue[];
  /** 子菜单展开的导航集合（非受控） */
  defaultExpanded?: MenuValue[];
  /** 站点 LOGO */
  logo?: TElement;
  /** 导航操作区域 */
  operations?: TElement;
  /**
   * 菜单风格。global/system 正在开发中，暂勿使用
   * @default light
   */
  theme?: MenuTheme;
  /** 激活菜单项（受控） */
  value?: MenuValue;
  /** 激活菜单项（非受控） */
  defaultValue?: MenuValue;
  /**
   * 菜单宽度。数组时表示 [展开宽度, 折叠宽度]
   * @default '232px'
   */
  width?: string | number | Array<string | number>;
  /** 激活菜单项发生变化时触发 */
  onChange?: (value: MenuValue) => void;
  /** 展开的菜单项发生变化时触发 */
  onExpand?: (value: MenuValue[]) => void;
  /** 菜单内容 */
  children?: TNode;
}

/**
 * HeadMenu Props — 顶部导航菜单
 */
export interface HeadMenuProps {
  /** 类名 */
  className?: ClassName;
  /** 样式 */
  style?: CSSProperties;
  /** 二级菜单展开方式 */
  expandType?: MenuExpandType;
  /** 展开的子菜单集合（受控） */
  expanded?: MenuValue[];
  /** 展开的子菜单集合（非受控） */
  defaultExpanded?: MenuValue[];
  /** 站点 LOGO */
  logo?: TElement;
  /** 导航操作区域 */
  operations?: TElement;
  /** 菜单风格 */
  theme?: HeadMenuTheme;
  /** 激活菜单项（受控） */
  value?: MenuValue;
  /** 激活菜单项（非受控） */
  defaultValue?: MenuValue;
  /** 激活菜单项发生变化时触发 */
  onChange?: (value: MenuValue) => void;
  /** 展开的菜单项发生变化时触发 */
  onExpand?: (value: MenuValue[]) => void;
  /** 菜单内容 */
  children?: TNode;
}

/**
 * Submenu Props — 子菜单
 */
export interface SubmenuProps {
  /** 类名 */
  className?: ClassName;
  /** 样式 */
  style?: CSSProperties;
  /** 菜单项内容，同 content */
  children?: TNode;
  /** 菜单项内容 */
  content?: TNode;
  /** 是否禁用 */
  disabled?: boolean;
  /** 菜单项图标 */
  icon?: TElement;
  /** 透传 Popup 组件特性（popup 展开方式时生效） */
  popupProps?: Partial<PopupProps>;
  /** 二级菜单标题 */
  title?: TNode;
  /** 菜单项唯一标识 */
  value?: MenuValue;
}

/**
 * MenuItem Props — 菜单项
 */
export interface MenuItemProps {
  /** 类名 */
  className?: ClassName;
  /** 样式 */
  style?: CSSProperties;
  /** 菜单项内容，同 content */
  children?: TNode;
  /** 菜单项内容 */
  content?: TNode;
  /** 是否禁用 */
  disabled?: boolean;
  /** 跳转链接 */
  href?: string;
  /** 图标 */
  icon?: TElement;
  /** 链接或路由跳转方式 */
  target?: MenuItemTarget;
  /** 透传 Tooltip 特性（一级菜单收起时聚焦提示） */
  tooltipProps?: MenuTooltipProps;
  /** 菜单项唯一标识 */
  value?: MenuValue;
  /** 点击时触发 */
  onClick?: (context: MenuClickContext) => void;
}

/**
 * MenuGroup Props — 菜单分组
 */
export interface MenuGroupProps {
  /** 类名 */
  className?: ClassName;
  /** 样式 */
  style?: CSSProperties;
  /** 菜单组标题 */
  title?: TNode;
  /** 分组内容 */
  children?: TNode;
}
