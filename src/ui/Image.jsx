import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ExternalLink, Eye, ImageOff } from "lucide-react";
import { copyImageToClipboard, openImageInNewTab, saveImage } from "../chat/imageActions.js";
import ChatLabContextMenu from "../components/chat-lab/ChatLabContextMenu.jsx";
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
 *   contextMenu?: boolean;
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
  contextMenu = true,
}) {
  const { t } = useI18n();
  const imageView = useImageView();
  const [status, setStatus] = useState(/** @type {ImageStatus} */ ("idle"));
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(/** @type {HTMLButtonElement | HTMLDivElement | null} */ (null));
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

  const previewGroupResolved = useMemo(
    () =>
      previewGroup?.length ?
        previewGroup.filter((item) => String(item?.src ?? "").trim())
      : src ?
        [{ src, alt }]
      : [],
    [previewGroup, src, alt],
  );

  const openPreview = useCallback(() => {
    if (!previewable || !imageView || !src || !previewGroupResolved.length) return;
    const idx = Math.max(0, Math.min(previewIndex, previewGroupResolved.length - 1));
    imageView.open({ images: previewGroupResolved, initialIndex: idx });
  }, [previewable, imageView, src, previewGroupResolved, previewIndex]);

  const handleClick = useCallback(
    (e) => {
      if (menuOpen) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onClick?.(e);
      if (e.defaultPrevented) return;
      openPreview();
    },
    [menuOpen, onClick, openPreview],
  );

  const handleContextMenu = useCallback(
    /** @param {import("react").MouseEvent} e */
    (e) => {
      if (!contextMenu || !src || status === "error") return;
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(true);
    },
    [contextMenu, src, status],
  );

  const contextMenuItems = useMemo(() => {
    if (!src) return [];
    /** @type {Array<{ id: string; label: string; icon?: import("react").ReactNode; onClick: () => void; dividerBefore?: boolean }>} */
    const items = [];
    if (previewable && imageView) {
      items.push({
        id: "view",
        label: t("image.viewImage"),
        icon: <Eye className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />,
        onClick: openPreview,
      });
    }
    items.push({
      id: "copy",
      label: t("image.copyImage"),
      icon: <Copy className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />,
      onClick: () => {
        void copyImageToClipboard(src).catch(() => {});
      },
    });
    items.push({
      id: "save",
      label: t("image.saveImage"),
      icon: <Download className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />,
      dividerBefore: items.length > 0,
      onClick: () => {
        void saveImage(src, alt).catch(() => {});
      },
    });
    items.push({
      id: "open",
      label: t("image.openInNewTab"),
      icon: <ExternalLink className="text-[var(--os-text-muted)]" size={15} strokeWidth={2} aria-hidden />,
      onClick: () => openImageInNewTab(src),
    });
    return items;
  }, [alt, imageView, openPreview, previewable, src, t]);

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
      ref={rootRef}
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
      onContextMenu={handleContextMenu}
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

      {contextMenu ?
        <ChatLabContextMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          referenceRef={rootRef}
          placement="right-start"
          items={contextMenuItems}
          ariaLabel={t("image.contextMenuAria")}
        />
      : null}
    </Tag>
  );
}
