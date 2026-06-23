import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CHAT_MD_REHYPE_PLUGINS } from "../../chat/chatLabRehypePlugins.js";
import {
  prepareChatLabMarkdownForRender,
  segmentMarkdownContentBlocks,
} from "../../chat/chatLabMarkdownImageGrid.js";
import {
  inferChartFromMarkdownTables,
  tableChartSpecToDsl,
} from "../../chat/chatLabMarkdownTableChart.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { ChatLabImageGrid } from "./ChatLabImageGrid.jsx";
import ChatLabChartBlock from "./ChatLabChartBlock.jsx";
import { useDocTheme } from "./chatLabMarkdown.jsx";

const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

export { ChatLabImageGrid };

/**
 * @param {{
 *   source: string;
 *   className?: string;
 *   components?: import("react-markdown").Components;
 * }} props
 */
export default function ChatLabMarkdownContent({ source, className, components }) {
  const { t } = useI18n();
  const theme = useDocTheme();
  const blocks = useMemo(() => segmentMarkdownContentBlocks(source), [source]);
  const inferredChartDsl = useMemo(() => {
    const spec = inferChartFromMarkdownTables(source);
    return spec ? tableChartSpecToDsl(spec) : "";
  }, [source]);

  const mergedComponents = useMemo(
    () => ({
      ...components,
    }),
    [components],
  );

  if (!blocks.length) return null;

  return (
    <div className={className}>
      {blocks.map((block, idx) => {
        if (block.kind === "gallery") {
          return <ChatLabImageGrid key={`gallery-${idx}`} images={block.images} />;
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
      {inferredChartDsl ?
        <ChatLabChartBlock
          code={inferredChartDsl}
          label="chart"
          displayLang="chart"
          theme={theme}
          t={t}
          className="chat-lab__md-inferred-chart"
        />
      : null}
    </div>
  );
}
