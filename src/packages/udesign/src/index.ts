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

export type { AttachNode, ClassName, Styles } from './common/types';
export { cx, resolveAttach, resolveDelay } from './common/types';
