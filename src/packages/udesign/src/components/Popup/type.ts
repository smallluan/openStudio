import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  WheelEvent,
} from 'react';
import type { Middleware, Placement, Strategy } from '@floating-ui/react';
import type { AttachNode, ClassName, Styles, TNode } from '../../common/types';

export type { AttachNode, ClassName, Styles, TNode };

/** 浮层出现位置（TDesign 命名） */
export type PopupPlacement =
  | 'top'
  | 'left'
  | 'right'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left-top'
  | 'left-bottom'
  | 'right-top'
  | 'right-bottom';

/** 触发方式 */
export type PopupTrigger =
  | 'hover'
  | 'click'
  | 'focus'
  | 'mousedown'
  | 'context-menu';

export type PopupTriggerEvent = MouseEvent | FocusEvent | KeyboardEvent;

export type PopupTriggerSource =
  | 'document'
  | 'trigger-element-click'
  | 'trigger-element-hover'
  | 'trigger-element-blur'
  | 'trigger-element-focus'
  | 'trigger-element-mousedown'
  | 'context-menu'
  | 'keydown-esc';

export interface PopupVisibleChangeContext {
  e?: PopupTriggerEvent;
  trigger?: PopupTriggerSource;
}

/**
 * Floating UI / Popper 兼容配置（自动避障相关）
 * 参考：https://floating-ui.com/docs/useFloating
 */
export interface PopupPopperOptions {
  strategy?: Strategy;
  middleware?: Middleware[];
  /** 与触发元素的间距，默认 8 */
  offset?: number | { mainAxis?: number; crossAxis?: number };
  /** 视口边距，用于 flip / shift，默认 8 */
  boundaryPadding?: number;
  /** 是否启用 flip 避障，默认 true */
  flip?: boolean;
  /** 是否启用 shift 避障，默认 true */
  shift?: boolean;
}

export type PopupOverlayStyle =
  | Styles
  | ((
      triggerElement: HTMLElement,
      popupElement: HTMLElement,
    ) => Styles | undefined);

export interface PopupProps {
  /** 挂载节点，默认 body */
  attach?: AttachNode;
  /** 触发元素，同 triggerElement */
  children?: string | TNode;
  /** 浮层内容 */
  content?: string | TNode;
  /**
   * 延时显示或隐藏，[显示, 隐藏]，单位 ms。
   * 单个数字表示两者相同。默认 [250, 150]
   */
  delay?: number | number[];
  /** 关闭时是否销毁浮层，默认 false */
  destroyOnClose?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 空内容时是否隐藏浮层，默认 false */
  hideEmptyPopup?: boolean;
  /** 浮层类名 */
  overlayClassName?: ClassName;
  /** 浮层内容区类名 */
  overlayInnerClassName?: ClassName;
  /** 浮层内容区样式 */
  overlayInnerStyle?: PopupOverlayStyle;
  /** 浮层样式 */
  overlayStyle?: PopupOverlayStyle;
  /** 浮层出现位置，默认 top */
  placement?: PopupPlacement;
  /** Floating UI / Popper 初始化配置 */
  popperOptions?: PopupPopperOptions;
  /** 是否显示箭头，默认 false */
  showArrow?: boolean;
  /** 触发方式，默认 hover */
  trigger?: PopupTrigger;
  /** 触发元素 */
  triggerElement?: string | TNode;
  /** 是否显示（受控） */
  visible?: boolean;
  /** 是否显示（非受控） */
  defaultVisible?: boolean;
  /** 层级，Web 默认 5500 */
  zIndex?: number;
  /** 内容面板点击 */
  onOverlayClick?: (context: { e: MouseEvent<HTMLDivElement> }) => void;
  /** 浮层滚动 */
  onScroll?: (context: { e: WheelEvent<HTMLDivElement> }) => void;
  /** 滚动触底 */
  onScrollToBottom?: (context: { e: WheelEvent<HTMLDivElement> }) => void;
  /** 显示/隐藏变化 */
  onVisibleChange?: (
    visible: boolean,
    context: PopupVisibleChangeContext,
  ) => void;
  /** 根节点类名（包裹触发器） */
  className?: ClassName;
  /** 根节点样式 */
  style?: CSSProperties;
}

export const POPUP_PLACEMENT_MAP: Record<PopupPlacement, Placement> = {
  top: 'top',
  left: 'left',
  right: 'right',
  bottom: 'bottom',
  'top-left': 'top-start',
  'top-right': 'top-end',
  'bottom-left': 'bottom-start',
  'bottom-right': 'bottom-end',
  'left-top': 'left-start',
  'left-bottom': 'left-end',
  'right-top': 'right-start',
  'right-bottom': 'right-end',
};

export function isEmptyPopupContent(content: ReactNode): boolean {
  if (content == null || content === false) return true;
  if (typeof content === 'string' && content.trim() === '') return true;
  return false;
}

export function resolveOverlayStyle(
  style: PopupOverlayStyle | undefined,
  trigger: HTMLElement | null,
  popup: HTMLElement | null,
): CSSProperties | undefined {
  if (style == null || style === false || style === true) return undefined;
  if (typeof style === 'function') {
    if (!trigger || !popup) return undefined;
    const result = style(trigger, popup);
    if (result == null || typeof result === 'boolean') return undefined;
    return result;
  }
  return style;
}
