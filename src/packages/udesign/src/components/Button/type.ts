import type {
  HTMLAttributes,
  MouseEvent,
  ReactElement,
  ReactNode,
} from 'react';

/**
 * 通用类型定义
 */
export type TNode = ReactNode;
export type TElement = ReactElement;
export type SizeEnum = 'small' | 'medium' | 'large';

/**
 * Button Props
 */
export interface ButtonProps
  extends Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'content'> {
  /** 是否为块级元素 */
  block?: boolean;
  /** 按钮内容，同 content */
  children?: TNode;
  /** 按钮内容 */
  content?: TNode;
  /** 禁用状态 */
  disabled?: boolean;
  /** 原生的 form 属性，支持用于通过 form 属性触发对应 id 的 form 的表单事件 */
  form?: string;
  /** 是否为幽灵按钮（镂空按钮） */
  ghost?: boolean;
  /** 跳转地址。href 存在时，按钮标签默认使用 <a> 渲染；如果指定了 tag 则使用指定的标签渲染 */
  href?: string;
  /** 按钮内部图标，可完全自定义 */
  icon?: TElement;
  /** 是否显示为加载状态 */
  loading?: boolean;
  /** 按钮形状，有 4 种：长方形、正方形、圆角长方形、圆形 */
  shape?: 'rectangle' | 'square' | 'round' | 'circle';
  /** 组件尺寸 */
  size?: SizeEnum;
  /** 右侧内容，可用于定义右侧图标 */
  suffix?: TElement;
  /** 渲染按钮的 HTML 标签，默认使用标签 <button> 渲染，可以自定义为 <a> <div> 等。⚠️ 禁用按钮 <button disabled>无法显示 Popup 浮层信息，可通过修改 tag=div 解决这个问题 */
  tag?: 'button' | 'a' | 'div';
  /** 组件风格，依次为默认色、品牌色、危险色、警告色、成功色 */
  theme?: 'default' | 'primary' | 'danger' | 'warning' | 'success';
  /** 按钮类型 */
  type?: 'submit' | 'reset' | 'button';
  /** 按钮形式，基础、线框、虚线、文字 */
  variant?: 'base' | 'outline' | 'dashed' | 'text';
  /** 点击时触发 */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}
