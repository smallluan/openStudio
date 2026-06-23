import { useCallback, useRef, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "../../ui/cn.js";
import ChatLabEchartsFenceView from "./ChatLabEchartsFenceView.jsx";

/** @param {{ text: string; t: (k: string) => string }} props */
function CodeCopyBtn({ text, t }) {
  const [state, setState] = useState("idle");

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("idle");
    }
  }, [text]);

  const label = state === "copied" ? t("chatLab.codeCopied") : t("chatLab.codeCopy");

  return (
    <button
      type="button"
      className={cn("chat-lab__code-copy", state === "copied" && "chat-lab__code-copy--done")}
      onClick={onCopy}
      aria-label={label}
      title={label}
    >
      {state === "copied" ?
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6.5 12.5 10 16l7-8"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect
            x="8.25"
            y="8.25"
            width="11"
            height="13"
            rx="1.65"
            stroke="currentColor"
            strokeWidth="1.35"
          />
          <path
            d="M7.25 17H6.65A2.65 2.65 0 0 1 4 14.35V7.65A2.65 2.65 0 0 1 6.65 5h6.7A2.65 2.65 0 0 1 16 7.65V8.25"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      }
      <span className="chat-lab__code-copy-label">{label}</span>
    </button>
  );
}

/**
 * @param {{
 *   chartRef: import("react").RefObject<{ download?: () => void } | null>;
 *   disabled?: boolean;
 *   t: (k: string) => string;
 * }} props
 */
function ChartDownloadBtn({ chartRef, disabled = false, t }) {
  const label = t("chart.saveImage");

  return (
    <button
      type="button"
      className="chat-lab__code-copy"
      onClick={() => chartRef.current?.download?.()}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Download size={14} strokeWidth={1.75} aria-hidden />
      <span className="chat-lab__code-copy-label">{label}</span>
    </button>
  );
}

/**
 * @param {{
 *   code: string;
 *   label: string;
 *   displayLang: string;
 *   theme: "light" | "dark";
 *   streaming?: boolean;
 *   t: (k: string) => string;
 *   className?: string;
 * }} props
 */
export default function ChatLabChartBlock({
  code,
  label,
  displayLang,
  theme,
  streaming = false,
  t,
  className,
}) {
  const chartRef = useRef(/** @type {{ download?: () => void } | null} */ (null));
  const [canDownload, setCanDownload] = useState(false);
  const onStatusChange = useCallback((status) => {
    setCanDownload(Boolean(status?.canDownload));
  }, []);

  return (
    <div
      className={cn(
        "chat-lab__code-block",
        "chat-lab__code-block--visual-only",
        "chat-lab__code-block--chart",
        className,
      )}
      data-theme={theme}
    >
      <div className="chat-lab__code-block-toolbar">
        <span className="chat-lab__code-lang" title={displayLang}>
          {displayLang}
        </span>
        <div className="chat-lab__code-block-actions">
          <ChartDownloadBtn chartRef={chartRef} disabled={!canDownload} t={t} />
          <CodeCopyBtn text={code} t={t} />
        </div>
      </div>
      <div className="chat-lab__code-block-body">
        <ChatLabEchartsFenceView
          ref={chartRef}
          code={code}
          label={label}
          theme={theme}
          active
          streaming={streaming}
          onStatusChange={onStatusChange}
        />
      </div>
    </div>
  );
}
