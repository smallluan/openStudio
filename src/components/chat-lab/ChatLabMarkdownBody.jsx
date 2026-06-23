import { useMemo } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { createChatLabMarkdownComponents } from "./chatLabMarkdown.jsx";
import ChatLabMarkdownContent from "./ChatLabMarkdownContent.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{ source: string; className?: string; components?: import("react-markdown").Components }} props
 */
export default function ChatLabMarkdownBody({ source, className, components: componentsOverride }) {
  const { t } = useI18n();
  const components = useMemo(
    () => componentsOverride ?? createChatLabMarkdownComponents(t),
    [componentsOverride, t],
  );

  return (
    <ChatLabMarkdownContent
      source={String(source ?? "")}
      className={cn("chat-lab__md", className)}
      components={components}
    />
  );
}
