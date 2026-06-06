import WechatIcon from "../../assets/svg/WechatIcon.jsx";
import { useWechatChannelAuth } from "../../chat/useWechatChannelAuth.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

export default function WechatChannelSettings() {
  const { t } = useI18n();
  const { status, qrLoading, refreshStatus, startAuth, disconnect } = useWechatChannelAuth();

  const statusLabel = !status.enabled
    ? t("chatLab.wechatStatusDisabled")
    : status.connected
      ? t("chatLab.wechatStatusConnected")
      : t("chatLab.wechatStatusDisconnected");

  return (
    <section className="channel-settings__wechat overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--os-border)_88%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_96%,var(--os-bg-subtle))] shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_8px_28px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-3 border-b border-[color-mix(in_srgb,var(--os-border)_72%,transparent)] px-4 py-3.5 sm:px-5 sm:py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--os-bg-subtle)_88%,var(--os-border))]">
          <WechatIcon className="size-5 opacity-90" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--os-text)]">
            {t("chatLab.wechatBindTitle")}
          </h2>
          <p
            className={cn(
              "mt-0.5 text-[0.8125rem]",
              status.connected ? "text-[var(--os-success,#16a34a)]" : "text-[var(--os-text-muted)]",
            )}
          >
            {statusLabel}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5">
        {status.connected ? (
          <>
            <p className="text-[0.875rem] text-[var(--os-text-muted)]">
              {t("chatLab.wechatBoundAs", { name: status.accountName || "WeChat" })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[color-mix(in_srgb,var(--os-border)_88%,transparent)] bg-[var(--os-bg-elevated)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-text)] transition hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_70%,var(--os-bg-elevated))]"
                onClick={() => void refreshStatus()}
              >
                {t("chatLab.wechatRefreshStatus")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[color-mix(in_srgb,var(--os-danger,#dc2626)_40%,transparent)] bg-[color-mix(in_srgb,var(--os-danger,#dc2626)_10%,transparent)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-danger,#dc2626)] transition hover:bg-[color-mix(in_srgb,var(--os-danger,#dc2626)_16%,transparent)]"
                onClick={() => void disconnect()}
              >
                {t("chatLab.wechatDisconnect")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--os-border)_80%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-subtle)_55%,transparent)] px-4 py-5">
              {status.qrImageDataUrl ? (
                <img
                  src={status.qrImageDataUrl}
                  alt={t("chatLab.wechatQrImageAlt")}
                  className="size-[11rem] rounded-lg bg-white p-2 shadow-sm"
                />
              ) : (
                <p className="max-w-[18rem] text-center text-[0.8125rem] leading-relaxed text-[var(--os-text-muted)]">
                  {status.qrText
                    ? t("chatLab.wechatQrHint", { qr: status.qrText })
                    : qrLoading
                      ? t("chatLab.wechatQrLoading")
                      : t("chatLab.wechatNeedScan")}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--os-accent)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-accent-fg,#fff)] transition hover:opacity-90 disabled:opacity-50"
                disabled={qrLoading}
                onClick={() => void startAuth()}
              >
                {t("chatLab.wechatStartAuth")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[color-mix(in_srgb,var(--os-border)_88%,transparent)] bg-[var(--os-bg-elevated)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--os-text)] transition hover:bg-[color-mix(in_srgb,var(--os-bg-subtle)_70%,var(--os-bg-elevated))]"
                onClick={() => void refreshStatus()}
              >
                {t("chatLab.wechatRefreshStatus")}
              </button>
            </div>
          </>
        )}

        {status.lastError ? (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--os-danger,#dc2626)_35%,transparent)] bg-[color-mix(in_srgb,var(--os-danger,#dc2626)_8%,transparent)] px-3 py-2 text-[0.8125rem] text-[var(--os-danger,#dc2626)]">
            {status.lastError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
