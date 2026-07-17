import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import { cx } from '../../common/types';
import type { InputProps, InputValue } from './type';
import {
  getMaxLimit,
  getValueLength,
  isExceedLimit,
  limitValue,
} from './utils';
import './index.less';

function ClearIcon() {
  return (
    <svg
      className="udesign-input__clear-icon"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      focusable="false"
      aria-hidden
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.08" />
      <path
        d="M5.5 5.5l5 5M10.5 5.5l-5 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Input 输入框组件
 */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  props,
  ref,
) {
  const {
    className = '',
    style,
    align = 'left',
    allowInputOverMax = false,
    autoWidth = false,
    autocomplete,
    autofocus = false,
    borderless = false,
    block = false,
    clearable = false,
    disabled,
    format,
    inputClass,
    label,
    maxcharacter,
    maxlength,
    name,
    placeholder,
    prefixIcon,
    readOnly = false,
    showClearIconOnEmpty = false,
    showLimitNumber = false,
    size = 'medium',
    spellCheck = false,
    status = 'default',
    suffix,
    suffixIcon,
    tips,
    type = 'text',
    value,
    defaultValue = '',
    onBlur,
    onChange,
    onClear,
    onClick,
    onCompositionend,
    onCompositionstart,
    onEnter,
    onFocus,
    onKeydown,
    onKeypress,
    onKeyup,
    onMouseenter,
    onMouseleave,
    onPaste,
    onValidate,
    onWheel,
    id,
    ...restProps
  } = props;

  const limitOptions = { maxcharacter, maxlength };
  const maxLimit = getMaxLimit(limitOptions);

  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState<InputValue>(() => {
    const initial = defaultValue ?? '';
    return limitValue(initial, limitOptions);
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const composingRef = useRef(false);
  const initialNotifiedRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mirrorWidth, setMirrorWidth] = useState<number>();

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const currentValue = isControlled ? (value ?? '') : innerValue;

  const notifyChange = useCallback(
    (
      nextValue: InputValue,
      context?: Parameters<NonNullable<InputProps['onChange']>>[1],
    ) => {
      if (!isControlled) {
        setInnerValue(nextValue);
      }
      onChange?.(nextValue, context);
    },
    [isControlled, onChange],
  );

  const updateValue = useCallback(
    (
      rawValue: InputValue,
      context?: Parameters<NonNullable<InputProps['onChange']>>[1],
    ) => {
      let nextValue = rawValue;

      if (!allowInputOverMax) {
        nextValue = limitValue(rawValue, limitOptions);
      }

      if (isExceedLimit(nextValue, limitOptions)) {
        onValidate?.({ error: 'exceed-maximum' });
      }

      notifyChange(nextValue, context);
      return nextValue;
    },
    [allowInputOverMax, limitOptions, notifyChange, onValidate],
  );

  // 初始值超出限制时自动处理并通知
  useEffect(() => {
    if (initialNotifiedRef.current) return;
    initialNotifiedRef.current = true;

    const initial = isControlled ? (value ?? '') : (defaultValue ?? '');
    const limited = limitValue(initial, limitOptions);
    if (initial !== limited) {
      if (!isControlled) {
        setInnerValue(limited);
      }
      onChange?.(limited, { trigger: 'initial' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // autoWidth 测量
  useEffect(() => {
    if (!autoWidth || !mirrorRef.current) return;
    setMirrorWidth(mirrorRef.current.offsetWidth);
  }, [autoWidth, currentValue, format, placeholder, size]);

  const displayValue = format ? format(currentValue) : currentValue;

  const showClear =
    clearable &&
    !disabled &&
    !readOnly &&
    (currentValue.length > 0 || (showClearIconOnEmpty && hovered));

  const currentLength = getValueLength(currentValue, limitOptions);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (composingRef.current) return;
    updateValue(e.target.value, { e, trigger: 'input' });
  };

  const handleCompositionStart = (e: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = true;
    onCompositionstart?.(currentValue, { e });
  };

  const handleCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    updateValue(e.currentTarget.value, { e, trigger: 'input' });
    onCompositionend?.(e.currentTarget.value, { e });
  };

  const handleClear = (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || readOnly) return;
    notifyChange('', { e, trigger: 'clear' });
    onClear?.({ e });
    inputRef.current?.focus();
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    onFocus?.(currentValue, { e });
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(false);
    onBlur?.(currentValue, { e });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeydown?.(currentValue, { e });
    if (e.key === 'Enter') {
      onEnter?.(currentValue, { e });
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeypress?.(currentValue, { e });
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyup?.(currentValue, { e });
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasteValue = e.clipboardData.getData('text');
    onPaste?.({ e, pasteValue });
  };

  const handleWheel = (e: WheelEvent<HTMLInputElement>) => {
    onWheel?.({ e });
  };

  const handleMouseEnter = (e: MouseEvent<HTMLDivElement>) => {
    setHovered(true);
    onMouseenter?.({ e });
  };

  const handleMouseLeave = (e: MouseEvent<HTMLDivElement>) => {
    setHovered(false);
    onMouseleave?.({ e });
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    onClick?.({ e });
  };

  const wrapClassName = cx(
    'udesign-input-wrap',
    block && 'udesign-input-wrap--block',
    className,
  );

  const inputWrapClassName = cx(
    'udesign-input',
    `udesign-input--size-${size}`,
    `udesign-input--align-${align}`,
    `udesign-input--status-${status}`,
    borderless && 'udesign-input--borderless',
    disabled && 'udesign-input--disabled',
    readOnly && 'udesign-input--readonly',
    focused && 'udesign-input--focused',
    autoWidth && 'udesign-input--auto-width',
    prefixIcon ? 'udesign-input--with-prefix' : undefined,
    clearable ? 'udesign-input--clearable' : undefined,
    suffix || suffixIcon || showLimitNumber
      ? 'udesign-input--with-suffix'
      : undefined,
    label ? 'udesign-input--with-label' : undefined,
  );

  const innerClassName = cx('udesign-input__inner', inputClass);

  const inputStyle =
    autoWidth && mirrorWidth != null
      ? { width: Math.max(mirrorWidth + 2, 20) }
      : undefined;

  const tipsClassName = cx(
    'udesign-input__tips',
    status !== 'default' && `udesign-input__tips--${status}`,
  );

  return (
    <div className={wrapClassName} style={style}>
      <div
        className={inputWrapClassName}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {label != null && label !== false && (
          <span className="udesign-input__label">{label}</span>
        )}

        {prefixIcon && (
          <span className="udesign-input__prefix">{prefixIcon}</span>
        )}

        <span className="udesign-input__inner-wrap">
          <input
            ref={inputRef}
            id={id}
            className={innerClassName}
            style={inputStyle}
            type={type}
            name={name}
            value={displayValue}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            autoFocus={autofocus}
            autoComplete={autocomplete}
            spellCheck={spellCheck}
            maxLength={
              allowInputOverMax || maxcharacter != null ? undefined : maxlength
            }
            onChange={handleInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onKeyPress={handleKeyPress}
            onKeyUp={handleKeyUp}
            onPaste={handlePaste}
            onWheel={handleWheel}
            {...restProps}
          />

          {autoWidth && (
            <span ref={mirrorRef} className="udesign-input__mirror" aria-hidden>
              {displayValue || placeholder || ''}
            </span>
          )}

          {clearable && !disabled && !readOnly && (
            <span
              className={cx(
                'udesign-input__clear',
                showClear && 'udesign-input__clear--visible',
              )}
              role="button"
              tabIndex={-1}
              aria-label="clear"
              aria-hidden={!showClear}
              onClick={handleClear}
              onMouseDown={(e) => e.preventDefault()}
            >
              <ClearIcon />
            </span>
          )}
        </span>

        {(suffix != null && suffix !== false) && (
          <span className="udesign-input__suffix">{suffix}</span>
        )}

        {showLimitNumber && maxLimit != null && (
          <span className="udesign-input__limit">
            {currentLength}/{maxLimit}
          </span>
        )}

        {suffixIcon && (
          <span className="udesign-input__suffix-icon">{suffixIcon}</span>
        )}
      </div>

      {tips != null && tips !== false && (
        <div className={tipsClassName}>{tips}</div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
