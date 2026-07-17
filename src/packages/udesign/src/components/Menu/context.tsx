import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MenuExpandType, MenuTheme, MenuValue } from './type';

export type MenuMode = 'vertical' | 'horizontal';

export interface MenuContextValue {
  mode: MenuMode;
  theme: MenuTheme;
  collapsed: boolean;
  expandMutex: boolean;
  expandType: MenuExpandType;
  activeValue?: MenuValue;
  expanded: MenuValue[];
  setActiveValue: (value: MenuValue) => void;
  toggleExpand: (value: MenuValue, parentValue?: MenuValue | null) => void;
  isExpanded: (value: MenuValue) => boolean;
  isActive: (value: MenuValue) => boolean;
  level: number;
  /** 当前层级所属父级 Submenu 的 value，顶层为 null */
  parentSubmenuValue: MenuValue | null;
  registerSubmenu: (value: MenuValue, parentValue: MenuValue | null) => void;
  unregisterSubmenu: (value: MenuValue) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) {
    throw new Error('Menu compound components must be used within Menu or HeadMenu');
  }
  return ctx;
}

export function useOptionalMenuContext(): MenuContextValue | null {
  return useContext(MenuContext);
}

interface MenuProviderProps {
  mode: MenuMode;
  theme?: MenuTheme;
  collapsed?: boolean;
  expandMutex?: boolean;
  expandType?: MenuExpandType;
  value?: MenuValue;
  defaultValue?: MenuValue;
  expanded?: MenuValue[];
  defaultExpanded?: MenuValue[];
  onChange?: (value: MenuValue) => void;
  onExpand?: (value: MenuValue[]) => void;
  children: ReactNode;
}

export function MenuProvider({
  mode,
  theme = 'light',
  collapsed = false,
  expandMutex = false,
  expandType = 'normal',
  value,
  defaultValue,
  expanded,
  defaultExpanded = [],
  onChange,
  onExpand,
  children,
}: MenuProviderProps) {
  const isValueControlled = value !== undefined;
  const isExpandedControlled = expanded !== undefined;
  const [innerValue, setInnerValue] = useState<MenuValue | undefined>(defaultValue);
  const [innerExpanded, setInnerExpanded] = useState<MenuValue[]>(defaultExpanded);
  const parentMapRef = useRef<Map<MenuValue, MenuValue | null>>(new Map());

  const activeValue = isValueControlled ? value : innerValue;
  const expandedValues = isExpandedControlled ? expanded! : innerExpanded;

  const setActiveValue = useCallback(
    (next: MenuValue) => {
      if (!isValueControlled) {
        setInnerValue(next);
      }
      onChange?.(next);
    },
    [isValueControlled, onChange],
  );

  const setExpandedValues = useCallback(
    (next: MenuValue[]) => {
      if (!isExpandedControlled) {
        setInnerExpanded(next);
      }
      onExpand?.(next);
    },
    [isExpandedControlled, onExpand],
  );

  const registerSubmenu = useCallback((subValue: MenuValue, parentValue: MenuValue | null) => {
    parentMapRef.current.set(subValue, parentValue);
  }, []);

  const unregisterSubmenu = useCallback((subValue: MenuValue) => {
    parentMapRef.current.delete(subValue);
  }, []);

  const toggleExpand = useCallback(
    (subValue: MenuValue, parentValue: MenuValue | null = null) => {
      const isOpen = expandedValues.includes(subValue);
      let next: MenuValue[];

      if (isOpen) {
        next = expandedValues.filter((item) => item !== subValue);
      } else if (expandMutex) {
        const siblings = [...parentMapRef.current.entries()]
          .filter(([, parent]) => parent === parentValue)
          .map(([key]) => key);
        next = expandedValues.filter((item) => !siblings.includes(item));
        next.push(subValue);
      } else {
        next = [...expandedValues, subValue];
      }

      setExpandedValues(next);
    },
    [expandMutex, expandedValues, setExpandedValues],
  );

  const isExpanded = useCallback(
    (subValue: MenuValue) => expandedValues.includes(subValue),
    [expandedValues],
  );

  const isActive = useCallback(
    (itemValue: MenuValue) => activeValue === itemValue,
    [activeValue],
  );

  const contextValue = useMemo<MenuContextValue>(
    () => ({
      mode,
      theme,
      collapsed,
      expandMutex,
      expandType,
      activeValue,
      expanded: expandedValues,
      setActiveValue,
      toggleExpand,
      isExpanded,
      isActive,
      level: 0,
      parentSubmenuValue: null,
      registerSubmenu,
      unregisterSubmenu,
    }),
    [
      mode,
      theme,
      collapsed,
      expandMutex,
      expandType,
      activeValue,
      expandedValues,
      setActiveValue,
      toggleExpand,
      isExpanded,
      isActive,
      registerSubmenu,
      unregisterSubmenu,
    ],
  );

  return <MenuContext.Provider value={contextValue}>{children}</MenuContext.Provider>;
}

interface SubmenuLevelProviderProps {
  level: number;
  parentSubmenuValue: MenuValue;
  children: ReactNode;
}

export function SubmenuLevelProvider({
  level,
  parentSubmenuValue,
  children,
}: SubmenuLevelProviderProps) {
  const parent = useMenuContext();
  const value = useMemo(
    () => ({
      ...parent,
      level,
      parentSubmenuValue,
    }),
    [parent, level, parentSubmenuValue],
  );
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}
