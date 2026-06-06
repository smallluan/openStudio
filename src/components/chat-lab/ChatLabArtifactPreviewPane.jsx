import { useMemo } from "react";
import "../../chat/chatLabPrismSetup.js";
import ChatLabMarkdownBody from "./ChatLabMarkdownBody.jsx";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light.js";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus.js";
import { artifactKindSupportsRenderToggle } from "../../chat/chatLabArtifactPreviewKind.js";
import { prismLangFromFilename } from "../../chat/chatLabSyntaxLang.js";
import {
  csvToHtmlDocument,
  svgToHtmlDocument,
  wrapLooseHtmlFragmentForSrcDoc,
} from "../../chat/chatLabDocumentPreview.js";
import { useTheme } from "../../context/ThemeContext.jsx";
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
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const syntaxStyle = theme === "dark" ? vscDarkPlus : oneLight;

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

  return (
    <div className="chat-lab-artifact-preview flex min-h-0 flex-1 flex-col">
      {showToggle ? (
        <div className="chat-lab-artifact-preview__toolbar flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
          <button
            type="button"
            className={cn(
              "chat-lab-artifact-preview__mode-btn",
              viewMode === "render" && "chat-lab-artifact-preview__mode-btn--active",
            )}
            onClick={() => onViewModeChange("render")}
          >
            {t("chatLab.previewViewRender")}
          </button>
          <button
            type="button"
            className={cn(
              "chat-lab-artifact-preview__mode-btn",
              viewMode === "source" && "chat-lab-artifact-preview__mode-btn--active",
            )}
            onClick={() => onViewModeChange("source")}
          >
            {t("chatLab.previewViewSource")}
          </button>
        </div>
      ) : null}

      <div className="chat-lab-artifact-preview__body min-h-0 flex-1 overflow-auto">
        {previewKind === "office" ? (
          <p className="muted px-3 py-3 text-[0.82rem] leading-relaxed">{t("chatLab.previewOfficeLocalBinary")}</p>
        ) : previewKind === "image" && payload.blobUrl ? (
          <div className="chat-lab-artifact-preview__image-wrap p-3">
            <img src={payload.blobUrl} alt={label} className="chat-lab-artifact-preview__image max-w-full" />
          </div>
        ) : previewKind === "pdf" && payload.blobUrl ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full min-h-[12rem] w-full border-0"
            title={label}
            src={payload.blobUrl}
            sandbox="allow-scripts allow-downloads"
          />
        ) : viewMode === "source" || !artifactKindSupportsRenderToggle(previewKind) ? (
          <div className="chat-lab-artifact-preview__source p-2">
            {prismLang ? (
              <SyntaxHighlighter
                language={prismLang}
                style={syntaxStyle}
                showLineNumbers
                customStyle={{
                  margin: 0,
                  padding: "0.75rem",
                  fontSize: "0.78rem",
                  borderRadius: "8px",
                  background: "transparent",
                }}
              >
                {sourceText || (payload.kind === "bytes" ? "" : "")}
              </SyntaxHighlighter>
            ) : (
              <pre className="chat-lab-artifact-preview__plain text-[0.78rem] leading-relaxed">
                <code>{sourceText}</code>
              </pre>
            )}
          </div>
        ) : previewKind === "markdown" ? (
          <ChatLabMarkdownBody source={sourceText} className="chat-lab-artifact-preview__md px-3 py-2" />
        ) : previewKind === "html" ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full min-h-[12rem] w-full border-0"
            title={label}
            srcDoc={wrapLooseHtmlFragmentForSrcDoc(sourceText)}
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
          />
        ) : previewKind === "csv" ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full min-h-[12rem] w-full border-0"
            title={label}
            srcDoc={csvToHtmlDocument(sourceText)}
          />
        ) : previewKind === "svg" ? (
          <iframe
            ref={iframeRef}
            className="chat-lab-artifact-preview__frame h-full min-h-[12rem] w-full border-0"
            title={label}
            srcDoc={svgToHtmlDocument(sourceText)}
          />
        ) : (
          <div className="chat-lab-artifact-preview__source p-2">
            <pre className="chat-lab-artifact-preview__plain text-[0.78rem] leading-relaxed">
              <code>{sourceText}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
