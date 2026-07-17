import { useCallback, useMemo } from "react";
import { ImageViewer } from "tdesign-react";
import { saveImage } from "../chat/imageActions.js";

/**
 * @typedef {{ src: string; alt?: string }} ImageViewItem
 */

const IMAGE_SCALE = { min: 0.25, max: 5, step: 0.25, defaultScale: 1 };

/**
 * Full-screen image lightbox backed by TDesign ImageViewer.
 *
 * @param {{
 *   images: ImageViewItem[];
 *   initialIndex?: number;
 *   onClose: () => void;
 * }} props
 */
export default function ImageView({ images, initialIndex = 0, onClose }) {
  const list = useMemo(
    () => (Array.isArray(images) ? images : []).filter((item) => String(item?.src ?? "").trim()),
    [images],
  );

  const viewerImages = useMemo(
    () => list.map((item) => ({ mainImage: item.src, download: true })),
    [list],
  );

  const startIndex = useMemo(
    () => Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1))),
    [initialIndex, list.length],
  );

  const handleDownload = useCallback(
    (url) => {
      const src = typeof url === "string" ? url : "";
      if (!src) return;
      const item = list.find((row) => row.src === src) ?? list[startIndex];
      void saveImage(src, item?.alt).catch(() => {});
    },
    [list, startIndex],
  );

  if (!list.length) return null;

  return (
    <ImageViewer
      attach="body"
      defaultVisible
      defaultIndex={startIndex}
      images={viewerImages}
      imageScale={IMAGE_SCALE}
      trigger={<></>}
      zIndex={2100}
      closeOnOverlay
      onClose={() => onClose()}
      onDownload={handleDownload}
    />
  );
}
