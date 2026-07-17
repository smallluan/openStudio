import { useState } from "react";
import { Button } from "@open-studio/udesign";
import { useI18n } from "../../context/I18nContext.jsx";
import { useStudio } from "../../context/StudioContext.jsx";
import { AgentMode } from "../../studio/modes.js";

export default function StudioChatBar() {
  const { t } = useI18n();
  const { setAgentMode, agents } = useStudio();
  const primaryId = agents[0]?.id;
  const [text, setText] = useState("");
  const canSend = Boolean(text.trim() && primaryId);

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
        <span className="studio-chat__badge">{t("studio.chat.taskDone")}</span>
        <span className="muted">{t("studio.chat.placeholderNote")}</span>
      </div>
      <div className="studio-chat__row">
        <input
          className="studio-chat__input"
          placeholder={t("studio.chat.inputPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <Button
          type="button"
          className={`btn-primary studio-chat__send ${canSend ? "studio-chat__send--ready" : ""}`}
          onClick={send}
          disabled={!canSend}
        >
          {t("studio.chat.send")}
        </Button>
      </div>
    </footer>
  );
}
