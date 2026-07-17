import { forwardRef } from 'react';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  Ref,
} from 'react';
import type { ButtonProps } from './type';
import './index.less';

/**
 * Button 按钮组件
 */
const Button = forwardRef<HTMLElement, ButtonProps>((props, ref) => {
  const {
    className = '',
    style,
    block = false,
    children,
    content,
    disabled = false,
    form,
    ghost = false,
    href,
    icon,
    loading = false,
    shape = 'rectangle',
    size = 'medium',
    suffix,
    tag,
    theme,
    type = 'button',
    variant = 'base',
    onClick,
    ...restProps
  } = props;

  const getTagName = (): 'button' | 'a' | 'div' => {
    if (tag) return tag;
    if (href) return 'a';
    return 'button';
  };

  const TagName = getTagName();

  const renderContent = () => {
    const displayContent = children ?? content;

    return (
      <>
        {loading && (
          <span className="udesign-btn__loading" aria-hidden>
            <svg
              className="udesign-btn__loading-icon"
              viewBox="0 0 16 16"
              width="1em"
              height="1em"
              focusable="false"
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
          </span>
        )}
        {icon && !loading && <span className="udesign-btn__icon">{icon}</span>}
        {displayContent && (
          <span className="udesign-btn__text">{displayContent}</span>
        )}
        {suffix && <span className="udesign-btn__suffix">{suffix}</span>}
      </>
    );
  };

  const classNames = [
    'udesign-btn',
    `udesign-btn--size-${size}`,
    `udesign-btn--shape-${shape}`,
    `udesign-btn--variant-${variant}`,
    block && 'udesign-btn--block',
    disabled && 'udesign-btn--disabled',
    ghost && 'udesign-btn--ghost',
    loading && 'udesign-btn--loading',
    theme && `udesign-btn--theme-${theme}`,
    icon && 'udesign-btn--has-icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (disabled || loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  if (TagName === 'button') {
    const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
      ...(restProps as ButtonHTMLAttributes<HTMLButtonElement>),
      className: classNames,
      style,
      type,
      disabled,
      form,
      onClick: handleClick as ButtonHTMLAttributes<HTMLButtonElement>['onClick'],
    };

    return (
      <button ref={ref as Ref<HTMLButtonElement>} {...buttonProps}>
        {renderContent()}
      </button>
    );
  }

  if (TagName === 'a') {
    const anchorProps: AnchorHTMLAttributes<HTMLAnchorElement> = {
      ...(restProps as AnchorHTMLAttributes<HTMLAnchorElement>),
      className: classNames,
      style,
      href: disabled ? undefined : href,
      onClick: handleClick as AnchorHTMLAttributes<HTMLAnchorElement>['onClick'],
    };

    return (
      <a ref={ref as Ref<HTMLAnchorElement>} {...anchorProps}>
        {renderContent()}
      </a>
    );
  }

  const divProps: HTMLAttributes<HTMLDivElement> = {
    ...(restProps as HTMLAttributes<HTMLDivElement>),
    className: classNames,
    style,
    onClick: handleClick as HTMLAttributes<HTMLDivElement>['onClick'],
  };

  return (
    <div ref={ref as Ref<HTMLDivElement>} {...divProps}>
      {renderContent()}
    </div>
  );
});

Button.displayName = 'Button';

export default Button;
