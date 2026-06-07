import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../ui/cn.js";

/**
 * Horizontal toolbar strip: no wrap, hidden scrollbar, edge fades when scrolled.
 * @param {{ children: import("react").ReactNode; className?: string }} props
 */
export default function ChatLabToolbarScroll({ children, className }) {
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const overflow = scrollWidth > clientWidth + 1;
    setFade({
      left: overflow && scrollLeft > 2,
      right: overflow && scrollLeft < scrollWidth - clientWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    updateFade();
    el.addEventListener("scroll", updateFade, { passive: true });
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateFade);
      ro.disconnect();
    };
  }, [updateFade, children]);

  return (
    <div className={cn("chat-lab__toolbar-scroll", className)}>
      <div ref={scrollRef} className="chat-lab__toolbar-scroll-track scrollbar-hide">
        {children}
      </div>
      <div
        className={cn(
          "chat-lab__toolbar-scroll-fade chat-lab__toolbar-scroll-fade--left",
          fade.left && "chat-lab__toolbar-scroll-fade--visible",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "chat-lab__toolbar-scroll-fade chat-lab__toolbar-scroll-fade--right",
          fade.right && "chat-lab__toolbar-scroll-fade--visible",
        )}
        aria-hidden
      />
    </div>
  );
}
