import { cn } from "./cn.js";

/**
 * Inner shell for Floating UI popovers: droplet enter/leave animations (see `.os-popup-surface` in index.css).
 * Parent should pass `key={surfaceKey}` so each open cycle replays the entrance motion.
 *
 * @param {{
 *   leaving: boolean;
 *   finishLeave: () => void;
 *   placement?: string;
 *   morphBr: string;
 *   centered?: boolean;
 *   className?: string;
 *   surfaceProps?: import("react").HTMLAttributes<HTMLDivElement>;
 *   children: import("react").ReactNode;
 * }} props
 */
export default function FluidPopupAnimatedSurface({
  leaving,
  finishLeave,
  placement,
  morphBr,
  centered = false,
  className,
  surfaceProps,
  children,
}) {
  const sp = surfaceProps ?? {};
  const {
    className: spClassName,
    style: spStyle,
    onAnimationEnd: spOnAnimationEnd,
    ...spRest
  } = sp;

  return (
    <div
      {...spRest}
      {...(placement != null && !centered ? { "data-placement": placement } : {})}
      style={{
        "--os-popup-morph-br": morphBr,
        ...(typeof spStyle === "object" && spStyle ? /** @type {Record<string, string | number>} */ (spStyle) : {}),
      }}
      className={cn(
        "os-popup-surface",
        centered && "os-popup-surface--centered",
        leaving && "os-popup-surface--exit",
        className,
        spClassName,
      )}
      onAnimationEnd={(e) => {
        spOnAnimationEnd?.(e);
        if (e.target !== e.currentTarget) return;
        if (leaving) finishLeave();
      }}
    >
      {children}
    </div>
  );
}
