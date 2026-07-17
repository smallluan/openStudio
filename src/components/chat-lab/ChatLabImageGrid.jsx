import { useMemo, useState } from "react";
import { Button } from "@open-studio/udesign";
import Image from "../../ui/Image.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @typedef {{ alt: string; src: string }} MarkdownImageRef
 */

const GRID_MAX = 9;
const GRID_PREVIEW = 8;

/**
 * @param {{
 *   img: MarkdownImageRef;
 *   idx: number;
 *   previewGroup: MarkdownImageRef[];
 *   className?: string;
 * }} props
 */
function GridCell({ img, idx, previewGroup, className }) {
  return (
    <Image
      src={img.src}
      alt={img.alt ?? ""}
      className={cn("chat-lab__md-image-grid__cell", className)}
      imgClassName="chat-lab__md-image-grid__img"
      loading="lazy"
      fit="cover"
      previewable
      previewGroup={previewGroup}
      previewIndex={idx}
    />
  );
}

/**
 * @param {{ images: MarkdownImageRef[]; className?: string }} props
 */
export function ChatLabImageGrid({ images, className }) {
  const [expanded, setExpanded] = useState(false);
  const list = useMemo(
    () => (Array.isArray(images) ? images : []).filter((img) => String(img?.src ?? "").trim()),
    [images],
  );
  const previewGroup = useMemo(
    () => list.map((img) => ({ src: img.src, alt: img.alt ?? "" })),
    [list],
  );

  if (!list.length) return null;

  const total = list.length;

  if (total <= GRID_MAX) {
    return (
      <div className={cn("chat-lab__md-image-grid", `chat-lab__md-image-grid--count-${total}`, className)}>
        {list.map((img, idx) => (
          <GridCell key={`${img.src}-${idx}`} img={img} idx={idx} previewGroup={previewGroup} />
        ))}
      </div>
    );
  }

  if (!expanded) {
    const moreCount = total - GRID_PREVIEW;
    return (
      <div className={cn("chat-lab__md-image-grid", "chat-lab__md-image-grid--count-9", className)}>
        {list.slice(0, GRID_PREVIEW).map((img, idx) => (
          <GridCell key={`${img.src}-${idx}`} img={img} idx={idx} previewGroup={previewGroup} />
        ))}
        <Button
          type="button"
          className="chat-lab__md-image-grid__cell chat-lab__md-image-grid__more"
          onClick={() => setExpanded(true)}
          aria-label={`展开剩余 ${moreCount} 张图片`}
        >
          <Image
            src={list[GRID_PREVIEW].src}
            alt=""
            className="chat-lab__md-image-grid__cell--underlay"
            imgClassName="chat-lab__md-image-grid__img chat-lab__md-image-grid__img--under"
            loading="lazy"
            fit="cover"
            as="div"
          />
          <span className="chat-lab__md-image-grid__more-label">+{moreCount}</span>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("chat-lab__md-image-grid", "chat-lab__md-image-grid--expanded", className)}>
      {list.map((img, idx) => (
        <GridCell key={`${img.src}-${idx}`} img={img} idx={idx} previewGroup={previewGroup} />
      ))}
    </div>
  );
}
