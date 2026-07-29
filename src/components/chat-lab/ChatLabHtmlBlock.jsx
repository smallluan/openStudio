import { useCallback, useContext, useState } from "react";
import { Button } from "@open-studio/udesign";
import { Copy, ExternalLink } from "lucide-react";
import { cn } from "../../ui/cn.js";
import { ChatLabPreviewContext } from "../../context/ChatLabPreviewContext.jsx";
import { wrapLooseHtmlFragmentForSrcDoc } from "../../chat/chatLabDocumentPreview.js";
import ChatLabHtmlFenceView from "./ChatLabHtmlFenceView.jsx";

/**
 * @param {{
 *   code: string;
 *   theme: "light" | "dark";
 *   streaming?: boolean;
 *   t: (k: string) => string;
 * }} props
 */
export default function ChatLabHtmlBlock({ code, theme, streaming = false, t }) {
  const preview = useContext(ChatLabPreviewContext);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [code]);

  const onOpenPreview = useCallback(() => {
    if (!preview) return;
    const doc = wrapLooseHtmlFragmentForSrcDoc(code);
    if (!doc) return;
    preview.openSrcDoc(doc, t("chatLab.previewTitleHtml"));
  }, [code, preview, t]);

  const copyLabel = copied ? t("chatLab.codeCopied") : t("chatLab.codeCopy");

  return (
    <div className={cn("chat-lab__html-embed")} data-theme={theme}>
      <div className="chat-lab__html-embed__actions">
        {preview ? (
          <Button
            variant="text"
            size="small"
            type="button"
            icon={<ExternalLink size={14} strokeWidth={1.75} aria-hidden />}
            className="chat-lab__html-embed__action"
            onClick={onOpenPreview}
            aria-label={t("chatLab.previewClickToPreview")}
            title={t("chatLab.previewClickToPreview")}
          />
        ) : null}
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
      <ChatLabHtmlFenceView code={code} theme={theme} active streaming={streaming} />
    </div>
  );
}
