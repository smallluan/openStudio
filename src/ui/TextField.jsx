import { Input } from "@open-studio/udesign";

/**
 * @param {import("react").ChangeEvent<HTMLInputElement>} value
 * @param {{ e?: import("react").SyntheticEvent }} [ctx]
 */
function toDomChangeEvent(value, ctx) {
  const e = ctx?.e;
  if (
    e &&
    typeof e === "object" &&
    "target" in e &&
    e.target &&
    typeof e.target === "object" &&
    "value" in e.target
  ) {
    return /** @type {import("react").ChangeEvent<HTMLInputElement>} */ (e);
  }
  return /** @type {import("react").ChangeEvent<HTMLInputElement>} */ ({
    target: { value },
    currentTarget: { value },
  });
}

/** Native input compatibility wrapper around UDesign Input. */
export default function TextField({
  className,
  block = true,
  size,
  type = "text",
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  onKeyPress,
  onKeyUp,
  autoFocus,
  autoComplete,
  spellCheck,
  readOnly,
  ...props
}) {
  const input = (
    <Input
      block={block}
      size={size}
      type={type}
      autofocus={autoFocus}
      autocomplete={autoComplete}
      spellCheck={spellCheck}
      readOnly={readOnly}
      onChange={
        onChange ?
          (value, ctx) => onChange(toDomChangeEvent(value, ctx))
        : undefined
      }
      onBlur={
        onBlur ?
          (value, ctx) => onBlur(toDomChangeEvent(value, ctx))
        : undefined
      }
      onFocus={
        onFocus ?
          (value, ctx) => onFocus(toDomChangeEvent(value, ctx))
        : undefined
      }
      onKeydown={
        onKeyDown ?
          (_value, ctx) => {
            if (ctx?.e) onKeyDown(ctx.e);
          }
        : undefined
      }
      onKeypress={
        onKeyPress ?
          (_value, ctx) => {
            if (ctx?.e) onKeyPress(ctx.e);
          }
        : undefined
      }
      onKeyup={
        onKeyUp ?
          (_value, ctx) => {
            if (ctx?.e) onKeyUp(ctx.e);
          }
        : undefined
      }
      {...props}
    />
  );

  if (className) {
    return <div className={className}>{input}</div>;
  }

  return input;
}
