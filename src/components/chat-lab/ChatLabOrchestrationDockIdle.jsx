import { useEffect, useRef, useState } from "react";
import heroAvatarLight from "../../assets/images/hero-avatar-light.png";
import heroAvatarDark from "../../assets/images/hero-avatar-dark.png";
import { useTheme } from "../../context/ThemeContext.jsx";
import { cn } from "../../ui/cn.js";

const STEP_TRANSITION_MS = 280;

/**
 * Idle state for orchestration preview dock — same robot avatar as new-chat hero.
 * @param {{ stepTitle?: string; className?: string }} props
 */
export default function ChatLabOrchestrationDockIdle({ stepTitle = "", className }) {
  const { theme } = useTheme();
  const label = String(stepTitle ?? "").trim();
  const [visibleLabel, setVisibleLabel] = useState(label);
  const [leavingLabel, setLeavingLabel] = useState("");
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (label === visibleLabel) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!visibleLabel) {
      setVisibleLabel(label);
      setLeavingLabel("");
      setAnimating(false);
      return;
    }
    setLeavingLabel(visibleLabel);
    setVisibleLabel(label);
    setAnimating(true);
    timerRef.current = setTimeout(() => {
      setLeavingLabel("");
      setAnimating(false);
      timerRef.current = null;
    }, STEP_TRANSITION_MS);
  }, [label, visibleLabel]);

  return (
    <div className={cn("chat-lab-preview-dock__orch-idle", className)}>
      <div className="chat-lab-preview-dock__orch-idle-avatar" aria-hidden>
        <img
          className="chat-lab-preview-dock__orch-idle-icon"
          src={theme === "dark" ? heroAvatarDark : heroAvatarLight}
          alt=""
        />
      </div>
      {visibleLabel ? (
        <p className="chat-lab-preview-dock__orch-idle-step" aria-live="polite" aria-atomic="true">
          {animating && leavingLabel ? (
            <span className="chat-lab-preview-dock__orch-idle-step-line chat-lab-preview-dock__orch-idle-step-line--leave">
              {leavingLabel}
            </span>
          ) : null}
          <span
            className={cn(
              "chat-lab-preview-dock__orch-idle-step-line",
              animating && "chat-lab-preview-dock__orch-idle-step-line--enter",
            )}
          >
            {visibleLabel}
          </span>
        </p>
      ) : null}
    </div>
  );
}
