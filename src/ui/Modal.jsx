import { useEffect } from "react";
import { cn } from "./cn.js";

export default function Modal({ children, className, labelledBy, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8"
      role="presentation"
    >
      <button
        type="button"
        className="os-modal-backdrop absolute inset-0 transition-opacity duration-200"
        aria-label="关闭对话框"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "os-modal-panel relative flex max-h-[min(92vh,840px)] w-full max-w-[920px] overflow-hidden rounded-2xl text-[var(--os-text)]",
          "motion-safe:animate-[os-modal-in_220ms_cubic-bezier(0.22,1,0.36,1)_both]",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
      <style>{`
        @keyframes os-modal-in {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
