import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../ui/cn.js";

const LINE_HEIGHT = 20;
const OVERSCAN = 10;

/**
 * @param {{
 *   lines: string[];
 *   className?: string;
 *   startLine?: number;
 * }} props
 */
function ChatLabArtifactVirtualSourceInner({ lines, className, startLine = 1 }) {
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      className={cn("chat-lab-artifact-source chat-lab-artifact-source--virtual", className)}
    >
      <div
        className="chat-lab-artifact-source__virtual-track"
        style={{ height: `${totalSize}px`, position: "relative", width: "100%" }}
      >
        {virtualItems.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            className="chat-lab-artifact-source__row chat-lab-artifact-source__row--abs"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: `${item.size}px`,
              transform: `translateY(${item.start}px)`,
            }}
          >
            <span className="chat-lab-artifact-source__ln" aria-hidden>
              {startLine + item.index}
            </span>
            <span className="chat-lab-artifact-source__line">{lines[item.index] || "\u00a0"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ChatLabArtifactVirtualSourceInner);
