import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { useI18n } from "../context/I18nContext.jsx";
import { useImageView } from "../context/ImageViewContext.jsx";
import { cn } from "./cn.js";

/** @typedef {"idle" | "loading" | "loaded" | "error"} ImageStatus */

/**
 * @typedef {{
 *   src?: string;
 *   alt?: string;
 *   fallback?: import("react").ReactNode;
 *   className?: string;
 *   imgClassName?: string;
 *   loading?: "lazy" | "eager";
 *   fit?: "cover" | "contain" | "fill" | "none";
 *   width?: number | string;
 *   height?: number | string;
 *   previewable?: boolean;
 *   previewGroup?: { src: string; alt?: string }[];
 *   previewIndex?: number;
 *   onClick?: (e: import("react").MouseEvent) => void;
 *   onLoad?: () => void;
 *   onError?: () => void;
 *   as?: "div" | "button";
 *   title?: string;
 * }} ImageProps
 */

/**
 * @param {ImageProps} props
 */
export default function Image({
  src,
  alt = "",
  fallback,
  className,
  imgClassName,
  loading = "lazy",
  fit = "cover",
  width,
  height,
  previewable = false,
  previewGroup,
  previewIndex = 0,
  onClick,
  onLoad,
  onError,
  as,
  title,
}) {
  const { t } = useI18n();
  const imageView = useImageView();
  const [status, setStatus] = useState(/** @type {ImageStatus} */ ("idle"));
  const prevSrcRef = useRef(src);

  useEffect(() => {
    if (prevSrcRef.current !== src) {
      prevSrcRef.current = src;
      setStatus("idle");
    }
  }, [src]);

  useEffect(() => {
    if (!src) {
      setStatus("error");
      return;
    }
    if (status === "idle") setStatus("loading");
  }, [src, status]);

  const handleLoad = useCallback(() => {
    setStatus("loaded");
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setStatus("error");
    onError?.();
  }, [onError]);

  const handleClick = useCallback(
    (e) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (!previewable || !imageView || !src) return;
      const group =
        previewGroup?.length ?
          previewGroup.filter((item) => String(item?.src ?? "").trim())
        : [{ src, alt }];
      if (!group.length) return;
      const idx = Math.max(0, Math.min(previewIndex, group.length - 1));
      imageView.open({ images: group, initialIndex: idx });
    },
    [onClick, previewable, imageView, src, alt, previewGroup, previewIndex],
  );

  const clickable = Boolean(onClick || (previewable && imageView && src));
  const Tag = as ?? (clickable ? "button" : "div");
  const showSpinner = status === "loading" || status === "idle";
  const showError = status === "error";

  const fallbackNode =
    fallback ??
    (
      <div className="os-image__fallback-inner" aria-hidden>
        <ImageOff className="os-image__fallback-icon" strokeWidth={1.5} />
        <span className="os-image__fallback-text">{t("image.loadFailed")}</span>
      </div>
    );

  return (
    <Tag
      type={Tag === "button" ? "button" : undefined}
      className={cn(
        "os-image",
        clickable && "os-image--clickable",
        showSpinner && "os-image--loading",
        showError && "os-image--error",
        status === "loaded" && "os-image--loaded",
        className,
      )}
      onClick={clickable ? handleClick : undefined}
      title={title}
      aria-label={Tag === "button" && alt ? alt : undefined}
      disabled={Tag === "button" && showError ? true : undefined}
    >
      {showSpinner ?
        <div className="os-image__placeholder" aria-hidden>
          <span className="os-image__spinner" />
        </div>
      : null}

      {showError ?
        <div className="os-image__fallback" role="img" aria-label={t("image.loadFailed")}>
          {fallbackNode}
        </div>
      : null}

      {src ?
        <img
          src={src}
          alt={alt}
          title={title}
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          className={cn(
            "os-image__img",
            `os-image__img--${fit}`,
            status !== "loaded" && "os-image__img--hidden",
            imgClassName,
          )}
          onLoad={handleLoad}
          onError={handleError}
        />
      : null}
    </Tag>
  );
}
