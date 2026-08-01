import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CHAT_MD_REHYPE_PLUGINS } from "../../chat/chatLabRehypePlugins.js";
import {
  prepareChatLabMarkdownForRender,
  segmentMarkdownContentBlocks,
} from "../../chat/chatLabMarkdownImageGrid.js";
import { resolveHtmlFenceReservedHeight, htmlFenceHeightsCompleteForMarkdown } from "../../chat/chatLabHtmlFenceHeights.js";
import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useDocTheme } from "./chatLabMarkdown.jsx";
import { ChatLabImageGrid } from "./ChatLabImageGrid.jsx";
import ChatLabHtmlBlock from "./ChatLabHtmlBlock.jsx";

const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

export { ChatLabImageGrid };

/**
 * @param {{
 *   source: string;
 *   className?: string;
 *   components?: import("react-markdown").Components;
 *   streaming?: boolean;
 *   htmlFenceHeights?: Record<string, number>;
 *   onHtmlFenceHeight?: (blockIndex: number, height: number) => void;
 *   onHtmlFenceLayoutReady?: () => void;
 * }} props
 */
export default function ChatLabMarkdownContent({
  source,
  className,
  components,
  streaming = false,
  htmlFenceHeights,
  onHtmlFenceHeight,
  onHtmlFenceLayoutReady,
}) {
  const { t } = useI18n();
  const theme = useDocTheme();
  const blocks = useMemo(
    () => segmentMarkdownContentBlocks(source, { streaming, renderDirectoryTrees: false }),
    [source, streaming],
  );
  const heightsComplete = useMemo(
    () => htmlFenceHeightsCompleteForMarkdown(source, htmlFenceHeights),
    [source, htmlFenceHeights],
  );
  const [htmlReadyTick, setHtmlReadyTick] = useState(0);
  const htmlReadyBlocksRef = useRef(/** @type {Set<number>} */ (new Set()));

  useEffect(() => {
    htmlReadyBlocksRef.current = new Set();
    setHtmlReadyTick((n) => n + 1);
  }, [source]);

  const markHtmlBlockReady = useCallback(
    (blockIdx) => {
      if (htmlReadyBlocksRef.current.has(blockIdx)) return;
      htmlReadyBlocksRef.current.add(blockIdx);
      setHtmlReadyTick((n) => n + 1);
      if (!heightsComplete) onHtmlFenceLayoutReady?.();
    },
    [heightsComplete, onHtmlFenceLayoutReady],
  );

  const mergedComponents = useMemo(
    () => ({
      ...components,
    }),
    [components],
  );

  if (!blocks.length) return null;

  const htmlBlockIndices = blocks
    .map((block, idx) => (block.kind === "html" ? idx : -1))
    .filter((idx) => idx >= 0);

  let htmlFenceIndex = 0;
  void htmlReadyTick;

  const isProseBlockedByHtml = (blockIdx) => {
    if (heightsComplete) return false;
    const priorHtml = htmlBlockIndices.filter((hi) => hi < blockIdx);
    if (!priorHtml.length) return false;
    return priorHtml.some((hi) => !htmlReadyBlocksRef.current.has(hi));
  };

  return (
    <div className={cn("chat-lab__md-content", className)}>
      {blocks.map((block, idx) => {
        if (block.kind === "gallery") {
          return <ChatLabImageGrid key={`gallery-${idx}`} images={block.images} />;
        }
        if (block.kind === "html") {
          const fenceIndex = htmlFenceIndex;
          htmlFenceIndex += 1;
          const reservedHeight = resolveHtmlFenceReservedHeight(block.body, htmlFenceHeights, fenceIndex, {
            allowHint: false,
          });
          return (
            <ChatLabHtmlBlock
              key={`html-${idx}`}
              code={block.body}
              theme={theme}
              streaming={streaming}
              reservedHeight={reservedHeight}
              onHeightMeasured={
                onHtmlFenceHeight ? (height) => onHtmlFenceHeight(fenceIndex, height) : undefined
              }
              onLayoutReady={() => markHtmlBlockReady(idx)}
              t={t}
            />
          );
        }
        if (isProseBlockedByHtml(idx)) {
          return null;
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
