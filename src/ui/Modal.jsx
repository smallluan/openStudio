import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "./cn.js";

export default function Modal({ children, className, labelledBy, onClose }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hadOpenedRef = useRef(false);

  const exitMs = useMemo(() => {
    if (typeof window === "undefined") return 220;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
  }, []);

  useEffect(() => {
    if (exitMs === 0) {
      setOpen(true);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setOpen(true));
    });
    return () => cancelAnimationFrame(id);
  }, [exitMs]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (open) {
      hadOpenedRef.current = true;
      return;
    }
    if (!hadOpenedRef.current) return;
    const id = window.setTimeout(() => {
      onClose?.();
    }, exitMs);
    return () => clearTimeout(id);
  }, [open, exitMs, onClose]);

  const beginClose = useCallback(() => {
    if (!open && !hadOpenedRef.current) {
      onClose?.();
      return;
    }
    if (!open) return;
    setOpen(false);
  }, [open, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") beginClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beginClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8"
      role="presentation"
    >
      <button
        type="button"
        className={cn(
          "os-modal-backdrop absolute inset-0 cursor-default border-0 p-0",
          "motion-safe:transition-opacity motion-safe:duration-[220ms] motion-safe:ease-out",
          open ? "motion-safe:opacity-100" : "opacity-0 motion-safe:opacity-0",
          "motion-reduce:opacity-100",
        )}
        aria-label={t("modal.closeDialog")}
        onClick={beginClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "os-modal-panel relative flex max-h-[min(92vh,840px)] w-full max-w-[920px] overflow-hidden rounded-2xl text-[var(--os-text)]",
          "motion-safe:transition-[opacity,transform] motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]",
          open
            ? "motion-safe:translate-y-0 motion-safe:scale-100 motion-safe:opacity-100"
            : "motion-safe:translate-y-[10px] motion-safe:scale-[0.985] motion-safe:opacity-0",
          "motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:transition-none",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
