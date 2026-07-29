import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CHAT_MD_REHYPE_PLUGINS } from "../../chat/chatLabRehypePlugins.js";
import {
  prepareChatLabMarkdownForRender,
  segmentMarkdownContentBlocks,
} from "../../chat/chatLabMarkdownImageGrid.js";
import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useDocTheme } from "./chatLabMarkdown.jsx";
import { ChatLabImageGrid } from "./ChatLabImageGrid.jsx";
import ChatLabDirectoryTree from "./ChatLabDirectoryTree.jsx";
import ChatLabHtmlBlock from "./ChatLabHtmlBlock.jsx";

const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

export { ChatLabImageGrid };

/**
 * @param {{
 *   source: string;
 *   className?: string;
 *   components?: import("react-markdown").Components;
 *   streaming?: boolean;
 * }} props
 */
export default function ChatLabMarkdownContent({ source, className, components, streaming = false }) {
  const { t } = useI18n();
  const theme = useDocTheme();
  const blocks = useMemo(() => segmentMarkdownContentBlocks(source, { streaming }), [source, streaming]);

  const mergedComponents = useMemo(
    () => ({
      ...components,
    }),
    [components],
  );

  if (!blocks.length) return null;

  return (
    <div className={cn("chat-lab__md-content", className)}>
      {blocks.map((block, idx) => {
        if (block.kind === "gallery") {
          return <ChatLabImageGrid key={`gallery-${idx}`} images={block.images} />;
        }
        if (block.kind === "tree") {
          return <ChatLabDirectoryTree key={`tree-${idx}`} root={block.tree} />;
        }
        if (block.kind === "html") {
          return (
            <ChatLabHtmlBlock
              key={`html-${idx}`}
              code={block.body}
              theme={theme}
              streaming={streaming}
              t={t}
            />
          );
        }
        const md = prepareChatLabMarkdownForRender(block.body);
        if (!String(md ?? "").trim()) return null;
        return (
          <ReactMarkdown
            key={`prose-${idx}`}
            remarkPlugins={CHAT_MD_REMARK_PLUGINS}
            rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
            components={mergedComponents}
          >
            {md}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
