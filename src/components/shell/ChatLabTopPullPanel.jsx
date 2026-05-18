import { cn } from "../../ui/cn.js";
import { useI18n } from "../../context/I18nContext.jsx";
import NavSettingsIcon from "../../assets/svg/NavSettingsIcon.jsx";
import { useNavigate } from "react-router-dom";

export default function ChatLabTopPullPanel({ expanded, onToggle }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const entries = [
    {
      id: "settings",
      icon: <NavSettingsIcon className="w-full h-full" />,
      label: t("nav.settings"),
      onClick: () => {
        navigate("/settings");
        onToggle?.();
      },
    },
    {
      id: "profile",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      ),
      label: t("nav.profile"),
      onClick: () => onToggle?.(),
    },
    {
      id: "help",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-full h-full">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 9a3 3 0 1 1 6 0c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
      label: t("nav.help"),
      onClick: () => onToggle?.(),
    },
  ];

  return (
    <div className="chat-lab-top-pull">
      {/* 下拉面板 - 宽度占满 */}
      <div
        className={cn(
          "chat-lab-top-pull__panel",
          "transition-all duration-300 ease-out",
          expanded && "chat-lab-top-pull__panel--expanded"
        )}
        aria-hidden={!expanded}
      >
        <div className="chat-lab-top-pull__panel-inner">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="chat-lab-top-pull__entry"
              onClick={entry.onClick}
            >
              <span className="chat-lab-top-pull__entry-icon">
                {entry.icon}
              </span>
              <span className="chat-lab-top-pull__entry-label">
                {entry.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 垂直线 + 圆形 */}
      <div className="chat-lab-top-pull__wire-orb">
        {/* 垂直线 */}
        <div className="chat-lab-top-pull__wire" />

        {/* 圆形按钮 */}
        <button
          type="button"
          className="chat-lab-top-pull__orb"
          onClick={onToggle}
          aria-label={expanded ? t("nav.closePanel") : t("nav.openPanel")}
          aria-expanded={expanded}
        >
          <svg
            className="chat-lab-top-pull__orb-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 15 12 9 18 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}