import { useLayoutEffect, useRef } from "react";
import { cn } from "../../ui/cn.js";

/**
 * Bottom composer stack (context bar + input). Overlays thread content with a
 * transparent top so messages can scroll underneath the context bar row.
 *
 * @param {{ className?: string; children: import("react").ReactNode }} props
 */
export default function ChatLabComposerSlot({ className, children }) {
  const slotRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;

    const column = slot.closest(".chat-lab__column");
    if (!(column instanceof HTMLElement)) return undefined;

    const syncInset = () => {
      column.style.setProperty("--chat-lab-composer-inset", `${slot.offsetHeight}px`);
    };

    syncInset();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncInset) : null;
    ro?.observe(slot);
    window.addEventListener("resize", syncInset);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncInset);
      column.style.removeProperty("--chat-lab-composer-inset");
    };
  }, []);

  return (
    <div ref={slotRef} className={cn("chat-lab__composer-slot", className)}>
      {children}
    </div>
  );
}
