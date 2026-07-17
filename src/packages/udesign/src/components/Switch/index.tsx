import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { SwitchProps, SwitchSlot, SwitchValue } from './type';
import './index.less';

const DEFAULT_CUSTOM_VALUE: [boolean, boolean] = [true, false];

function isPromiseLike(value: unknown): value is PromiseLike<boolean> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as PromiseLike<boolean>).then === 'function'
  );
}

function resolveSlot<T extends SwitchValue>(
  slot: SwitchSlot<T> | undefined,
  checked: boolean,
  value: T,
): ReactNode {
  if (slot == null) return null;
  if (typeof slot === 'function') return slot({ value });
  if (Array.isArray(slot)) {
    return (checked ? slot[0] : slot[1]) ?? null;
  }
  return slot;
}

function LoadingIcon() {
  return (
    <svg
      className="udesign-switch__loading-icon"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      focusable="false"
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 1-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Switch 开关组件
 */
const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  props,
  ref,
) {
  const {
    className = '',
    style,
    beforeChange,
    customValue = DEFAULT_CUSTOM_VALUE as [SwitchValue, SwitchValue],
    disabled = false,
    label,
    icon,
    iconPlacement = 'inside',
    labelPlacement = 'outside',
    loading = false,
    size = 'medium',
    value,
    defaultValue,
    onChange,
  } = props;

  const [onValue, offValue] = customValue;
  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState<SwitchValue>(
    () => defaultValue ?? offValue,
  );
  const [pending, setPending] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pendingRef = useRef(false);

  const currentValue = isControlled ? value : innerValue;
  const checked = Object.is(currentValue, onValue);
  const isLoading = loading || pending;
  const isDisabled = disabled || isLoading;

  const iconNode = resolveSlot(icon, checked, currentValue);
  const labelNode = resolveSlot(label, checked, currentValue);

  // 同区优先图标；loading 始终占滑块内部
  const handleInner = isLoading ? (
    <LoadingIcon />
  ) : iconPlacement === 'inside' && iconNode != null ? (
    iconNode
  ) : labelPlacement === 'inside' && labelNode != null ? (
    labelNode
  ) : null;

  const trackContent =
    iconPlacement === 'outside' && iconNode != null
      ? iconNode
      : labelPlacement === 'outside' && labelNode != null
        ? labelNode
        : null;

  const hasTrackContent = trackContent != null && trackContent !== false;

  const applyChange = useCallback(
    (next: SwitchValue, e: ReactMouseEvent<HTMLButtonElement>) => {
      if (!isControlled) {
        setInnerValue(next);
      }
      onChange?.(next, { e });
    },
    [isControlled, onChange],
  );

  const handleClick = async (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (isDisabled || pendingRef.current) {
      return;
    }

    const next = checked ? offValue : onValue;

    if (beforeChange) {
      try {
        pendingRef.current = true;
        setPending(true);
        const result = beforeChange();
        const allowed = isPromiseLike(result) ? await result : result;
        if (allowed === false) {
          return;
        }
      } catch {
        return;
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    }

    applyChange(next, e);
  };

  const setPressedState = (next: boolean) => {
    if (isDisabled) return;
    setPressed(next);
  };

  const classNames = [
    'udesign-switch',
    `udesign-switch--size-${size}`,
    checked && 'udesign-switch--checked',
    isDisabled && 'udesign-switch--disabled',
    isLoading && 'udesign-switch--loading',
    pressed && 'udesign-switch--pressed',
    hasTrackContent && 'udesign-switch--with-content',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={isDisabled || undefined}
      aria-busy={isLoading || undefined}
      disabled={disabled}
      className={classNames}
      style={style}
      onClick={handleClick}
      onPointerDown={() => setPressedState(true)}
      onPointerUp={() => setPressedState(false)}
      onPointerLeave={() => setPressedState(false)}
      onPointerCancel={() => setPressedState(false)}
    >
      {hasTrackContent && (
        <span className="udesign-switch__content" aria-hidden>
          {trackContent}
        </span>
      )}
      <span className="udesign-switch__handle">
        {handleInner != null && handleInner !== false && (
          <span className="udesign-switch__handle-inner">{handleInner}</span>
        )}
      </span>
    </button>
  );
});

Switch.displayName = 'Switch';

export default Switch;
