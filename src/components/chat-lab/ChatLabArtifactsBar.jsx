import { useCallback } from "react";
import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useChatLabPreview } from "../../context/ChatLabPreviewContext.jsx";

/**
 * @param {{
 *   artifacts: import("../../chat/chatLabSessionArtifacts.js").SessionArtifact[];
 *   disabled?: boolean;
 * }} props
 */
export default function ChatLabArtifactsBar({ artifacts, disabled }) {
  const { t } = useI18n();
  const preview = useChatLabPreview();

  const onOpenOne = useCallback(
    (path) => {
      if (!preview?.openArtifactsPanel) return;
      preview.openArtifactsPanel(artifacts, path);
    },
    [artifacts, preview],
  );

  if (!artifacts.length) return null;

  return (
    <ul className="chat-lab-artifacts-bar" aria-label={t("chatLab.artifactsBarAria")}>
      {artifacts.map((a) => (
        <li key={a.path}>
          <button
            type="button"
            className={cn("chat-lab-artifacts-bar__chip", `chat-lab-artifacts-bar__chip--${a.op}`)}
            onClick={() => onOpenOne(a.path)}
            disabled={disabled || !preview}
            title={a.path}
          >
            <span className="chat-lab-artifacts-bar__chip-op">
              {a.op === "created" ? t("chatLab.artifactsCreated") : t("chatLab.artifactsModified")}
            </span>
            <span className="chat-lab-artifacts-bar__chip-name">{a.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
