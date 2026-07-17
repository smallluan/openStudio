import type {
  ChangeEvent,
  ClipboardEvent,
  CompositionEvent,
  CSSProperties,
  FocusEvent,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import type { ClassName } from '../../common/types';
import type { SizeEnum, TElement, TNode } from '../Button/type';

/** 输入框值类型 */
export type InputValue = string;

/** 输入框展示值格式化函数 */
export type InputFormatType = (value: InputValue) => string;

/** 输入框对齐方式 */
export type InputAlign = 'left' | 'center' | 'right';

/** 输入框状态 */
export type InputStatus = 'default' | 'success' | 'warning' | 'error';

/** 输入框类型 */
export type InputType =
  | 'text'
  | 'number'
  | 'url'
  | 'tel'
  | 'password'
  | 'search'
  | 'submit'
  | 'hidden';

/** onChange 触发来源 */
export type InputChangeTrigger = 'input' | 'initial' | 'clear';

/** onChange 上下文 */
export interface InputChangeContext {
  e?: ChangeEvent<HTMLInputElement> | MouseEvent | CompositionEvent;
  trigger: InputChangeTrigger;
}

/** onValidate 上下文 */
export interface InputValidateContext {
  error?: 'exceed-maximum' | 'below-minimum';
}

/** 通用事件上下文 */
export interface InputEventContext<E = Event> {
  e: E;
}

/** 粘贴事件上下文 */
export interface InputPasteContext {
  e: ClipboardEvent<HTMLInputElement>;
  pasteValue: string;
}

/**
 * Input Props
 */
export interface InputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | 'size'
    | 'prefix'
    | 'suffix'
    | 'type'
    | 'value'
    | 'defaultValue'
    | 'onChange'
    | 'onBlur'
    | 'onFocus'
    | 'onClick'
    | 'onCompositionEnd'
    | 'onCompositionStart'
    | 'onKeyDown'
    | 'onKeyPress'
    | 'onKeyUp'
    | 'onMouseEnter'
    | 'onMouseLeave'
    | 'onPaste'
    | 'onWheel'
    | 'readOnly'
    | 'autoFocus'
    | 'spellCheck'
    | 'align'
  > {
  /** 类名 */
  className?: string;
  /** 样式 */
  style?: CSSProperties;
  /** 文本内容位置，居左/居中/居右 */
  align?: InputAlign;
  /** 超出 maxlength 或 maxcharacter 之后是否允许继续输入 */
  allowInputOverMax?: boolean;
  /** 宽度随内容自适应 */
  autoWidth?: boolean;
  /** 是否开启自动填充功能，HTML5 原生属性 */
  autocomplete?: string;
  /** 自动聚焦 */
  autofocus?: boolean;
  /** 是否开启无边框模式 */
  borderless?: boolean;
  /** 是否可清空 */
  clearable?: boolean;
  /** 是否为块级元素（宽度 100%） */
  block?: boolean;
  /** 是否禁用输入框 */
  disabled?: boolean;
  /** 指定输入框展示值的格式 */
  format?: InputFormatType;
  /** t-input 同级类名 */
  inputClass?: ClassName;
  /** 左侧文本 */
  label?: TNode;
  /** 用户最多可以输入的字符个数，一个中文汉字表示两个字符长度 */
  maxcharacter?: number;
  /** 用户最多可以输入的文本长度，一个中文等于一个计数长度 */
  maxlength?: number;
  /** 名称 */
  name?: string;
  /** 占位符 */
  placeholder?: string;
  /** 组件前置图标 */
  prefixIcon?: TElement;
  /** 只读状态 */
  readOnly?: boolean;
  /** 输入框内容为空时，悬浮状态是否显示清空按钮 */
  showClearIconOnEmpty?: boolean;
  /** 是否在输入框右侧显示字数统计 */
  showLimitNumber?: boolean;
  /** 输入框尺寸 */
  size?: SizeEnum;
  /** 是否开启拼写检查，HTML5 原生属性 */
  spellCheck?: boolean;
  /** 输入框状态 */
  status?: InputStatus;
  /** 后置图标前的后置内容 */
  suffix?: TNode;
  /** 组件后置图标 */
  suffixIcon?: TElement;
  /** 输入框下方提示文本 */
  tips?: TNode;
  /** 输入框类型 */
  type?: InputType;
  /** 输入框的值（受控） */
  value?: InputValue;
  /** 输入框的值（非受控） */
  defaultValue?: InputValue;
  /** 失去焦点时触发 */
  onBlur?: (value: InputValue, context: InputEventContext<FocusEvent>) => void;
  /** 输入框值发生变化时触发 */
  onChange?: (value: InputValue, context?: InputChangeContext) => void;
  /** 清空按钮点击时触发 */
  onClear?: (context: InputEventContext<MouseEvent>) => void;
  /** 点击组件时触发 */
  onClick?: (context: InputEventContext<MouseEvent>) => void;
  /** 中文输入结束时触发 */
  onCompositionend?: (
    value: InputValue,
    context: InputEventContext<CompositionEvent>,
  ) => void;
  /** 中文输入开始时触发 */
  onCompositionstart?: (
    value: InputValue,
    context: InputEventContext<CompositionEvent>,
  ) => void;
  /** 回车键按下时触发 */
  onEnter?: (value: InputValue, context: InputEventContext<KeyboardEvent>) => void;
  /** 获得焦点时触发 */
  onFocus?: (value: InputValue, context: InputEventContext<FocusEvent>) => void;
  /** 键盘按下时触发 */
  onKeydown?: (value: InputValue, context: InputEventContext<KeyboardEvent>) => void;
  /** 按下字符键时触发 */
  onKeypress?: (value: InputValue, context: InputEventContext<KeyboardEvent>) => void;
  /** 释放键盘时触发 */
  onKeyup?: (value: InputValue, context: InputEventContext<KeyboardEvent>) => void;
  /** 进入输入框时触发 */
  onMouseenter?: (context: InputEventContext<MouseEvent>) => void;
  /** 离开输入框时触发 */
  onMouseleave?: (context: InputEventContext<MouseEvent>) => void;
  /** 粘贴事件 */
  onPaste?: (context: InputPasteContext) => void;
  /** 字数超出限制时触发 */
  onValidate?: (context: InputValidateContext) => void;
  /** 输入框中滚动鼠标时触发 */
  onWheel?: (context: InputEventContext<ReactWheelEvent<HTMLInputElement>>) => void;
}
