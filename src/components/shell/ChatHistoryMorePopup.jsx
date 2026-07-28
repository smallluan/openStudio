import { Popup } from "tdesign-react";
import { useEffect, useRef, useState } from "react";
import { CHAT_HISTORY_MORE_PAGE_SIZE } from "./chatHistorySidebarVisible.js";
import { OS_POPUP_INNER_CLASS, OS_POPUP_OVERLAY_CLASS, osPopupPopperOptions } from "../../ui/osPopupShared.js";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   title: string;
 *   rows: unknown[];
 *   renderRow: (
 *     row: unknown,
 *     context: {
 *       onNavigate: () => void;
 *       menuAttach: () => HTMLElement;
 *       menuZIndex: number;
 *     },
 *   ) => import("react").ReactNode;
 *   children: import("react").ReactNode;
 * }} props
 */
export default function ChatHistoryMorePopup({ open, onOpenChange, title, rows, renderRow, children }) {
  const popupRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const sentinelRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const rowsLengthRef = useRef(rows.length);
  const prevOpenRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(CHAT_HISTORY_MORE_PAGE_SIZE);

  rowsLengthRef.current = rows.length;

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }
    if (rows.length === 0) {
      onOpenChange(false);
      return;
    }
    if (!prevOpenRef.current) {
      setVisibleCount(Math.min(CHAT_HISTORY_MORE_PAGE_SIZE, rows.length));
    } else {
      setVisibleCount((count) => Math.min(count, rows.length));
    }
    prevOpenRef.current = true;
  }, [open, onOpenChange, rows.length]);

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  useEffect(() => {
    if (!open || !hasMore) return undefined;
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((count) => {
          const total = rowsLengthRef.current;
          if (count >= total) return count;
          return Math.min(count + CHAT_HISTORY_MORE_PAGE_SIZE, total);
        });
      },
      { root, rootMargin: "32px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, hasMore, rows.length]);

  const menuAttach = () => popupRef.current ?? document.body;

  const content = (
    <div
      ref={popupRef}
      className="chat-history-more-popup"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="chat-history-more-popup__header">{title}</div>
      <div ref={scrollRef} className="chat-history-more-popup__scroll scrollbar-hide">
        <ul className="chat-history-more-popup__list">
          {visibleRows.map((row) =>
            renderRow(row, {
              onNavigate: () => onOpenChange(false),
              menuAttach,
              menuZIndex: 3920,
            }),
          )}
        </ul>
        {hasMore ? <div ref={sentinelRef} className="chat-history-more-popup__sentinel" aria-hidden /> : null}
      </div>
    </div>
  );

  return (
    <Popup
      visible={open}
      trigger="click"
      placement="right-start"
      attach="body"
      zIndex={3900}
      destroyOnClose={false}
      overlayClassName={OS_POPUP_OVERLAY_CLASS}
      overlayInnerClassName={cn(OS_POPUP_INNER_CLASS, "chat-history-more-popup__inner")}
      overlayInnerStyle={{ overflow: "hidden", padding: 0 }}
      popperOptions={osPopupPopperOptions(4, 12)}
      content={content}
      onVisibleChange={onOpenChange}
    >
      {children}
    </Popup>
  );
}
