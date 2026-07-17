import { useMemo } from "react";
import { Button } from "@open-studio/udesign";
import ChatLabMarkdownBody from "./ChatLabMarkdownBody.jsx";
import ChatLabArtifactCodeView from "./ChatLabArtifactCodeView.jsx";
import ChatLabArtifactSourceView from "./ChatLabArtifactSourceView.jsx";
import { artifactKindSupportsRenderToggle } from "../../chat/chatLabArtifactPreviewKind.js";
import { prismLangFromFilename } from "../../chat/chatLabSyntaxLang.js";
import {
  csvToHtmlDocument,
  svgToHtmlDocument,
  wrapLooseHtmlFragmentForSrcDoc,
} from "../../chat/chatLabDocumentPreview.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   label: string;
 *   payload: import("../../chat/chatLabArtifactFilePayload.js").ArtifactFilePayload | null;
 *   error: string | null;
 *   loading: boolean;
 *   viewMode: "render" | "source";
 *   onViewModeChange: (mode: "render" | "source") => void;
 *   iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *   isResizing?: boolean;
 * }} props
 */
export default function ChatLabArtifactPreviewPane({
  label,
  payload,
  error,
  loading,
  viewMode,
  onViewModeChange,
  iframeRef,
  isResizing = false,
}) {
  const { t } = useI18n();

  const previewKind = payload?.previewKind ?? "text";
  const showToggle = payload && artifactKindSupportsRenderToggle(previewKind);

  const sourceText = useMemo(() => {
    if (!payload || payload.kind !== "text") return "";
    return payload.text ?? "";
  }, [payload]);

  const prismLang = useMemo(() => {
    if (!payload) return "";
    const fromName = prismLangFromFilename(label || payload.path);
    if (fromName) return fromName;
    if (previewKind === "markdown") return "markdown";
    if (previewKind === "html") return "markup";
    return "";
  }, [label, payload, previewKind]);

  if (loading) {
    return (
      <div className="chat-lab-artifact-preview chat-lab-artifact-preview--loading muted px-3 py-4 text-[0.82rem]">
        {t("chatLab.artifactsLoading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-lab-artifact-preview chat-lab-artifact-preview--error px-3 py-4 text-[0.82rem] leading-relaxed">
        {t("chatLab.previewReadFailed", { detail: error })}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="chat-lab-artifact-preview chat-lab-artifact-preview--empty muted px-3 py-4 text-[0.82rem]">
        {t("chatLab.artifactsSelectFile")}
      </div>
    );
  }

  const showSource = viewMode === "source" || !artifactKindSupportsRenderToggle(previewKind);

  return (
    <div className="chat-lab-artifact-preview flex min-h-0 min-w-0 flex-1 flex-col">
      {showToggle ? (
        <div className="chat-lab-artifact-preview__toolbar flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
          <Button
                variant="text"
                size="small"
            type="button"
            className={cn(
              "chat-lab-artifact-preview__mode-btn",
              viewMode === "render" && "chat-lab-artifact-preview__mode-btn--active",
            )}
            onClick={() => onViewModeChange("render")}
          >
            {t("chatLab.previewViewRender")}
          </Button>
          <Button
                variant="text"
                size="small"
            type="button"
            className={cn(
              "chat-lab-artifact-preview__mode-btn",
              viewMode === "source" && "chat-lab-artifact-preview__mode-btn--active",
            )}
            onClick={() => onViewModeChange("source")}
          >
            {t("chatLab.previewViewSource")}
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "chat-lab-artifact-preview__body min-h-0 min-w-0 flex-1 overflow-hidden",
          isResizing && "chat-lab-artifact-preview__body--resizing",
        )}
      >
        {previewKind === "office" ? (
          <p className="muted px-3 py-3 text-[0.82rem] leading-relaxed">{t("chatLab.previewOfficeLocalBinary")}</p>
        ) : previewKind === "image" && payload.blobUrl ? (
          <div className="chat-lab-artifact-preview__image-wrap h-full overflow-auto p-3">
            <img src={payload.blobUrl} alt={label} className="chat-lab-artifact-preview__image max-w-full" />
          </div>
        ) : previewKind === "pdf" && payload.blobUrl ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full w-full border-0"
            title={label}
            src={payload.blobUrl}
            sandbox="allow-scripts allow-downloads"
          />
        ) : showSource ? (
          <ChatLabArtifactCodeView
            key={payload.path ?? label}
            text={sourceText || (payload.kind === "bytes" ? "" : "")}
            language={prismLang}
            className="chat-lab-artifact-preview__source"
          />
        ) : previewKind === "markdown" ? (
          <div className="chat-lab-artifact-preview__scroll h-full overflow-auto">
            <ChatLabMarkdownBody source={sourceText} className="chat-lab-artifact-preview__md px-3 py-2" />
          </div>
        ) : previewKind === "html" ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full w-full border-0"
            title={label}
            srcDoc={wrapLooseHtmlFragmentForSrcDoc(sourceText)}
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
          />
        ) : previewKind === "csv" ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full w-full border-0"
            title={label}
            srcDoc={csvToHtmlDocument(sourceText)}
          />
        ) : previewKind === "svg" ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full w-full border-0"
            title={label}
            srcDoc={svgToHtmlDocument(sourceText)}
          />
        ) : (
          <ChatLabArtifactSourceView
            text={sourceText}
            className="chat-lab-artifact-preview__source p-2"
          />
        )}
      </div>
    </div>
  );
}
