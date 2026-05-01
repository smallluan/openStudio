import { useModelSettings } from "../../context/ModelSettingsContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

export default function ModelSettingsFooter() {
  const { feedback, save } = useModelSettings();
  const { t } = useI18n();

  return (
    <div className="mt-4 flex shrink-0 items-center gap-3 pt-4">
      {feedback ?
        <span
          role={feedback.kind === "err" ? "alert" : "status"}
          className={cn(
            "min-w-0 flex-1 text-[0.72rem] leading-snug",
            feedback.kind === "ok" ? "text-[var(--os-text-muted)]" : "text-[var(--os-accent)]",
          )}
        >
          {feedback.text}
        </span>
      : (
        <span className="flex-1" aria-hidden />
      )}
      <button type="button" className="btn-primary shrink-0 px-4 py-2 text-[0.8125rem]" onClick={save}>
        {t("userConfig.save")}
      </button>
    </div>
  );
}
