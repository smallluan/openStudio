import { Popup } from "tdesign-react";
import { OS_POPUP_INNER_CLASS, OS_POPUP_OVERLAY_CLASS, osPopupPopperOptions } from "../../ui/osPopupShared.js";
import { cn } from "../../ui/cn.js";

/**
 * Context window gauge - shows ring by default, details on hover.
 * @param {{ ratio: number; ariaSummary: string; percentText: string; line1: string; line2: string }} props
 */
export function ChatLabContextMeter({ ratio, ariaSummary, percentText, line1, line2 }) {
  const r = 10;
  const hi = ratio >= 0.92;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.min(1, ratio));
  const mid = !hi && ratio >= 0.78;
  const stroke = hi ? "#e53935" : mid ? "#d97706" : "color-mix(in srgb, var(--os-accent) 82%, var(--os-text-muted))";

  const popupContent = (
    <div
      className={cn(
        "flex flex-col gap-1 px-3 py-2",
        "text-[0.75rem] leading-snug text-[var(--os-text-muted)]",
        "rounded-[10px] border",
        "border-[color-mix(in_srgb,var(--os-border)_72%,transparent)]",
        "bg-[var(--os-bg-modal)]",
        "shadow-[var(--os-shadow-soft)]",
      )}
    >
      <div>{line1}</div>
      <div>{line2}</div>
    </div>
  );

  return (
    <Popup
      trigger="hover"
      placement="top"
      showArrow={false}
      zIndex={500}
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={OS_POPUP_INNER_CLASS}
      popperOptions={osPopupPopperOptions(8, 8)}
      content={popupContent}
    >
      <span
        className="chat-lab__ctx-ring-wrap chat-lab__ctx-ring-wrap--standalone"
        role="img"
        aria-label={ariaSummary}
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
      </span>
    </Popup>
  );
}
