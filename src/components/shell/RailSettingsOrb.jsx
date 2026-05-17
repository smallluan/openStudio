import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import NavSettingsIcon from "../../assets/svg/NavSettingsIcon.jsx";
import NavSkillIcon from "../../assets/svg/NavSkillIcon.jsx";
import GeneralSettingsSection from "../settings/GeneralSettingsSection.jsx";
import PlaceholderSettingsSection from "../settings/PlaceholderSettingsSection.jsx";
import { ModelSettingsProvider } from "../../context/ModelSettingsContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { SETTINGS_SECTION_IDS } from "../settings/settingsSectionIds.js";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";
import ModelProfilesPanel from "./ModelProfilesPanel.jsx";

/** Visible picker slots (wheel shifts window over SETTINGS_SECTION_IDS). */
const VISIBLE_SLOTS = 3;
const FAN_ROW_STRIDE_PX = 38;
const FAN_ROW_GAP_PX = 5;
const FAN_GAP_FROM_ICON_PX = 8;
const FAN_ARC_AMPLITUDE_PX = 26;

const EXIT_MS = 320;
const ENTER_MS = 400;

/** @typedef {'idle' | 'exit-up' | 'exit-down' | 'enter-below' | 'enter-above'} SlotMotion */

/**
 * @param {DOMRectReadOnly} rect
 * @param {number} slotCount
 */
function computeFanPositions(rect, slotCount) {
  if (slotCount <= 0) return [];
  const anchorRight = rect.right;
  const anchorMidY = rect.top + rect.height / 2;
  const stride = FAN_ROW_STRIDE_PX + FAN_ROW_GAP_PX;
  const totalH = slotCount * FAN_ROW_STRIDE_PX + Math.max(0, slotCount - 1) * FAN_ROW_GAP_PX;
  let startTop = anchorMidY - totalH / 2;
  if (typeof window !== "undefined") {
    const pad = 10;
    const maxTop = Math.max(pad, window.innerHeight - totalH - pad);
    startTop = Math.min(Math.max(startTop, pad), maxTop);
  }

  return Array.from({ length: slotCount }, (_, i) => {
    const t = slotCount === 1 ? 0.5 : i / (slotCount - 1);
    const sway = Math.sin(t * Math.PI) * FAN_ARC_AMPLITUDE_PX;
    let left = anchorRight + FAN_GAP_FROM_ICON_PX + sway;
    if (typeof window !== "undefined") {
      const approxRowW = 212;
      left = Math.min(left, Math.max(FAN_GAP_FROM_ICON_PX, window.innerWidth - approxRowW - 12));
    }
    return {
      left,
      top: startTop + i * stride,
    };
  });
}

/** Hit rectangle for wheel scrubbing (no overlay — avoids blocking clicks). */
function boundsFromFanPositions(positions) {
  if (positions.length === 0) return null;
  const left = Math.min(...positions.map((p) => p.left));
  const top = Math.min(...positions.map((p) => p.top));
  const bottom = Math.max(...positions.map((p) => p.top + FAN_ROW_STRIDE_PX));
  const padX = 14;
  const padY = 12;
  const width = 228 + padX * 2;
  return {
    left: left - padX,
    top: top - padY,
    width,
    height: bottom - top + padY * 2,
  };
}

/** @param {{ className?: string }} props */
function UsageMiniGlyph({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M4 13V9M9 13V5M14 13V8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

/** @param {{ className?: string }} props */
function RemoteMiniGlyph({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M5 11h8a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path d="M6 13v1M12 13v1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

/** @param {{ className?: string }} props */
function ModelMiniGlyph({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M4 6h10v3H4zM4 11h10v3H4z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

/** @param {{ className?: string }} props */
function AboutMiniGlyph({ className }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M9 12.4V11M9 8.35c0-.95.82-1.1 1.28-1.45a1.55 1.55 0 1 0-2.41-1.28" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

/**
 * @param {{ id: (typeof SETTINGS_SECTION_IDS)[number]; className?: string }} props
 */
function RailSectionMiniIcon({ id, className }) {
  const ic = cn("shrink-0 text-current opacity-[0.92]", className);
  switch (id) {
    case "general":
      return <NavSettingsIcon className={cn(ic, "h-[18px] w-[18px]")} />;
    case "skills":
      return <NavSkillIcon className={cn(ic, "h-[18px] w-[18px]")} />;
    case "usage":
      return <UsageMiniGlyph className={ic} />;
    case "remote":
      return <RemoteMiniGlyph className={ic} />;
    case "model":
      return <ModelMiniGlyph className={ic} />;
    case "about":
      return <AboutMiniGlyph className={ic} />;
    default:
      return <NavSettingsIcon className={cn(ic, "h-[18px] w-[18px]")} />;
  }
}

/**
 * Liquid settings trigger + vertical arc fan (wheel scroll shifts visible window); popup anchored on selection.
 *
 * @param {{ narrow?: boolean }} props
 */
export default function RailSettingsOrb({ narrow = false }) {
  const { t } = useI18n();
  const orbRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const segmentRefs = useRef(
    /** @type {Map<(typeof SETTINGS_SECTION_IDS)[number], HTMLButtonElement>} */ (new Map()),
  );
  const slotMotionRef = useRef(/** @type {SlotMotion} */ ("idle"));
  const windowStartRef = useRef(0);

  const sectionCount = SETTINGS_SECTION_IDS.length;
  const visibleSlots = Math.min(VISIBLE_SLOTS, Math.max(1, sectionCount));
  const maxWindowStart = Math.max(0, sectionCount - visibleSlots);

  const [open, setOpen] = useState(false);
  const { present, leaving } = useFloatingPresence(open);
  const [selectedSection, setSelectedSection] = useState(
    /** @type {(typeof SETTINGS_SECTION_IDS)[number]} */ (SETTINGS_SECTION_IDS[0]),
  );
  const [fanPositions, setFanPositions] = useState(/** @type {{ left: number; top: number }[]} */ ([]));
  const [windowStart, setWindowStart] = useState(0);
  const [slotMotion, setSlotMotion] = useState(/** @type {SlotMotion} */ ("idle"));
  const titleId = useId();

  slotMotionRef.current = slotMotion;
  windowStartRef.current = windowStart;

  const scrubBounds = useMemo(() => boundsFromFanPositions(fanPositions), [fanPositions]);

  useEffect(() => {
    if (!open) return;
    windowStartRef.current = 0;
    setWindowStart(0);
    setSlotMotion("idle");
    setSelectedSection(SETTINGS_SECTION_IDS[0]);
  }, [open]);

  /** Keep selection on a visible row when the window shifts. */
  useEffect(() => {
    if (!open) return;
    const slice = SETTINGS_SECTION_IDS.slice(windowStart, windowStart + visibleSlots);
    setSelectedSection((prev) =>
      slice.includes(prev) ? prev : slice[Math.min(1, slice.length - 1)] ?? slice[0],
    );
  }, [open, windowStart, visibleSlots]);

  const panel = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "right-start",
    strategy: "fixed",
    middleware: [offset(12), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });

  const { refs: panelRefs, floatingStyles: panelFloatingStyles, context: panelContext, update: panelUpdate } = panel;

  const dismiss = useDismiss(panelContext, {
    enabled: present,
    outsidePress(event) {
      const tEl = event.target;
      if (!(tEl instanceof Element)) return true;
      if (orbRef.current?.contains(tEl)) return false;
      if (tEl.closest("[data-rail-settings-fan-row]")) return false;
      return true;
    },
  });
  const role = useRole(panelContext, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const setSegmentNode = useCallback(
    /** @param {(typeof SETTINGS_SECTION_IDS)[number]} id @param {HTMLButtonElement | null} node */
    (id, node) => {
      const m = segmentRefs.current;
      if (node) m.set(id, node);
      else m.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!present) return;
    const measure = () => {
      const el = orbRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setFanPositions(computeFanPositions(rect, visibleSlots));
    };
    measure();
    const idr = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const orbEl = orbRef.current;
    if (orbEl) ro?.observe(orbEl);
    return () => {
      window.cancelAnimationFrame(idr);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro?.disconnect();
    };
  }, [present, visibleSlots]);

  useLayoutEffect(() => {
    if (!present) return;
    const seg = segmentRefs.current.get(selectedSection);
    if (seg) panelRefs.setReference(seg);
    void panelUpdate?.();
  }, [present, panelRefs, panelUpdate, selectedSection]);

  useEffect(() => {
    if (!present || maxWindowStart <= 0 || !scrubBounds) return;

    const onWheel = (e) => {
      if (slotMotionRef.current !== "idle") {
        e.preventDefault();
        return;
      }
      const { clientX, clientY } = e;
      const b = scrubBounds;
      if (
        clientX < b.left ||
        clientX > b.left + b.width ||
        clientY < b.top ||
        clientY > b.top + b.height
      ) {
        return;
      }

      const dy = e.deltaY;
      if (Math.abs(dy) < 2) return;

      const dir = dy > 0 ? 1 : -1;
      const cur = windowStartRef.current;
      const next = Math.min(maxWindowStart, Math.max(0, cur + dir));
      if (next === cur) return;

      e.preventDefault();
      const forward = dir === 1;
      setSlotMotion(forward ? "exit-up" : "exit-down");

      window.setTimeout(() => {
        windowStartRef.current = next;
        setWindowStart(next);
        setSlotMotion(forward ? "enter-below" : "enter-above");
        window.setTimeout(() => {
          setSlotMotion("idle");
        }, ENTER_MS);
      }, EXIT_MS);
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, true);
  }, [present, scrubBounds, maxWindowStart]);

  const sectionTitle = useMemo(() => t(`settings.sections.${selectedSection}`), [selectedSection, t]);

  const floatingProps = getFloatingProps({
    className:
      "rail-settings-detail-popup rail-settings-float z-[6120] pointer-events-auto flex max-h-[min(78vh,620px)] min-h-[260px] w-[min(92vw,400px)] max-w-[420px] flex-col overflow-hidden rounded-[14px] border border-[color-mix(in_srgb,var(--os-border)_38%,rgba(255,255,255,0.65))] bg-[color-mix(in_srgb,var(--os-bg-panel)_94%,transparent)] shadow-[0_22px_52px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.65)] outline-none backdrop-blur-[12px]",
    style: panelFloatingStyles,
    "aria-labelledby": titleId,
  });

  return (
    <>
      <button
        ref={orbRef}
        type="button"
        className={cn(
          "rail-settings-orb__hit group relative flex shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0.5 outline-none transition-[transform,color] duration-[380ms] ease-[cubic-bezier(0.34,1.2,0.52,1)] focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)] active:scale-[0.96]",
          "text-[var(--os-rail-text-muted)] hover:text-[var(--os-rail-text)]",
          narrow ? "aspect-square w-[2.25rem] rounded-lg" : "rounded-[10px]",
        )}
        aria-expanded={present}
        aria-haspopup="dialog"
        title={t("nav.settings")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rail-settings-orb__liquid-inner relative flex size-[1.68rem] items-center justify-center">
          <span className="rail-settings-orb__liquid-blob" aria-hidden />
          <NavSettingsIcon className="fluid-nav__glyph relative z-[1] h-[18px] w-[18px] opacity-[0.92] transition-opacity duration-[420ms] ease-[cubic-bezier(0.34,1.2,0.52,1)] group-hover:opacity-100" />
        </span>
      </button>

      {present ? (
        <FloatingPortal>
          <div
            className={cn(
              "fluid-dialog-root fixed inset-0 z-[6100]",
              leaving && "fluid-dialog-root--leaving",
            )}
            aria-hidden
          >
            <div className="fluid-dialog__backdrop" />
          </div>
          {Array.from({ length: visibleSlots }, (_, slotIdx) => {
            const id = SETTINGS_SECTION_IDS[windowStart + slotIdx];
            const pos = fanPositions[slotIdx];
            if (!id) return null;
            const sel = selectedSection === id;
            const label = t(`settings.sections.${id}`);
            return (
              <div
                key={`fan-slot-${slotIdx}`}
                style={
                  pos
                    ? {
                        position: "fixed",
                        left: pos.left,
                        top: pos.top,
                        zIndex: 6110,
                      }
                    : undefined
                }
                className={cn(!pos && "pointer-events-none opacity-0")}
              >
                <div
                  className={cn(
                    "rail-settings-slot-motion",
                    slotMotion === "exit-up" && "rail-settings-slot-motion--exit-up",
                    slotMotion === "exit-down" && "rail-settings-slot-motion--exit-down",
                    slotMotion === "enter-below" && "rail-settings-slot-motion--enter-below",
                    slotMotion === "enter-above" && "rail-settings-slot-motion--enter-above",
                  )}
                >
                  <button
                    key={id}
                    ref={(node) => setSegmentNode(id, node)}
                    type="button"
                    data-rail-settings-fan-row
                    className={cn(
                      "rail-settings-fan-row pointer-events-auto flex h-[38px] max-w-[13rem] min-w-[10rem] cursor-pointer items-center gap-2 rounded-xl border border-solid px-2.5 py-1 text-left text-[0.8125rem] font-semibold tracking-tight text-[var(--os-text)] transition-[box-shadow,color,border-color] duration-[380ms] ease-[cubic-bezier(0.34,1.35,0.42,1)] hover:text-[var(--os-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus-ring)] active:scale-[0.99]",
                      sel && "rail-settings-fan-row--selected",
                    )}
                    title={label}
                    aria-label={label}
                    aria-current={sel ? "true" : undefined}
                    onClick={() => setSelectedSection(id)}
                  >
                    <RailSectionMiniIcon id={id} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </button>
                </div>
              </div>
            );
          })}

          <FloatingFocusManager context={panelContext} modal={false} initialFocus={0}>
            <div ref={panelRefs.setFloating} {...floatingProps}>
              <header className="rail-settings-detail__head flex shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--os-border)_28%,transparent)] px-3 py-2.5">
                <h2 id={titleId} className="min-w-0 flex-1 truncate text-[0.94rem] font-semibold tracking-tight text-[var(--os-text)]">
                  {sectionTitle}
                </h2>
              </header>
              <div className="rail-settings-detail__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
                {selectedSection === "general" ? <GeneralSettingsSection /> : null}
                {selectedSection === "model" ? (
                  <ModelSettingsProvider>
                    <div className="flex min-h-0 flex-col">
                      <ModelProfilesPanel />
                    </div>
                  </ModelSettingsProvider>
                ) : null}
                {selectedSection !== "general" && selectedSection !== "model" ? (
                  <PlaceholderSettingsSection sectionId={selectedSection} />
                ) : null}
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
