import { useModelSettings } from "../../context/ModelSettingsContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import Checkbox from "../../ui/Checkbox.jsx";
import TextField from "../../ui/TextField.jsx";
import ModelSettingsFooter from "./ModelSettingsFooter.jsx";

export default function ModelAdvancedPanel() {
  const {
    gateway,
    setGateway,
    gatewayToken,
    setGatewayToken,
    hasGatewayToken,
    chatLabLeanPlugins,
    setChatLabLeanPlugins,
    sessionKey,
    setSessionKey,
  } = useModelSettings();
  const { t } = useI18n();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-5">
        <div className="flex flex-col gap-4">
          <Checkbox
            id="chat-lab-lean-plugins"
            checked={chatLabLeanPlugins}
            onCheckedChange={setChatLabLeanPlugins}
            label={t("userConfig.chatLabLeanPlugins")}
            className="items-start text-left [&>span:last-child]:text-[0.8rem] [&>span:last-child]:leading-snug [&>span:last-child]:text-[var(--os-text)]"
          />
          <p className="text-[0.72rem] leading-relaxed text-[var(--os-text-faint)]">{t("userConfig.chatLabLeanPluginsHint")}</p>
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-[var(--os-text-muted)]">{t("userConfig.sessionKey")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <TextField
                className="min-w-0 flex-1"
                value={sessionKey}
                onChange={(e) => setSessionKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("userConfig.sessionKeyPlaceholder")}
              />
              <button
                type="button"
                className="shrink-0 rounded-lg border border-[var(--os-border-strong)] bg-[var(--os-bg-elevated)] px-3 py-2 text-[0.78rem] font-medium text-[var(--os-text)] transition hover:bg-[var(--os-bg-hover)]"
                onClick={() => {
                  const id =
                    typeof crypto !== "undefined" && crypto.randomUUID
                      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
                      : Date.now().toString(36);
                  setSessionKey(`agent:dev:os-${id}`);
                }}
              >
                {t("userConfig.sessionKeyGenerate")}
              </button>
            </div>
            <p className="text-[0.72rem] leading-relaxed text-[var(--os-text-faint)]">{t("userConfig.sessionKeyHint")}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-[var(--os-text-muted)]">{t("userConfig.gatewayUrl")}</span>
            <TextField value={gateway} onChange={(e) => setGateway(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-medium text-[var(--os-text-muted)]">
              {t("userConfig.gatewayToken")}
              {hasGatewayToken ? ` ${t("userConfig.gatewayTokenSavedSuffix")}` : ""}
            </span>
            <TextField
              type="password"
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder={t("userConfig.gatewayTokenPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="text-[0.72rem] leading-relaxed text-[var(--os-text-faint)]">{t("userConfig.gatewayAdvancedHint")}</p>
        </div>
      </div>
      <ModelSettingsFooter />
    </div>
  );
}
