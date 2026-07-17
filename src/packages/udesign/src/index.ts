import 'tdesign-react/es/style/index.css';
import './styles/css-variables.css';

import {
  Button as TButton,
  Input as TInput,
  Menu as TMenu,
  Popup as TPopup,
  Switch as TSwitch,
} from 'tdesign-react';

export { default as ColorPalette } from './components/ColorPalette';
export type { ColorPaletteProps } from './components/ColorPalette';

// Keep the existing import path stable while switching implementation to TDesign.
export const Button = TButton;
export const Input = TInput;
export const Switch = TSwitch;
export const Popup = TPopup;
export const Menu = TMenu;
export const HeadMenu = TMenu.HeadMenu;
export const Submenu = TMenu.SubMenu;
export const MenuItem = TMenu.MenuItem;
export const MenuGroup = TMenu.MenuGroup;

export type { AttachNode, ClassName, Styles } from './common/types';
export { cx, resolveAttach, resolveDelay } from './common/types';
