import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CHAT_MD_REHYPE_PLUGINS } from "../../chat/chatLabRehypePlugins.js";
import { prepareChatLabMarkdownForRender } from "../../chat/chatLabMarkdownImageGrid.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { createChatLabMarkdownComponents } from "./chatLabMarkdown.jsx";

const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

/**
 * Render markdown table content that was incorrectly placed in a `chart` fence.
 * @param {{ source: string }} props
 */
export default function ChatLabChartMarkdownFallback({ source }) {
  const { t } = useI18n();
  const mdSource = useMemo(() => prepareChatLabMarkdownForRender(source), [source]);
  const components = useMemo(() => createChatLabMarkdownComponents(t), [t]);

  return (
    <div className="chat-lab__code-md-render chat-lab__md chat-lab__chart-table-fallback">
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
