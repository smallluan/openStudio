import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useId, useState } from "react";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

/**
 * Context window gauge + compact two-line hover tooltip.
 * @param {{ ratio: number; ariaSummary: string; line1: string; line2: string }} props
 */
export function ChatLabContextMeter({ ratio, ariaSummary, line1, line2 }) {
  const [open, setOpen] = useState(false);
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);
  const tooltipId = useId();

  const r = 10;
  const hi = ratio >= 0.92;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.min(1, ratio));
  const mid = !hi && ratio >= 0.78;
  const stroke = hi ? "#e53935" : mid ? "#d97706" : "color-mix(in srgb, var(--os-accent) 82%, var(--os-text-muted))";

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "top-end",
    strategy: "fixed",
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: 80, close: 140 },
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      <button
        type="button"
        className={cn("chat-lab__ctx-ring-wrap", present && "chat-lab__ctx-ring-wrap--open")}
        ref={refs.setReference}
        aria-label={ariaSummary}
        aria-describedby={present ? tooltipId : undefined}
        {...getReferenceProps()}
      >
        <svg className="chat-lab__ctx-ring-svg" width="34" height="34" viewBox="0 0 34 34" aria-hidden>
          <circle
            cx="17"
            cy="17"
            r={r}
            fill="none"
            className="chat-lab__ctx-ring-track"
            strokeWidth="3"
          />
          <circle
            cx="17"
            cy="17"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 17 17)"
            className="chat-lab__ctx-ring-fill"
          />
        </svg>
      </button>

      {present ? (
        <FloatingPortal>
          <div
            id={tooltipId}
            ref={refs.setFloating}
            style={floatingStyles}
            className="chat-lab__ctx-stats-popover outline-none"
            {...getFloatingProps()}
          >
            <FluidPopupAnimatedSurface
              key={surfaceKey}
              leaving={leaving}
              finishLeave={finishLeave}
              placement={context.placement}
              morphBr="10px"
              className="chat-lab__ctx-stats-popover__surface"
            >
              <div className="chat-lab__ctx-stats-popover__line">{line1}</div>
              <div className="chat-lab__ctx-stats-popover__line">{line2}</div>
            </FluidPopupAnimatedSurface>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
