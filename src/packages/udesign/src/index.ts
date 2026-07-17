import './styles/css-variables.css';

export { default as ColorPalette } from './components/ColorPalette';
export type { ColorPaletteProps } from './components/ColorPalette';

export { default as Button } from './components/Button';
export type {
  ButtonProps,
  TNode,
  TElement,
  SizeEnum,
} from './components/Button/type';

export { default as Switch } from './components/Switch';
export type {
  SwitchProps,
  SwitchValue,
  SwitchChangeContext,
  SwitchContentPlacement,
  SwitchSlot,
} from './components/Switch/type';

export { default as Popup } from './components/Popup';
export type {
  PopupProps,
  PopupPlacement,
  PopupTrigger,
  PopupVisibleChangeContext,
  PopupTriggerEvent,
  PopupTriggerSource,
  PopupPopperOptions,
  PopupOverlayStyle,
} from './components/Popup/type';

export { default as Input } from './components/Input';
export type {
  InputProps,
  InputValue,
  InputFormatType,
  InputAlign,
  InputStatus,
  InputType,
  InputChangeTrigger,
  InputChangeContext,
  InputValidateContext,
  InputEventContext,
  InputPasteContext,
} from './components/Input/type';

export type { AttachNode, ClassName, Styles } from './common/types';
export { cx, resolveAttach, resolveDelay } from './common/types';

export { default as Menu } from './components/Menu';
export type {
  MenuProps,
  HeadMenuProps,
  SubmenuProps,
  MenuItemProps,
  MenuGroupProps,
  MenuValue,
  MenuExpandType,
  MenuTheme,
  HeadMenuTheme,
  MenuItemTarget,
  MenuTooltipProps,
  MenuClickContext,
} from './components/Menu/type';
export { HeadMenu, Submenu, MenuItem, MenuGroup } from './components/Menu';
