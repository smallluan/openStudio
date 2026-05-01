import { useModelSettings } from "../../context/ModelSettingsContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import TextField from "../../ui/TextField.jsx";
import ModelSettingsFooter from "./ModelSettingsFooter.jsx";

export default function ModelAdvancedPanel() {
  const { gateway, setGateway } = useModelSettings();
  const { t } = useI18n();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-[var(--os-text-muted)]">{t("userConfig.gatewayUrl")}</span>
          <TextField value={gateway} onChange={(e) => setGateway(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <ModelSettingsFooter />
    </div>
  );
}
