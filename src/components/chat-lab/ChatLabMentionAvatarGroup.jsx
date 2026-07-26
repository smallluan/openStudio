import { Avatar as TAvatar, AvatarGroup, Tooltip } from "tdesign-react";
import { isAgentAvatarImageSrc } from "../../studio/agents.js";
import { cn } from "../../ui/cn.js";

/**
 * Overlapping mention avatars — names appear in tooltips on hover.
 * @param {{
 *   agents: Array<{ label: string; glyph: string }>;
 *   max?: number;
 *   className?: string;
 * }} props
 */
export default function ChatLabMentionAvatarGroup({ agents, max = 5, className }) {
  if (!agents.length) return null;

  return (
    <AvatarGroup size="24px" max={max} cascading="right-up" className={cn(className)}>
      {agents.map((agent, index) => {
        const image = isAgentAvatarImageSrc(agent.glyph) ? agent.glyph : undefined;
        const fallback = !image ? agent.glyph || agent.label.slice(0, 1) : undefined;
        return (
          <Tooltip
            key={`${agent.label}-${index}`}
            content={agent.label}
            placement="top"
            destroyOnClose
          >
            <TAvatar image={image} shape="circle" alt={agent.label}>
              {fallback}
            </TAvatar>
          </Tooltip>
        );
      })}
    </AvatarGroup>
  );
}
