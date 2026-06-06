import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeLatexMathDelimitersForRemark } from "../../chat/normalizeLatexMathDelimitersForRemark.js";
import { CHAT_MD_REHYPE_PLUGINS } from "../../chat/chatLabRehypePlugins.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { createChatLabMarkdownComponents } from "./chatLabMarkdown.jsx";
import { cn } from "../../ui/cn.js";

/** Same remark/rehype pipeline as assistant bubbles in ChatLabPage. */
const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

/**
 * @param {{ source: string; className?: string; components?: import("react-markdown").Components }} props
 */
export default function ChatLabMarkdownBody({ source, className, components: componentsOverride }) {
  const { t } = useI18n();
  const mdSource = useMemo(
    () => normalizeLatexMathDelimitersForRemark(String(source ?? "")),
    [source],
  );
  const components = useMemo(
    () => componentsOverride ?? createChatLabMarkdownComponents(t),
    [componentsOverride, t],
  );

  return (
    <div className={cn("chat-lab__md", className)}>
      <ReactMarkdown
        remarkPlugins={CHAT_MD_REMARK_PLUGINS}
        rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
        components={components}
      >
        {mdSource}
      </ReactMarkdown>
    </div>
  );
}
