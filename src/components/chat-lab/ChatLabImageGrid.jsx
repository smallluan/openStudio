import { useState } from "react";
import { cn } from "../../ui/cn.js";

/**
 * @typedef {{ alt: string; src: string }} MarkdownImageRef
 */

const GRID_MAX = 9;
const GRID_PREVIEW = 8;

/**
 * @param {{ images: MarkdownImageRef[]; className?: string }} props
 */
export function ChatLabImageGrid({ images, className }) {
  const [expanded, setExpanded] = useState(false);
  const list = (Array.isArray(images) ? images : []).filter((img) => String(img?.src ?? "").trim());
  if (!list.length) return null;

  const total = list.length;

  if (total <= GRID_MAX) {
    return (
      <div className={cn("chat-lab__md-image-grid", `chat-lab__md-image-grid--count-${total}`, className)}>
        {list.map((img, idx) => (
          <a
            key={`${img.src}-${idx}`}
            href={img.src}
            className="chat-lab__md-image-grid__cell"
            target="_blank"
            rel="noreferrer noopener"
          >
            <img src={img.src} alt={img.alt ?? ""} className="chat-lab__md-image-grid__img" loading="lazy" />
          </a>
        ))}
      </div>
    );
  }

  if (!expanded) {
    const moreCount = total - GRID_PREVIEW;
    return (
      <div className={cn("chat-lab__md-image-grid", "chat-lab__md-image-grid--count-9", className)}>
        {list.slice(0, GRID_PREVIEW).map((img, idx) => (
          <a
            key={`${img.src}-${idx}`}
            href={img.src}
            className="chat-lab__md-image-grid__cell"
            target="_blank"
            rel="noreferrer noopener"
          >
            <img src={img.src} alt={img.alt ?? ""} className="chat-lab__md-image-grid__img" loading="lazy" />
          </a>
        ))}
        <button
          type="button"
          className="chat-lab__md-image-grid__cell chat-lab__md-image-grid__more"
          onClick={() => setExpanded(true)}
          aria-label={`展开剩余 ${moreCount} 张图片`}
        >
          <img
            src={list[GRID_PREVIEW].src}
            alt=""
            className="chat-lab__md-image-grid__img chat-lab__md-image-grid__img--under"
            loading="lazy"
          />
          <span className="chat-lab__md-image-grid__more-label">+{moreCount}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("chat-lab__md-image-grid", "chat-lab__md-image-grid--expanded", className)}>
      {list.map((img, idx) => (
        <a
          key={`${img.src}-${idx}`}
          href={img.src}
          className="chat-lab__md-image-grid__cell"
          target="_blank"
          rel="noreferrer noopener"
        >
          <img src={img.src} alt={img.alt ?? ""} className="chat-lab__md-image-grid__img" loading="lazy" />
        </a>
      ))}
    </div>
  );
}
