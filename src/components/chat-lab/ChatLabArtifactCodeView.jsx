import { memo, useDeferredValue, useMemo } from "react";
import "../../chat/chatLabPrismSetup.js";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light.js";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus.js";
import { analyzeArtifactSource } from "../../chat/chatLabArtifactSourceLimits.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";
import ChatLabArtifactSourceView from "./ChatLabArtifactSourceView.jsx";

/**
 * @param {{
 *   text: string;
 *   language?: string;
 *   className?: string;
 * }} props
 */
function ChatLabArtifactCodeViewInner({ text, language = "", className }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const syntaxStyle = theme === "dark" ? vscDarkPlus : oneLight;
  const deferredText = useDeferredValue(String(text ?? ""));
  const isPending = deferredText !== String(text ?? "");
  const lang = String(language ?? "").trim();

  const analysis = useMemo(() => analyzeArtifactSource(deferredText), [deferredText]);
  const useHighlight = Boolean(lang) && !analysis.isLarge;

  if (!lang || !useHighlight) {
    return (
      <div className={cn("chat-lab-artifact-code-wrap", className, isPending && "chat-lab-artifact-code-wrap--pending")}>
        {analysis.isLarge && lang ? (
          <p className="chat-lab-artifact-source__perf-note muted shrink-0 border-b px-3 py-1.5 text-[0.74rem]">
            {t("chatLab.previewLargeFilePlain")}
          </p>
        ) : null}
        <ChatLabArtifactSourceView text={deferredText} forceVirtual={analysis.isLarge} className="chat-lab-artifact-code-wrap__body" />
      </div>
    );
  }

  return (
    <div className={cn("chat-lab-artifact-code", className, isPending && "chat-lab-artifact-code--pending")}>
      <SyntaxHighlighter
        language={lang}
        style={syntaxStyle}
        showLineNumbers
        wrapLongLines
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          fontSize: "0.78rem",
          borderRadius: 0,
          background: "transparent",
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
        codeTagProps={{
          className: "chat-lab-artifact-code__code",
          style: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          },
        }}
        lineNumberStyle={{
          minWidth: "2.25rem",
          paddingRight: "0.65rem",
          userSelect: "none",
          opacity: 0.55,
        }}
      >
        {deferredText}
      </SyntaxHighlighter>
    </div>
  );
}

export default memo(ChatLabArtifactCodeViewInner);
