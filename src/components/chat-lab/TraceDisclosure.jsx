import { createContext, useCallback, useContext, useId, useState } from "react";
import { cn } from "../../ui/cn.js";

/** @type {import("react").Context<{ open: boolean }>} */
const TraceDisclosureCtx = createContext({ open: false });

/** @returns {{ open: boolean }} */
export function useTraceDisclosureOpen() {
  return useContext(TraceDisclosureCtx);
}

/** Section / panel chevron (left of title). */
export function TraceDisclosureChevron({ className }) {
  const { open } = useTraceDisclosureOpen();
  return (
    <svg
      className={cn("trace-disclosure__chevron-svg", className)}
      data-open={open}
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Right-side row affordance; thin stroke, rotated when open. */
export function TraceRowChevron({ className }) {
  const { open } = useTraceDisclosureOpen();
  return (
    <span className={cn("trace-disclosure__row-chevron", className)} data-open={open} aria-hidden>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
        <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * @param {{ state: "ok" | "run" | "fail" }} props
 */
export function TraceStepGlyph({ state }) {
  const vb = "0 0 16 16";
  const sw = { ring: "1.12", fail: "1.12", dash: "1.08", check: "1.28" };

  if (state === "fail") {
    return (
      <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--fail")} width="16" height="16" viewBox={vb} aria-hidden>
        <circle cx="8" cy="8" r="7.2" stroke="currentColor" fill="none" strokeWidth={sw.fail} />
        <path d="M5.35 5.35l5.3 5.3M10.65 5.35l-5.3 5.3" stroke="currentColor" strokeWidth={sw.fail} strokeLinecap="round" />
      </svg>
    );
  }

  if (state === "run") {
    return (
      <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--run")} width="16" height="16" viewBox={vb} aria-hidden>
        <circle
          cx="8"
          cy="8"
          r="7"
          stroke="currentColor"
          fill="none"
          strokeWidth={sw.dash}
          strokeDasharray="2.6 2.9"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
    );
  }

  return (
    <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--ok")} width="16" height="16" viewBox={vb} aria-hidden>
      <circle cx="8" cy="8" r="7.1" fill="none" stroke="currentColor" strokeWidth={sw.ring} />
      <path
        d="M4.75 8.25l2.2 2.35 4.35-6.05"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw.check}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Animated disclosure with grid row transition (replacing `<details>`).
 * @param {{
 *   defaultOpen?: boolean;
 *   open?: boolean;
 *   onOpenChange?: (next: boolean) => void;
 *   expandable?: boolean;
 *   variant?: "section" | "row";
 *   className?: string;
 *   triggerClassName?: string;
 *   triggerAriaLabel?: string;
 *   panelClassName?: string;
 *   panelInnerClassName?: string;
 *   chevronBefore?: boolean;
 *   summary: import("react").ReactNode | ((expanded: boolean) => import("react").ReactNode);
 *   children: import("react").ReactNode;
 * }} props
 */
export function TraceDisclosure({
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  expandable = true,
  variant = "section",
  className,
  triggerClassName,
  triggerAriaLabel,
  panelClassName,
  panelInnerClassName,
  chevronBefore = true,
  summary,
  children,
}) {
  const autoId = useId();
  const panelId = `trace-panel-${autoId}`;
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const controlled = typeof controlledOpen === "boolean";
  const expanded = controlled ? controlledOpen : innerOpen;

  const setExpanded = useCallback(
    (next) => {
      if (!expandable) return;
      if (controlled) onOpenChange?.(next);
      else setInnerOpen(next);
    },
    [controlled, expandable, onOpenChange],
  );

  const summaryNode = typeof summary === "function" ? summary(expanded) : summary;

  if (!expandable) {
    return (
      <div
        className={cn("trace-disclosure trace-disclosure--static", variant === "row" && "trace-disclosure--row-static", className)}
        data-open="false"
      >
        <div
          className={cn(
            "trace-disclosure__trigger trace-disclosure__trigger--static",
            variant === "row" && "trace-disclosure__trigger--row",
            triggerClassName,
          )}
          aria-label={triggerAriaLabel}
        >
          {summaryNode}
        </div>
      </div>
    );
  }

  return (
    <TraceDisclosureCtx.Provider value={{ open: expanded }}>
      <div
        className={cn("trace-disclosure", variant === "row" && "trace-disclosure--row", className)}
        data-open={expanded}
      >
        <button
          type="button"
          id={`${panelId}-btn`}
          className={cn(
            "trace-disclosure__trigger",
            variant === "row" && "trace-disclosure__trigger--row",
            triggerClassName,
          )}
          aria-label={triggerAriaLabel}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
        >
          {chevronBefore ? <TraceDisclosureChevron className="chat-lab__tool-chain-chevron" /> : null}
          {summaryNode}
        </button>
        <div
          id={panelId}
          role="region"
          aria-labelledby={`${panelId}-btn`}
          className={cn("trace-disclosure__panel", panelClassName)}
          data-open={expanded}
        >
          <div className="trace-disclosure__panel-measure">
            <div className={cn("trace-disclosure__panel-inner", panelInnerClassName)}>{children}</div>
          </div>
        </div>
      </div>
    </TraceDisclosureCtx.Provider>
  );
}
