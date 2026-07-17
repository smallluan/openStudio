import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { groupSessionArtifactsByOp } from "../../chat/chatLabSessionArtifacts.js";

/**
 * @param {import("../../chat/chatLabSessionArtifacts.js").ArtifactOp} op
 * @param {(key: string) => string} t
 */
function opLabel(op, t) {
  if (op === "created") return t("chatLab.artifactsCreated");
  if (op === "modified") return t("chatLab.artifactsModified");
  return t("chatLab.artifactsViewed");
}

/**
 * @param {{
 *   op: import("../../chat/chatLabSessionArtifacts.js").ArtifactOp;
 *   label: string;
 *   items: import("../../chat/chatLabSessionArtifacts.js").SessionArtifact[];
 *   disabled?: boolean;
 *   onOpen: (path: string) => void;
 * }} props
 */
function ArtifactOpRow({ op, label, items, disabled, onOpen }) {
  const scrollerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setFade({
      left: el.scrollLeft > 4,
      right: max > 4 && el.scrollLeft < max - 4,
    });
  }, []);

  useLayoutEffect(() => {
    updateFade();
    const el = scrollerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    el.addEventListener("scroll", updateFade, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateFade);
    };
  }, [items, updateFade]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    /** @param {WheelEvent} e */
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY + e.deltaX;
      updateFade();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [items, updateFade]);

  return (
    <div className={cn("chat-lab-artifacts-bar-row", `chat-lab-artifacts-bar-row--${op}`)}>
      <span className="chat-lab-artifacts-bar-row__label">{label}</span>
      <div
        className={cn(
          "chat-lab-artifacts-bar-row__scroll-wrap",
          fade.left && "chat-lab-artifacts-bar-row__scroll-wrap--fade-left",
          fade.right && "chat-lab-artifacts-bar-row__scroll-wrap--fade-right",
        )}
      >
        <div
          ref={scrollerRef}
          className="chat-lab-artifacts-bar-row__scroller"
          role="list"
          aria-label={label}
        >
          {items.map((a) => (
            <Button
              key={a.path}
              type="button"
              role="listitem"
              className={cn("chat-lab-artifacts-bar__chip", `chat-lab-artifacts-bar__chip--${op}`)}
              onClick={() => onOpen(a.path)}
              disabled={disabled}
              title={a.path}
            >
              <span className="chat-lab-artifacts-bar__chip-name">{a.label}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   artifacts: import("../../chat/chatLabSessionArtifacts.js").SessionArtifact[];
 *   disabled?: boolean;
 * }} props
 */
export default function ChatLabArtifactsBar({ artifacts, disabled }) {
  const { t } = useI18n();
  const preview = useChatLabPreview();

  const groups = useMemo(() => groupSessionArtifactsByOp(artifacts), [artifacts]);

  const onOpenOne = useCallback(
    (path) => {
      if (!preview?.openArtifactsPanel) return;
      preview.openArtifactsPanel(artifacts, path);
    },
    [artifacts, preview],
  );

  if (!artifacts.length) return null;

  return (
    <div className="chat-lab-artifacts-bar-stack" aria-label={t("chatLab.artifactsBarAria")}>
      {groups.map((group) => (
        <ArtifactOpRow
          key={group.op}
          op={group.op}
          label={opLabel(group.op, t)}
          items={group.items}
          disabled={disabled || !preview}
          onOpen={onOpenOne}
        />
      ))}
    </div>
  );
}
