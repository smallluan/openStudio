import { createContext, useCallback, useContext, useMemo, useState } from "react";
import ImageView from "../ui/ImageView.jsx";

/**
 * @typedef {{ src: string; alt?: string }} ImageViewItem
 *
 * @typedef {{
 *   images: ImageViewItem[];
 *   initialIndex?: number;
 * }} ImageViewOpenOptions
 */

/** @type {import("react").Context<null | { open: (opts: ImageViewOpenOptions) => void; close: () => void }>} */
const ImageViewContext = createContext(null);

export function useImageView() {
  return useContext(ImageViewContext);
}

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function ImageViewProvider({ children }) {
  const [session, setSession] = useState(/** @type {ImageViewOpenOptions | null} */ (null));

  const open = useCallback((opts) => {
    const images = Array.isArray(opts?.images) ? opts.images : [];
    if (!images.length) return;
    setSession({
      images,
      initialIndex: opts.initialIndex ?? 0,
    });
  }, []);

  const close = useCallback(() => {
    setSession(null);
  }, []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ImageViewContext.Provider value={value}>
      {children}
      {session ?
        <ImageView
          images={session.images}
          initialIndex={session.initialIndex}
          onClose={close}
        />
      : null}
    </ImageViewContext.Provider>
  );
}
