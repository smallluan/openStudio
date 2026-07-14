import ChatLabComposerSlot from "./ChatLabComposerSlot.jsx";
import ChatLabContextBar from "./ChatLabContextBar.jsx";
import ChatLabQueuedMessagesBar from "./ChatLabQueuedMessagesBar.jsx";

/**
 * Context bar + queue + composer input. Must render under ChatLabWorkspaceProvider.
 *
 * @param {{
 *   className?: string;
 *   composer: import("react").ReactNode;
 *   queuedMessages?: Array<{ id: string; text: string; attachments?: unknown[]; fileRefs?: unknown[] }>;
 *   queuedSendingId?: string | null;
 *   onCancelQueuedMessage?: (id: string) => void;
 * }} props
 */
export default function ChatLabComposerStack({
  className,
  composer,
  queuedMessages = [],
  queuedSendingId = null,
  onCancelQueuedMessage,
}) {
  return (
    <ChatLabComposerSlot className={className}>
      <div className="chat-lab__context-row">
        <ChatLabContextBar />
        {onCancelQueuedMessage ? (
          <ChatLabQueuedMessagesBar
            messages={queuedMessages}
            sendingId={queuedSendingId}
            onCancel={onCancelQueuedMessage}
          />
        ) : null}
      </div>
      {composer}
    </ChatLabComposerSlot>
  );
}
