import { useCallback, useEffect, useState } from "react";
import ResizableEdge from "../../ui/ResizableEdge.jsx";
import { cn } from "../../ui/cn.js";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";

const PREVIEW_W_KEY = "openstudio_chat_preview_px";
const PREVIEW_W_DEFAULT = 408;
const PREVIEW_W_MIN = 300;
const PREVIEW_W_MAX = 720;

function readPreviewWidth() {
  try {
    const raw = window.localStorage.getItem(PREVIEW_W_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(PREVIEW_W_MAX, Math.max(PREVIEW_W_MIN, n));
  } catch {
    /* ignore */
  }
  return PREVIEW_W_DEFAULT;
}

export default function ChatLabPreviewDock() {
  const { t } = useI18n();
  const api = useChatLabPreview();
  const session = api?.session ?? null;

  const [panelWidth, setPanelWidth] = useState(readPreviewWidth);
  const [panelDragging, setPanelDragging] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_W_KEY, String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

  const onOpenExternal = useCallback(() => {
    if (!session || session.kind !== "iframe") return;
    const url = session.externalUrl;
    if (!url) return;
    try {
      window.open(url, "_blank", "noreferrer,noopener");
    } catch {
      /* ignore */
    }
  }, [session]);

  if (!api || !session) return null;

  return (
    <aside
      className={cn(
        "chat-lab-preview-dock relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l",
        panelDragging && "chat-lab-preview-dock--resizing",
      )}
      style={{
        width: panelWidth,
        borderColor: "color-mix(in srgb, var(--os-border) 55%, transparent)",
        background: "var(--os-bg-elevated)",
      }}
      aria-label={t("chatLab.previewDockAria")}
    >
      <ResizableEdge
        side="left"
        value={panelWidth}
        min={PREVIEW_W_MIN}
        max={PREVIEW_W_MAX}
        onChange={setPanelWidth}
        onActiveChange={setPanelDragging}
      />
      <header className="chat-lab-preview-dock__head flex shrink-0 items-center gap-2 border-b px-2.5 py-2 pr-3">
        <h3 className="chat-lab-preview-dock__title min-w-0 flex-1 truncate text-[0.82rem] font-semibold leading-tight">
          {session.title || t("chatLab.previewDefaultTitle")}
        </h3>
        {session.kind === "iframe" && session.externalUrl ? (
          <button
            type="button"
            className="chat-lab-preview-dock__icon-btn"
            onClick={onOpenExternal}
            title={t("chatLab.previewOpenExternal")}
          >
            ↗
          </button>
        ) : null}
        <button
          type="button"
          className="chat-lab-preview-dock__icon-btn"
          onClick={api.close}
          title={t("chatLab.previewClose")}
          aria-label={t("chatLab.previewClose")}
        >
          ×
        </button>
      </header>
      <div className="chat-lab-preview-dock__body min-h-0 flex-1">
        {session.kind === "placeholder" ? (
          <div className="chat-lab-preview-dock__placeholder muted px-3 py-3 text-[0.82rem] leading-relaxed">
            {session.body}
          </div>
        ) : (
          <iframe
            ref={api.iframeRef}
            className="chat-lab-preview-dock__frame h-full w-full border-0"
            title={session.title || t("chatLab.previewDefaultTitle")}
            {...(session.kind === "srcdoc"
              ? { srcDoc: session.html }
              : { src: session.src })}
            {...(session.sandbox ? { sandbox: session.sandbox } : {})}
          />
        )}
      </div>
    </aside>
  );
}
