/**
 * Context window gauge with inline percentage label.
 * @param {{ ratio: number; ariaSummary: string; percentText: string }} props
 */
export function ChatLabContextMeter({ ratio, ariaSummary, percentText }) {

  const r = 10;
  const hi = ratio >= 0.92;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.min(1, ratio));
  const mid = !hi && ratio >= 0.78;
  const stroke = hi ? "#e53935" : mid ? "#d97706" : "color-mix(in srgb, var(--os-accent) 82%, var(--os-text-muted))";

  return (
    <div className="chat-lab__ctx-inline" role="img" aria-label={ariaSummary}>
      <span className="chat-lab__ctx-percent" aria-hidden>
        {percentText}
      </span>
      <span className="chat-lab__ctx-ring-wrap" aria-hidden>
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
    </div>
  );
}
