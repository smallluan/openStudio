import { createContext, useCallback, useContext, useId, useRef, useState } from "react";
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
 * Tool-chain rows avoid the dashed “in progress” ring; use a compact dot instead.
 * @param {{ state: "ok" | "run" | "fail"; forToolChain?: boolean }} props
 */
export function TraceStepGlyph({ state, forToolChain = false }) {
  const vb = "0 0 16 16";
  const sz = 12;
  const sw = { ring: "1.12", fail: "1.12", dash: "1.08", check: "1.28" };

  if (state === "fail") {
    return (
      <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--fail")} width={sz} height={sz} viewBox={vb} aria-hidden>
        <circle cx="8" cy="8" r="7.2" stroke="currentColor" fill="none" strokeWidth={sw.fail} />
        <path d="M5.35 5.35l5.3 5.3M10.65 5.35l-5.3 5.3" stroke="currentColor" strokeWidth={sw.fail} strokeLinecap="round" />
      </svg>
    );
  }

  if (state === "run") {
    if (forToolChain) {
      return (
        <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--tool-run")} width={sz} height={sz} viewBox={vb} aria-hidden>
          <circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.5" />
        </svg>
      );
    }
    return (
      <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--run")} width={sz} height={sz} viewBox={vb} aria-hidden>
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
    <svg className={cn("chat-lab__step-glyph chat-lab__step-glyph--ok")} width={sz} height={sz} viewBox={vb} aria-hidden>
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
  const pointerRef = useRef(/** @type {{ moved: boolean; x: number; y: number }} */ ({ moved: false, x: 0, y: 0 }));

  const handleTriggerClick = useCallback(() => {
    const sel = window.getSelection();
    if (pointerRef.current.moved || (sel && !sel.isCollapsed && sel.toString().trim())) return;
    setExpanded(!expanded);
  }, [expanded, setExpanded]);

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
        <div
          id={`${panelId}-btn`}
          role="button"
          tabIndex={0}
          className={cn(
            "trace-disclosure__trigger",
            variant === "row" && "trace-disclosure__trigger--row",
            triggerClassName,
          )}
          aria-label={triggerAriaLabel}
          aria-expanded={expanded}
          aria-controls={panelId}
          onPointerDown={(e) => {
            pointerRef.current = { moved: false, x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0) return;
            const dx = Math.abs(e.clientX - pointerRef.current.x);
            const dy = Math.abs(e.clientY - pointerRef.current.y);
            if (dx > 3 || dy > 3) pointerRef.current.moved = true;
          }}
          onClick={handleTriggerClick}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            setExpanded(!expanded);
          }}
        >
          {chevronBefore ? <TraceDisclosureChevron className="chat-lab__tool-chain-chevron" /> : null}
          {summaryNode}
        </div>
        <div
          id={panelId}
          role="region"
          aria-labelledby={`${panelId}-btn`}
          className={cn("trace-disclosure__panel", panelClassName)}
          data-open={expanded}
        >
          <div className={cn("trace-disclosure__panel-measure")}>
            <div className={cn("trace-disclosure__panel-inner", panelInnerClassName)}>
              {expanded ? children : null}
            </div>
          </div>
        </div>
      </div>
    </TraceDisclosureCtx.Provider>
  );
}
