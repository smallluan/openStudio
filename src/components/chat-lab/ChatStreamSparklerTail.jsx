import { useCallback, useEffect, useState } from "react";
import { cn } from "../../ui/cn.js";

const CHAT_STREAM_SPARKLER_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Sparkler burst inline after prose while the assistant stream is active; fades like a typewriter caret when done.
 * @param {{ active: boolean }} props
 */
export function ChatStreamSparklerTail({ active }) {
  const [phase, setPhase] = useState(() => (active ? "on" : "off"));

  useEffect(() => {
    if (active) {
      setPhase("on");
      return;
    }
    setPhase((p) => (p === "on" || p === "exiting" ? "exiting" : "off"));
  }, [active]);

  const handleTransitionEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "opacity") return;
    setPhase((p) => (p === "exiting" ? "off" : p));
  }, []);

  if (phase === "off") return null;

  return (
    <span
      className={cn("chat-lab__stream-sparkler", phase === "exiting" && "chat-lab__stream-sparkler--exit")}
      aria-hidden
      onTransitionEnd={handleTransitionEnd}
    >
      <span className="chat-lab__stream-sparkler__glow" />
      <span className="chat-lab__stream-sparkler__ember" />
      <span className="chat-lab__stream-sparkler__rays">
        {CHAT_STREAM_SPARKLER_DEG.map((deg, i) => (
          <span
            key={deg}
            className={cn("chat-lab__stream-sparkler__spark", `chat-lab__stream-sparkler__spark--n${i}`)}
            style={{ transform: `rotate(${deg}deg)` }}
          >
            <span className="chat-lab__stream-sparkler__spark-line" />
          </span>
        ))}
      </span>
    </span>
  );
}
