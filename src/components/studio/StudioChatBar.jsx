import { useState } from "react";
import { useStudio } from "../../context/StudioContext.jsx";
import { AgentMode } from "../../studio/modes.js";

export default function StudioChatBar() {
  const { setAgentMode, agents } = useStudio();
  const primaryId = agents[0]?.id;
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t || !primaryId) return;
    setAgentMode(primaryId, AgentMode.THINKING);
    setText("");
    window.setTimeout(() => {
      setAgentMode(primaryId, AgentMode.WORKING);
    }, 400);
    window.setTimeout(() => {
      setAgentMode(primaryId, AgentMode.BREAK);
    }, 1800);
  };

  return (
    <footer className="studio-chat">
      <div className="studio-chat__task">
        <span className="studio-chat__badge">任务完成</span>
        <span className="muted">（占位通知 · 阶段 C 接 OpenClaw 流）</span>
      </div>
      <div className="studio-chat__row">
        <input
          className="studio-chat__input"
          placeholder="描述任务或提问，Enter 发送…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button type="button" className="btn-primary" onClick={send}>
          发送
        </button>
      </div>
    </footer>
  );
}
