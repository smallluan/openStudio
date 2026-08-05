import { useCallback, useRef, useState } from "react";
import { Button } from "@open-studio/udesign";
import { Copy, Download } from "lucide-react";
import { cn } from "../../ui/cn.js";
import ChatLabEchartsFenceView from "./ChatLabEchartsFenceView.jsx";

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
  theme,
  streaming = false,
  t,
  className,
}) {
  const chartRef = useRef(/** @type {{ download?: () => void } | null} */ (null));
  const [canDownload, setCanDownload] = useState(false);
  const [copied, setCopied] = useState(false);
  const onStatusChange = useCallback((status) => {
    setCanDownload(Boolean(status?.canDownload));
  }, []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [code]);

  const copyLabel = copied ? t("chatLab.codeCopied") : t("chatLab.codeCopy");
  const downloadLabel = t("chart.saveImage");

  return (
    <div className={cn("chat-lab__html-embed", className)} data-theme={theme}>
      <div className="chat-lab__html-embed__actions">
        <Button
          variant="text"
          size="small"
          type="button"
          icon={<Download size={14} strokeWidth={1.75} aria-hidden />}
          className="chat-lab__html-embed__action"
          onClick={() => chartRef.current?.download?.()}
          disabled={!canDownload}
          aria-label={downloadLabel}
          title={downloadLabel}
        />
        <Button
          variant="text"
          size="small"
          type="button"
          icon={<Copy size={14} strokeWidth={1.75} aria-hidden />}
          className={cn("chat-lab__html-embed__action", copied && "chat-lab__html-embed__action--done")}
          onClick={onCopy}
          aria-label={copyLabel}
          title={copyLabel}
        />
      </div>
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
  );
}
