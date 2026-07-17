import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { SizeEnum, TNode } from '../Button/type';

export type { SizeEnum, TNode };

/** 开关值类型 */
export type SwitchValue = string | number | boolean;

/** 图标 / 文案相对滑块的位置 */
export type SwitchContentPlacement = 'inside' | 'outside';

export interface SwitchChangeContext {
  e: MouseEvent<HTMLButtonElement>;
}

export type SwitchSlot<T extends SwitchValue = SwitchValue> =
  | [string | TNode, string | TNode]
  | TNode
  | ((context: { value: T }) => ReactNode);

export interface SwitchProps<T extends SwitchValue = SwitchValue> {
  /** 类名 */
  className?: string;
  /** 样式 */
  style?: CSSProperties;
  /**
   * Switch 切换状态前的回调方法，常用于需要发起异步请求的场景。
   * 返回 false 或 Promise reject 时不继续执行 change，否则继续执行。
   */
  beforeChange?: () => boolean | Promise<boolean>;
  /**
   * 用于自定义开关的值，[打开时的值，关闭时的值]。
   * 默认为 [true, false]。示例：[1, 0]、['open', 'close']
   */
  customValue?: [T, T];
  /** 是否禁用组件，默认为 false */
  disabled?: boolean;
  /**
   * 开关内容，[开启时内容，关闭时内容]。
   * 示例：['开', '关'] 或 (value) => (value ? '开' : '关')
   */
  label?: SwitchSlot<T>;
  /**
   * 开关图标，[开启时图标，关闭时图标]。
   * 与 label 同区（同为 inside 或 outside）时优先显示图标
   */
  icon?: SwitchSlot<T>;
  /** 图标位置：滑块内 / 滑块外，默认 inside */
  iconPlacement?: SwitchContentPlacement;
  /** 文案位置：滑块内 / 滑块外，默认 outside */
  labelPlacement?: SwitchContentPlacement;
  /** 是否处于加载中状态 */
  loading?: boolean;
  /** 开关尺寸 */
  size?: SizeEnum;
  /** 开关值（受控） */
  value?: T;
  /** 开关值（非受控） */
  defaultValue?: T;
  /** 数据发生变化时触发 */
  onChange?: (value: T, context: SwitchChangeContext) => void;
}
