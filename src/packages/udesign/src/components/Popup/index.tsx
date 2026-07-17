import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type Middleware,
} from '@floating-ui/react';
import { cx, resolveAttach, resolveDelay } from '../../common/types';
import {
  isEmptyPopupContent,
  POPUP_PLACEMENT_MAP,
  resolveOverlayStyle,
  type PopupProps,
  type PopupVisibleChangeContext,
} from './type';
import './index.less';

const DEFAULT_Z_INDEX = 5500;
const SCROLL_BOTTOM_THRESHOLD = 2;

function getTriggerNode(trigger: string | ReactNode | undefined): ReactNode {
  if (typeof trigger === 'string') {
    return <span className="udesign-popup__trigger-text">{trigger}</span>;
  }
  return trigger ?? null;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

/**
 * Popup 弹出层：基于 Floating UI，默认 flip + shift 自动避障
 */
export default function Popup(props: PopupProps) {
  const {
    attach = 'body',
    children,
    content,
    delay,
    destroyOnClose = false,
    disabled = false,
    hideEmptyPopup = false,
    overlayClassName,
    overlayInnerClassName,
    overlayInnerStyle,
    overlayStyle,
    placement = 'top',
    popperOptions,
    showArrow = false,
    trigger = 'hover',
    triggerElement,
    visible,
    defaultVisible = false,
    zIndex = DEFAULT_Z_INDEX,
    onOverlayClick,
    onScroll,
    onScrollToBottom,
    onVisibleChange,
    className,
    style,
  } = props;

  const isControlled = visible !== undefined;
  const [innerVisible, setInnerVisible] = useState(defaultVisible);
  const [mounted, setMounted] = useState(false);
  const [hasOpened, setHasOpened] = useState(defaultVisible || !!visible);
  const [styleTick, setStyleTick] = useState(0);

  const open = isControlled ? !!visible : innerVisible;
  const [showDelay, hideDelay] = resolveDelay(delay);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrowRef = useRef<HTMLSpanElement | null>(null);
  const triggerElRef = useRef<HTMLElement | null>(null);
  const floatingElRef = useRef<HTMLDivElement | null>(null);

  const triggerContent = getTriggerNode(triggerElement ?? children);
  const emptyContent = isEmptyPopupContent(content);
  const shouldHideEmpty = hideEmptyPopup && emptyContent;

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const setVisible = useCallback(
    (next: boolean, context: PopupVisibleChangeContext = {}) => {
      if (disabled && next) return;
      if (shouldHideEmpty && next) return;

      clearTimers();
      if (!isControlled) {
        setInnerVisible(next);
      }
      if (next) setHasOpened(true);
      onVisibleChange?.(next, context);
    },
    [clearTimers, disabled, isControlled, onVisibleChange, shouldHideEmpty],
  );

  const scheduleShow = useCallback(
    (context: PopupVisibleChangeContext, wait = showDelay) => {
      if (disabled || shouldHideEmpty) return;
      clearTimers();
      if (wait <= 0) {
        setVisible(true, context);
        return;
      }
      showTimerRef.current = setTimeout(() => {
        setVisible(true, context);
      }, wait);
    },
    [clearTimers, disabled, setVisible, shouldHideEmpty, showDelay],
  );

  const scheduleHide = useCallback(
    (context: PopupVisibleChangeContext, wait = hideDelay) => {
      clearTimers();
      if (wait <= 0) {
        setVisible(false, context);
        return;
      }
      hideTimerRef.current = setTimeout(() => {
        setVisible(false, context);
      }, wait);
    },
    [clearTimers, hideDelay, setVisible],
  );

  useEffect(() => {
    setMounted(true);
    return () => clearTimers();
  }, [clearTimers]);

  const floatingPlacement = POPUP_PLACEMENT_MAP[placement] ?? 'top';
  const boundaryPadding = popperOptions?.boundaryPadding ?? 8;
  const offsetOption = popperOptions?.offset ?? (showArrow ? 10 : 8);

  const middleware = useMemo(() => {
    if (popperOptions?.middleware) return popperOptions.middleware;

    const list: Middleware[] = [offset(offsetOption)];

    if (popperOptions?.flip !== false) {
      list.push(
        flip({
          padding: boundaryPadding,
          fallbackAxisSideDirection: 'start',
        }),
      );
    }
    if (popperOptions?.shift !== false) {
      list.push(shift({ padding: boundaryPadding }));
    }
    if (showArrow) {
      list.push(
        arrow({
          element: arrowRef,
          padding: 6,
        }),
      );
    }
    return list;
  }, [
    boundaryPadding,
    offsetOption,
    popperOptions?.flip,
    popperOptions?.middleware,
    popperOptions?.shift,
    showArrow,
  ]);

  const { refs, floatingStyles, middlewareData, placement: actualPlacement } =
    useFloating({
      open,
      placement: floatingPlacement,
      strategy: popperOptions?.strategy ?? 'fixed',
      middleware,
      whileElementsMounted: autoUpdate,
    });

  const setReference = useCallback(
    (node: HTMLElement | null) => {
      triggerElRef.current = node;
      refs.setReference(node);
    },
    [refs],
  );

  const setFloating = useCallback(
    (node: HTMLDivElement | null) => {
      floatingElRef.current = node;
      refs.setFloating(node);
      if (node) setStyleTick((v) => v + 1);
    },
    [refs],
  );

  // 点击外部关闭（click / mousedown / context-menu）
  useEffect(() => {
    if (!open) return;
    if (trigger === 'hover' || trigger === 'focus') return;

    const onDocPointer = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerElRef.current?.contains(target)) return;
      if (floatingElRef.current?.contains(target)) return;
      setVisible(false, {
        e: e as unknown as PopupVisibleChangeContext['e'],
        trigger: 'document',
      });
    };

    document.addEventListener('mousedown', onDocPointer, true);
    return () => document.removeEventListener('mousedown', onDocPointer, true);
  }, [open, setVisible, trigger]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVisible(false, {
          e: e as unknown as ReactKeyboardEvent,
          trigger: 'keydown-esc',
        });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, setVisible]);

  const arrowStyle = useMemo((): CSSProperties | undefined => {
    const arrowData = middlewareData.arrow;
    if (!showArrow || !arrowData) return undefined;
    const { x, y } = arrowData;
    const side = actualPlacement.split('-')[0] as
      | 'top'
      | 'bottom'
      | 'left'
      | 'right';
    const staticSide: Record<string, keyof CSSProperties> = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
    };
    return {
      left: x != null ? `${x}px` : '',
      top: y != null ? `${y}px` : '',
      right: '',
      bottom: '',
      [staticSide[side]]: '-4px',
    };
  }, [actualPlacement, middlewareData.arrow, showArrow]);

  // styleTick：浮层挂载后重新解析函数式 overlayStyle
  void styleTick;
  const resolvedOverlayStyle = resolveOverlayStyle(
    overlayStyle,
    triggerElRef.current,
    floatingElRef.current,
  );
  const resolvedInnerStyle = resolveOverlayStyle(
    overlayInnerStyle,
    triggerElRef.current,
    floatingElRef.current,
  );

  const handleScroll = (e: ReactWheelEvent<HTMLDivElement>) => {
    onScroll?.({ e });
    const el = e.currentTarget;
    const reachedBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <=
      SCROLL_BOTTOM_THRESHOLD;
    if (reachedBottom) {
      onScrollToBottom?.({ e });
    }
  };

  const triggerProps: Record<string, unknown> = {};

  if (!disabled) {
    if (trigger === 'hover') {
      triggerProps.onMouseEnter = (e: ReactMouseEvent) => {
        scheduleShow({ e, trigger: 'trigger-element-hover' });
      };
      triggerProps.onMouseLeave = (e: ReactMouseEvent) => {
        scheduleHide({ e, trigger: 'trigger-element-hover' });
      };
    } else if (trigger === 'click') {
      triggerProps.onClick = (e: ReactMouseEvent) => {
        e.stopPropagation();
        setVisible(!open, { e, trigger: 'trigger-element-click' });
      };
    } else if (trigger === 'focus') {
      triggerProps.onFocus = (e: ReactFocusEvent) => {
        scheduleShow({ e, trigger: 'trigger-element-focus' }, showDelay);
      };
      triggerProps.onBlur = (e: ReactFocusEvent) => {
        scheduleHide({ e, trigger: 'trigger-element-blur' }, hideDelay);
      };
    } else if (trigger === 'mousedown') {
      triggerProps.onMouseDown = (e: ReactMouseEvent) => {
        e.stopPropagation();
        setVisible(!open, { e, trigger: 'trigger-element-mousedown' });
      };
    } else if (trigger === 'context-menu') {
      triggerProps.onContextMenu = (e: ReactMouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setVisible(true, { e, trigger: 'context-menu' });
      };
    }
  }

  const renderTrigger = () => {
    if (isValidElement(triggerContent)) {
      const element = triggerContent as ReactElement<{
        ref?: Ref<HTMLElement>;
        [key: string]: unknown;
      }>;
      const childProps = element.props ?? {};

      const compose =
        (key: string, ours: unknown) =>
        (...args: unknown[]) => {
          const theirs = childProps[key];
          if (typeof theirs === 'function') {
            (theirs as (...a: unknown[]) => void)(...args);
          }
          if (typeof ours === 'function') {
            (ours as (...a: unknown[]) => void)(...args);
          }
        };

      const composed: Record<string, unknown> = {
        ref: (node: HTMLElement | null) => {
          setReference(node);
          assignRef(childProps.ref, node);
        },
      };
      Object.keys(triggerProps).forEach((key) => {
        composed[key] = compose(key, triggerProps[key]);
      });

      return cloneElement(element, composed);
    }

    return (
      <span
        ref={setReference}
        className="udesign-popup__trigger"
        tabIndex={trigger === 'focus' ? 0 : undefined}
        {...triggerProps}
      >
        {triggerContent}
      </span>
    );
  };

  const shouldRenderPopup =
    mounted &&
    !disabled &&
    !shouldHideEmpty &&
    (destroyOnClose ? open : hasOpened || open);

  const popupNode = shouldRenderPopup ? (
    <div
      ref={setFloating}
      className={cx(
        'udesign-popup__overlay',
        open && 'udesign-popup__overlay--visible',
        !open && 'udesign-popup__overlay--hidden',
        showArrow && 'udesign-popup__overlay--with-arrow',
        `udesign-popup__overlay--${actualPlacement.split('-')[0]}`,
        overlayClassName,
      )}
      style={{
        ...floatingStyles,
        zIndex,
        ...resolvedOverlayStyle,
        visibility: open ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
      data-popper-placement={actualPlacement}
      onMouseEnter={
        trigger === 'hover'
          ? (e) => {
              clearTimers();
              if (!open) {
                setVisible(true, { e, trigger: 'trigger-element-hover' });
              }
            }
          : undefined
      }
      onMouseLeave={
        trigger === 'hover'
          ? (e) => scheduleHide({ e, trigger: 'trigger-element-hover' })
          : undefined
      }
      onClick={(e) => onOverlayClick?.({ e })}
    >
      <div
        className={cx('udesign-popup__content', overlayInnerClassName)}
        style={resolvedInnerStyle}
        onScroll={handleScroll}
        onWheel={handleScroll}
      >
        {content}
      </div>
      {showArrow ? (
        <span
          ref={arrowRef}
          className="udesign-popup__arrow"
          style={arrowStyle}
          aria-hidden
        />
      ) : null}
    </div>
  ) : null;

  const portalContainer = mounted ? resolveAttach(attach) : null;

  return (
    <span className={cx('udesign-popup', className)} style={style}>
      {renderTrigger()}
      {popupNode && portalContainer
        ? createPortal(popupNode, portalContainer)
        : null}
    </span>
  );
}
