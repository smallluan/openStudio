import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useI18n } from "../context/I18nContext.jsx";
import ModalCloseButton from "./ModalCloseButton.jsx";
import { cn } from "./cn.js";

/**
 * @typedef {{ src: string; alt?: string }} ImageViewItem
 */

/**
 * @param {{
 *   images: ImageViewItem[];
 *   initialIndex?: number;
 *   onClose: () => void;
 * }} props
 */
export default function ImageView({ images, initialIndex = 0, onClose }) {
  const { t } = useI18n();
  const list = useMemo(
    () => (Array.isArray(images) ? images : []).filter((item) => String(item?.src ?? "").trim()),
    [images],
  );
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1))),
  );
  const [status, setStatus] = useState(/** @type {"loading" | "loaded" | "error"} */ ("loading"));
  const prevSrcRef = useRef("");

  const current = list[index] ?? null;
  const hasMultiple = list.length > 1;

  useEffect(() => {
    setIndex(Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1))));
  }, [initialIndex, list.length]);

  useEffect(() => {
    if (!current?.src) {
      setStatus("error");
      return;
    }
    if (prevSrcRef.current !== current.src) {
      prevSrcRef.current = current.src;
      setStatus("loading");
    }
  }, [current?.src]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
  }, [list.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i >= list.length - 1 ? 0 : i + 1));
  }, [list.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && hasMultiple) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" && hasMultiple) {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext, hasMultiple]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!list.length) return null;

  return (
    <div
      className="os-image-view fixed inset-0 z-[210] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t("image.previewTitle")}
    >
      <button
        type="button"
        className="os-image-view__backdrop absolute inset-0 cursor-default border-0 p-0"
        aria-label={t("modal.closeDialog")}
        onClick={onClose}
      />

      <div className="os-image-view__toolbar relative z-[1] flex shrink-0 items-center justify-between gap-3 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-white/85">
          {hasMultiple ?
            <span className="tabular-nums">
              {t("image.previewCounter", { current: index + 1, total: list.length })}
            </span>
          : null}
          {current?.alt ?
            <span className="truncate opacity-80">{current.alt}</span>
          : null}
        </div>
        <div className="flex items-center gap-1">
          {current?.src ?
            <a
              href={current.src}
              target="_blank"
              rel="noreferrer noopener"
              className="os-image-view__action"
              title={t("image.openInNewTab")}
              aria-label={t("image.openInNewTab")}
            >
              <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
            </a>
          : null}
          <ModalCloseButton
            onClick={onClose}
            aria-label={t("image.previewClose")}
            className="os-image-view__close text-white/80 hover:bg-white/15 hover:text-white"
          />
        </div>
      </div>

      <div className="relative z-[1] flex min-h-0 flex-1 items-center justify-center px-3 pb-3 sm:px-6 sm:pb-6">
        {hasMultiple ?
          <>
            <button
              type="button"
              className="os-image-view__nav os-image-view__nav--prev"
              onClick={goPrev}
              aria-label={t("image.previewPrevious")}
            >
              <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              className="os-image-view__nav os-image-view__nav--next"
              onClick={goNext}
              aria-label={t("image.previewNext")}
            >
              <ChevronRight size={22} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        : null}

        <div className="os-image-view__stage flex max-h-full max-w-full items-center justify-center">
          {status === "loading" ?
            <div className="os-image-view__loading" role="status" aria-live="polite">
              <span className="os-image__spinner os-image__spinner--light" />
              <span className="sr-only">{t("image.loading")}</span>
            </div>
          : null}

          {status === "error" ?
            <div className="os-image-view__error" role="alert">
              {t("image.loadFailed")}
            </div>
          : null}

          {current?.src ?
            <img
              key={current.src}
              src={current.src}
              alt={current.alt ?? ""}
              className={cn(
                "os-image-view__img",
                status !== "loaded" && "os-image-view__img--hidden",
              )}
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
              draggable={false}
            />
          : null}
        </div>
      </div>

      {hasMultiple ?
        <div className="os-image-view__thumbs relative z-[1] shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
          <div className="os-image-view__thumbs-track">
            {list.map((item, idx) => (
              <button
                key={`${item.src}-${idx}`}
                type="button"
                className={cn(
                  "os-image-view__thumb",
                  idx === index && "os-image-view__thumb--active",
                )}
                onClick={() => setIndex(idx)}
                aria-label={item.alt || t("image.previewCounter", { current: idx + 1, total: list.length })}
                aria-current={idx === index ? "true" : undefined}
              >
                <img src={item.src} alt="" className="os-image-view__thumb-img" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </div>
      : null}
    </div>
  );
}
