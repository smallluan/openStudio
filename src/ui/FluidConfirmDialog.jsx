import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "./FluidPopupAnimatedSurface.jsx";
import { useFloatingPresence } from "./useFloatingPresence.js";
import { cn } from "./cn.js";

function DialogCloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Layout box for `node` relative to `root` (used for absolute blob under footer rail).
 * Prefer offsetParent accumulation — matches CSS coords inside `position:relative` root better than raw getBoundingClientRect diffs when borders/padding differ.
 *
 * @param {HTMLElement} node
 * @param {HTMLElement} root
 */
function layoutRelativeTo(node, root) {
  let left = 0;
  let top = 0;
  let el = node;
  while (el && el !== root) {
    left += el.offsetLeft;
    top += el.offsetTop;
    const next = el.offsetParent;
    if (!(next instanceof HTMLElement)) break;
    el = next;
  }
  if (el !== root) {
    const rb = root.getBoundingClientRect();
    const nb = node.getBoundingClientRect();
    const cs = window.getComputedStyle(root);
    const borderLeft = Number.parseFloat(cs.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(cs.borderTopWidth) || 0;
    left = nb.left - rb.left - borderLeft + root.scrollLeft;
    top = nb.top - rb.top - borderTop + root.scrollTop;
  }
  return {
    left: Math.round(left * 100) / 100,
    top: Math.round(top * 100) / 100,
    width: Math.round(node.offsetWidth * 100) / 100,
    height: Math.round(node.offsetHeight * 100) / 100,
  };
}

/**
 * Centered liquid dialog — translucent backdrop uses Gaussian blur only (no tint); shell + footer share one fluid surface.
 *
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   title?: string;
 *   children: import("react").ReactNode;
 *   confirmLabel?: string;
 *   cancelLabel?: string;
 *   onConfirm?: () => void;
 *   onCancel?: () => void;
 *   danger?: boolean;
 *   morphBr?: string;
 * }} props
 */
export default function FluidConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger = false,
  morphBr = "14px",
}) {
  const { t } = useI18n();
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);
  const titleId = useId();
  const descId = useId();
  const cancelBtnRef = useRef(/** @type {HTMLButtonElement | null} */ (null));

  const footerRailRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const confirmWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const cancelWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  const [footerHoverKey, setFooterHoverKey] = useState(/** @type {null | "confirm" | "cancel"} */ (null));
  const [footerBlob, setFooterBlob] = useState(() => ({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: 0,
  }));

  const resolvedTitle = title ?? t("dialog.titleDefault");

  useEffect(() => {
    if (!open) setFooterHoverKey(null);
  }, [open]);

  useEffect(() => {
    if (!present) return undefined;
    const id = window.requestAnimationFrame(() => cancelBtnRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [present, surfaceKey]);

  useEffect(() => {
    if (!present) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel?.();
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present, onOpenChange, onCancel]);

  useEffect(() => {
    if (!present) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [present]);

  useLayoutEffect(() => {
    const root = footerRailRef.current;
    if (!present || !root) {
      setFooterBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }
    const key = footerHoverKey;
    const wrap =
      key === "confirm" ? confirmWrapRef.current : key === "cancel" ? cancelWrapRef.current : null;
    if (!wrap) {
      setFooterBlob((b) => ({ ...b, opacity: 0 }));
      return;
    }

    const measure = () => {
      const rootLive = footerRailRef.current;
      const k = footerHoverKey;
      const row =
        k === "confirm" ? confirmWrapRef.current : k === "cancel" ? cancelWrapRef.current : null;
      if (!rootLive || !row) {
        setFooterBlob((b) => ({ ...b, opacity: 0 }));
        return;
      }
      const { left, top, width, height } = layoutRelativeTo(row, rootLive);
      setFooterBlob((prev) => {
        if (
          prev.opacity === 1 &&
          prev.left === left &&
          prev.top === top &&
          prev.width === width &&
          prev.height === height
        ) {
          return prev;
        }
        return { left, top, width, height, opacity: 1 };
      });
    };

    measure();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    ro?.observe(wrap);

    return () => ro?.disconnect();
  }, [present, footerHoverKey]);

  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleBackdropMouseDown = (/** @type {import("react").MouseEvent} */ e) => {
    if (e.button !== 0) return;
    handleCancel();
  };

  const confirmText = confirmLabel ?? t("dialog.confirm");
  const cancelText = cancelLabel ?? t("dialog.cancel");

  const footerRailBlur = (e) => {
    const next = e.relatedTarget;
    if (next && footerRailRef.current?.contains(next)) return;
    setFooterHoverKey(null);
  };

  if (!present || typeof document === "undefined") return null;

  return createPortal(
    <div className={cn("fluid-dialog-root fixed inset-0 z-[6000]", leaving && "fluid-dialog-root--leaving")}>
      <div className="fluid-dialog__backdrop" aria-hidden onMouseDown={handleBackdropMouseDown} />
      <div className="fluid-dialog__stage">
        <FluidPopupAnimatedSurface
          key={surfaceKey}
          centered
          leaving={leaving}
          finishLeave={finishLeave}
          morphBr={morphBr}
          className={cn(
            "fluid-dialog__liquid-shell pointer-events-auto flex max-h-[min(72vh,calc(100vh-2rem))] min-w-0 flex-col overflow-hidden",
          )}
          surfaceProps={{
            role: "dialog",
            "aria-modal": true,
            "aria-labelledby": titleId,
            "aria-describedby": descId,
          }}
        >
          <div className="fluid-dialog__inner">
            <header className="fluid-dialog__head">
              <p id={titleId} className="fluid-dialog__title">
                {resolvedTitle}
              </p>
              <button
                type="button"
                className="fluid-dialog__close"
                aria-label={t("dialog.closeAria")}
                onClick={handleCancel}
              >
                <DialogCloseGlyph />
              </button>
            </header>
            <div id={descId} className="fluid-dialog__body">
              {children}
            </div>
            <div
              ref={footerRailRef}
              className="fluid-dialog__footer-rail"
              onBlur={footerRailBlur}
              onPointerLeave={() => setFooterHoverKey(null)}
            >
              <div
                aria-hidden
                className="fluid-dialog__footer-blob fluid-nav__blob pointer-events-none absolute left-0 top-0 z-0 rounded-[11px]"
                style={{
                  transform: `translate3d(${footerBlob.left}px, ${footerBlob.top}px, 0)`,
                  width: `${footerBlob.width}px`,
                  height: `${footerBlob.height}px`,
                  opacity: footerBlob.opacity,
                }}
              />
              <div className="fluid-dialog__footer-row">
                <div
                  ref={confirmWrapRef}
                  className="fluid-dialog__btn-measure"
                  onPointerEnter={() => setFooterHoverKey("confirm")}
                >
                  <button
                    type="button"
                    className={cn(
                      "fluid-dialog__btn-hit",
                      danger ? "fluid-dialog__btn-hit--danger" : "fluid-dialog__btn-hit--accent",
                    )}
                    onClick={handleConfirm}
                    onFocus={() => setFooterHoverKey("confirm")}
                  >
                    {confirmText}
                  </button>
                </div>
                <div
                  ref={cancelWrapRef}
                  className="fluid-dialog__btn-measure"
                  onPointerEnter={() => setFooterHoverKey("cancel")}
                >
                  <button
                    ref={cancelBtnRef}
                    type="button"
                    className="fluid-dialog__btn-hit fluid-dialog__btn-hit--ghost"
                    onClick={handleCancel}
                    onFocus={() => setFooterHoverKey("cancel")}
                  >
                    {cancelText}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </FluidPopupAnimatedSurface>
      </div>
    </div>,
    document.body,
  );
}
