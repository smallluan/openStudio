import heroAvatarLight from "../../assets/images/hero-avatar-light.png";
import heroAvatarDark from "../../assets/images/hero-avatar-dark.png";
import { useTheme } from "../../context/ThemeContext.jsx";
import { cn } from "../../ui/cn.js";

/**
 * Idle state for orchestration preview dock — same robot avatar as new-chat hero.
 * @param {{ stepTitle?: string; className?: string }} props
 */
export default function ChatLabOrchestrationDockIdle({ stepTitle = "", className }) {
  const { theme } = useTheme();
  const label = String(stepTitle ?? "").trim();

  return (
    <div className={cn("chat-lab-preview-dock__orch-idle", className)}>
      <div className="chat-lab-preview-dock__orch-idle-avatar" aria-hidden>
        <img
          className="chat-lab-preview-dock__orch-idle-icon"
          src={theme === "dark" ? heroAvatarDark : heroAvatarLight}
          alt=""
        />
      </div>
      {label ? <p className="chat-lab-preview-dock__orch-idle-step">{label}</p> : null}
    </div>
  );
}
