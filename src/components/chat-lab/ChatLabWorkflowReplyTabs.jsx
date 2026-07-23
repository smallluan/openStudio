import { useEffect, useMemo, useState } from "react";
import { Tabs } from "tdesign-react";
import Avatar from "../../ui/Avatar.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   tabLabel: string;
 *   agentGlyph?: string;
 *   agentName?: string;
 *   busy?: boolean;
 * }} props
 */
function WorkflowReplyTabLabel({ tabLabel, agentGlyph, agentName, busy = false }) {
  return (
    <span
      className={cn("chat-lab__workflow-tab-label", busy && "chat-lab__workflow-tab-label--busy")}
      title={tabLabel}
      aria-busy={busy || undefined}
    >
      {agentGlyph || agentName ? (
        <span className={cn("chat-lab__workflow-tab-avatar", busy && "chat-lab__workflow-tab-avatar--busy")}>
          <Avatar src={agentGlyph} name={agentName || tabLabel} size="xs" shape="rounded" />
        </span>
      ) : null}
      <span className="chat-lab__workflow-tab-text">{tabLabel}</span>
      {busy ? <span className="chat-lab__workflow-tab-dot" aria-hidden /> : null}
    </span>
  );
}

/**
 * @param {{
 *   replies: Array<{
 *     tabId: string;
 *     tabLabel: string;
 *     agentGlyph?: string;
 *     agentName?: string;
 *     message: Record<string, unknown>;
 *   }>;
 *   children: (reply: { tabId: string; tabLabel: string; message: Record<string, unknown> }, opts: { hideAgentHead: boolean }) => import("react").ReactNode;
 * }} props
 */
export default function ChatLabWorkflowReplyTabs({ replies, children }) {
  const defaultTabId = useMemo(() => {
    for (let i = replies.length - 1; i >= 0; i--) {
      if (replies[i].message.streaming) return replies[i].tabId;
    }
    return replies[replies.length - 1]?.tabId ?? "";
  }, [replies]);

  const [activeTabId, setActiveTabId] = useState(defaultTabId);

  useEffect(() => {
    setActiveTabId((prev) => {
      if (replies.some((r) => r.tabId === prev)) return prev;
      return defaultTabId;
    });
  }, [defaultTabId, replies]);

  useEffect(() => {
    const streamingTab = [...replies].reverse().find((r) => r.message.streaming);
    if (streamingTab) {
      setActiveTabId(streamingTab.tabId);
    }
  }, [replies]);

  const tabList = useMemo(
    () =>
      replies.map((reply) => {
        const busy = Boolean(reply.message.streaming) && !reply.message.error;
        return {
          value: reply.tabId,
          label: (
            <WorkflowReplyTabLabel
              tabLabel={reply.tabLabel}
              agentGlyph={reply.agentGlyph}
              agentName={reply.agentName}
              busy={busy}
            />
          ),
        };
      }),
    [replies],
  );

  const activeReply = replies.find((r) => r.tabId === activeTabId) ?? replies[0];

  return (
    <div className="chat-lab__workflow-replies" data-workflow-reply-tabs>
      <Tabs
        className="chat-lab__workflow-replies-tabs"
        value={activeTabId}
        list={tabList}
        onChange={(value) => setActiveTabId(String(value))}
      />
      <div className="chat-lab__workflow-replies-panel" role="tabpanel">
        {activeReply ? children(activeReply, { hideAgentHead: true }) : null}
      </div>
    </div>
  );
}
