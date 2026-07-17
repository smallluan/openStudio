import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  RefreshCw,
} from "lucide-react";
import { saveImage, suggestFilename } from "../chat/imageActions.js";
import { useI18n } from "../context/I18nContext.jsx";
import ModalCloseButton from "./ModalCloseButton.jsx";
import { cn } from "./cn.js";

/**
 * @typedef {{ src: string; alt?: string }} ImageViewItem
 */

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.25;
const ROTATE_STEP = 90;

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
  const [transform, setTransform] = useState(() => ({
    scale: 1,
    rotation: 0,
    x: 0,
    y: 0,
  }));
  const [dragging, setDragging] = useState(false);
  const prevSrcRef = useRef("");
  const stageRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const dragRef = useRef(/** @type {{ active: boolean; startX: number; startY: number; originX: number; originY: number } | null} */ (null));

  const current = list[index] ?? null;
  const hasMultiple = list.length > 1;

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, rotation: 0, x: 0, y: 0 });
  }, []);

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
      resetTransform();
    }
  }, [current?.src, resetTransform]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
  }, [list.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i >= list.length - 1 ? 0 : i + 1));
  }, [list.length]);

  const zoomBy = useCallback((delta) => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale + delta)),
    }));
  }, []);

  const rotateBy = useCallback((delta) => {
    setTransform((prev) => ({ ...prev, rotation: prev.rotation + delta }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!current?.src || status !== "loaded") return;
    try {
      await saveImage(current.src, current.alt);
    } catch {
      /* ignore */
    }
  }, [current?.alt, current?.src, status]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && hasMultiple && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" && hasMultiple && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        goNext();
      } else if ((e.key === "+" || e.key === "=") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        resetTransform();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext, hasMultiple, resetTransform, zoomBy]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    /** @param {WheelEvent} e */
    const onWheel = (e) => {
      if (status !== "loaded") return;
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [status, zoomBy]);

  useEffect(() => {
    /** @param {PointerEvent} e */
    const onPointerMove = (e) => {
      const drag = dragRef.current;
      if (!drag?.active) return;
      setTransform((prev) => ({
        ...prev,
        x: drag.originX + (e.clientX - drag.startX),
        y: drag.originY + (e.clientY - drag.startY),
      }));
    };

    /** @param {PointerEvent} e */
    const onPointerUp = (e) => {
      if (!dragRef.current?.active) return;
      dragRef.current = null;
      setDragging(false);
      try {
        e.target instanceof Element && e.pointerId != null ?
          e.target.releasePointerCapture?.(e.pointerId)
        : undefined;
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  /** @param {React.PointerEvent<HTMLDivElement>} e */
  const onTransformPointerDown = (e) => {
    if (status !== "loaded" || transform.scale <= 1 || e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  if (!list.length) return null;

  const canPan = transform.scale > 1;

  return (
    <div
      className="os-image-view fixed inset-0 z-[210] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t("image.previewTitle")}
    >
      <Button
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
          <Button
            type="button"
            className="os-image-view__action"
            title={t("image.zoomOut")}
            aria-label={t("image.zoomOut")}
            onClick={() => zoomBy(-ZOOM_STEP)}
            disabled={status !== "loaded"}
          >
            <ZoomOut size={16} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            className="os-image-view__action"
            title={t("image.zoomIn")}
            aria-label={t("image.zoomIn")}
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={status !== "loaded"}
          >
            <ZoomIn size={16} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            className="os-image-view__action"
            title={t("image.rotateLeft")}
            aria-label={t("image.rotateLeft")}
            onClick={() => rotateBy(-ROTATE_STEP)}
            disabled={status !== "loaded"}
          >
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            className="os-image-view__action"
            title={t("image.rotateRight")}
            aria-label={t("image.rotateRight")}
            onClick={() => rotateBy(ROTATE_STEP)}
            disabled={status !== "loaded"}
          >
            <RotateCw size={16} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            className="os-image-view__action"
            title={t("image.resetView")}
            aria-label={t("image.resetView")}
            onClick={resetTransform}
            disabled={status !== "loaded"}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button
            type="button"
            className="os-image-view__action"
            title={t("image.saveImage")}
            aria-label={t("image.saveImage")}
            onClick={() => void handleSave()}
            disabled={status !== "loaded"}
          >
            <Download size={16} strokeWidth={1.75} aria-hidden />
          </Button>
          {current?.src ?
            <a
              href={current.src}
              target="_blank"
              rel="noreferrer noopener"
              className="os-image-view__action"
              title={t("image.openInNewTab")}
              aria-label={t("image.openInNewTab")}
              data-preview-bypass="true"
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
            <Button
              type="button"
              className="os-image-view__nav os-image-view__nav--prev"
              onClick={goPrev}
              aria-label={t("image.previewPrevious")}
            >
              <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
            </Button>
            <Button
              type="button"
              className="os-image-view__nav os-image-view__nav--next"
              onClick={goNext}
              aria-label={t("image.previewNext")}
            >
              <ChevronRight size={22} strokeWidth={1.75} aria-hidden />
            </Button>
          </>
        : null}

        <div
          ref={stageRef}
          className="os-image-view__stage flex max-h-full max-w-full items-center justify-center"
        >
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
            <div
              className={cn(
                "os-image-view__transform",
                canPan && (dragging ? "os-image-view__transform--dragging" : "os-image-view__transform--pannable"),
                status !== "loaded" && "os-image-view__transform--hidden",
              )}
              style={{
                transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`,
              }}
              onPointerDown={onTransformPointerDown}
            >
              <img
                key={current.src}
                src={current.src}
                alt={current.alt ?? ""}
                className="os-image-view__img"
                onLoad={() => setStatus("loaded")}
                onError={() => setStatus("error")}
                draggable={false}
              />
            </div>
          : null}
        </div>
      </div>

      {hasMultiple ?
        <div className="os-image-view__thumbs relative z-[1] shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
          <div className="os-image-view__thumbs-track">
            {list.map((item, idx) => (
              <Button
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
              </Button>
            ))}
          </div>
        </div>
      : null}
    </div>
  );
}
