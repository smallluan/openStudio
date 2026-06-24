import { memo, useDeferredValue, useMemo } from "react";
import { splitArtifactSourceLines, analyzeArtifactSource } from "../../chat/chatLabArtifactSourceLimits.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";
import ChatLabArtifactVirtualSource from "./ChatLabArtifactVirtualSource.jsx";

const PLAIN_MAX_LINES = 120;

/**
 * Plain line-numbered source view (no syntax highlight).
 *
 * @param {{
 *   text: string;
 *   className?: string;
 *   forceVirtual?: boolean;
 * }} props
 */
function ChatLabArtifactSourceViewInner({ text, className, forceVirtual = false }) {
  const { t } = useI18n();
  const deferredText = useDeferredValue(String(text ?? ""));
  const split = useMemo(() => splitArtifactSourceLines(deferredText), [deferredText]);
  const { lines, truncated, totalLines } = split;

  const useVirtual = useMemo(() => {
    if (forceVirtual || lines.length >= PLAIN_MAX_LINES) return true;
    return analyzeArtifactSource(deferredText).isLarge;
  }, [forceVirtual, lines.length, deferredText]);

  if (!lines.length) {
    return (
      <pre className={cn("chat-lab-artifact-source chat-lab-artifact-source--empty", className)}>
        <code />
      </pre>
    );
  }

  if (useVirtual) {
    return (
      <div className={cn("chat-lab-artifact-source-stack flex min-h-0 flex-1 flex-col", className)}>
        <ChatLabArtifactVirtualSource lines={lines} className="min-h-0 flex-1" />
        {truncated ? (
          <p className="chat-lab-artifact-source__trunc-note muted shrink-0 px-3 py-2 text-[0.74rem]">
            {t("chatLab.previewFileTruncated", { shown: lines.length, total: totalLines.toLocaleString() })}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <pre className={cn("chat-lab-artifact-source", className)}>
      <code className="chat-lab-artifact-source__table">
        {lines.map((line, i) => (
          <span key={i} className="chat-lab-artifact-source__row">
            <span className="chat-lab-artifact-source__ln" aria-hidden>
              {i + 1}
            </span>
            <span className="chat-lab-artifact-source__line">{line || "\u00a0"}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

export default memo(ChatLabArtifactSourceViewInner);
