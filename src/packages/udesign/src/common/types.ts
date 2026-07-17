import type { CSSProperties, ReactNode } from 'react';

/** 通用节点内容 */
export type TNode = ReactNode;

/** 挂载节点：选择器字符串或返回 DOM 的函数 */
export type AttachNode = string | (() => HTMLElement | null) | HTMLElement | null;

/** 类名：字符串 / 数组 / 条件对象 */
export type ClassName =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassName[]
  | Record<string, boolean | undefined | null>;

/** 样式对象或 false（兼容 Boolean 类型描述） */
export type Styles = CSSProperties | boolean;

/**
 * 合并 className
 */
export function cx(...args: ClassName[]): string {
  const list: string[] = [];

  const push = (value: ClassName): void => {
    if (!value && value !== 0) return;
    if (typeof value === 'string' || typeof value === 'number') {
      list.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, enabled]) => {
        if (enabled) list.push(key);
      });
    }
  };

  args.forEach(push);
  return list.join(' ');
}

/**
 * 解析挂载节点
 */
export function resolveAttach(attach: AttachNode = 'body'): HTMLElement {
  if (typeof document === 'undefined') {
    return null as unknown as HTMLElement;
  }
  if (!attach) return document.body;
  if (typeof attach === 'string') {
    return (document.querySelector(attach) as HTMLElement | null) ?? document.body;
  }
  if (typeof attach === 'function') {
    return attach() ?? document.body;
  }
  return attach;
}

/**
 * 解析 delay：[显示延迟, 隐藏延迟]
 */
export function resolveDelay(
  delay?: number | number[],
  fallback: [number, number] = [250, 150],
): [number, number] {
  if (delay == null) return fallback;
  if (typeof delay === 'number') return [delay, delay];
  if (Array.isArray(delay)) {
    const show = delay[0] ?? fallback[0];
    const hide = delay[1] ?? delay[0] ?? fallback[1];
    return [show, hide];
  }
  return fallback;
}
