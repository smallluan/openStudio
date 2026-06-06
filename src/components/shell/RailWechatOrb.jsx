import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import WechatIcon from "../../assets/svg/WechatIcon.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import FluidPopupAnimatedSurface from "../../ui/FluidPopupAnimatedSurface.jsx";
import { cn } from "../../ui/cn.js";
import { useFloatingPresence } from "../../ui/useFloatingPresence.js";

export default function RailWechatOrb({ narrow = false }) {
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const [open, setOpen] = useState(false);
  const { present, leaving, finishLeave, surfaceKey } = useFloatingPresence(open);
  const [status, setStatus] = useState(
    /** @type {{ enabled: boolean; available: boolean; connected: boolean; accountName: string; qrText: string; qrImageDataUrl: string; lastError: string }} */ ({
      enabled: true,
      available: false,
      connected: false,
      accountName: "",
      qrText: "",
      qrImageDataUrl: "",
      lastError: "",
    }),
  );
  const [qrLoading, setQrLoading] = useState(false);

  const isMethodMissingMsg = (msg) =>
    /unknown[_\s-]?method|method[_\s-]?not[_\s-]?found|not[_\s-]?implemented|unsupported/i.test(String(msg ?? ""));

  const { refs, floatingStyles, context } = useFloating({
    open: present,
    onOpenChange: setOpen,
    placement: "right-end",
    strategy: "fixed",
    middleware: [offset(10), flip({ padding: 10 }), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => {
    if (!present) return undefined;
    let alive = true;
    const pullStatus = async () => {
      try {
        if (!bridge?.wechatAuthStatus) return;
        const r = await bridge.wechatAuthStatus();
        if (!alive) return;
        if (r?.ok) {
          setStatus((prev) => ({
            ...prev,
            enabled: r.enabled !== false,
            available: true,
            connected: Boolean(r.connected),
            accountName: String(r.accountName ?? ""),
            lastError: "",
          }));
          return { connected: Boolean(r.connected) };
        } else {
          const msg = String(r?.message ?? "");
          if (/No handler registered/i.test(msg)) {
            setStatus((prev) => ({
              ...prev,
              available: false,
              connected: false,
              lastError: t("chatLab.wechatNeedRestartMain"),
            }));
            return;
          }
          if (isMethodMissingMsg(msg)) {
            return { connected: false };
          }
          setStatus((prev) => ({ ...prev, lastError: msg || "wechat_status_failed" }));
          return { connected: false };
        }
      } catch (err) {
        const msg = String(err?.message ?? err);
        if (/No handler registered/i.test(msg)) {
          setStatus((prev) => ({
            ...prev,
            available: false,
            connected: false,
            lastError: t("chatLab.wechatNeedRestartMain"),
          }));
          return;
        }
        if (isMethodMissingMsg(msg)) {
          return { connected: false };
        }
        setStatus((prev) => ({ ...prev, lastError: msg }));
        return { connected: false };
      }
    };
    const ensureQr = async () => {
      setQrLoading(true);
      try {
        if (!bridge?.wechatAuthStart) return;
        const r = await bridge.wechatAuthStart();
        if (!alive) return;
        if (!r?.ok) {
          const msg = String(r?.message ?? "wechat_auth_start_failed");
          const nextMsg = /wechat_plugin_not_loaded/i.test(msg) ? t("chatLab.wechatPluginNotLoaded") : msg;
          setStatus((prev) => ({ ...prev, lastError: nextMsg }));
          return;
        }
        const qrText = String(r.qrText ?? "");
        let qrImageDataUrl = String(r.qrImageDataUrl ?? "");
        if (!qrImageDataUrl && qrText) {
          try {
            qrImageDataUrl = await QRCode.toDataURL(qrText, {
              margin: 1,
              width: 220,
              errorCorrectionLevel: "M",
            });
          } catch {
            /* keep text fallback */
          }
        }
        setStatus((prev) => ({ ...prev, available: true, qrText, qrImageDataUrl, lastError: "" }));
      } catch (err) {
        if (!alive) return;
        setStatus((prev) => ({ ...prev, lastError: String(err?.message ?? err) }));
      } finally {
        if (alive) setQrLoading(false);
      }
    };
    void pullStatus().then((st) => {
      if (!alive) return;
      const needQr = !st?.connected;
      if (needQr) void ensureQr();
    });
    const off = bridge?.onWechatStatus?.((evt) => {
      const type = String(evt?.type ?? "");
      if (type === "auth_started") {
        const qrText = String(evt.qrText ?? "");
        const qrImageDataUrlRaw = String(evt.qrImageDataUrl ?? "");
        if (!qrImageDataUrlRaw && qrText) {
          void QRCode.toDataURL(qrText, {
            margin: 1,
            width: 220,
            errorCorrectionLevel: "M",
          }).then((dataUrl) => {
            if (!alive) return;
            setStatus((prev) => ({
              ...prev,
              available: true,
              qrText,
              qrImageDataUrl: dataUrl || "",
              lastError: "",
            }));
          });
        } else {
          setStatus((prev) => ({
            ...prev,
            available: true,
            qrText,
            qrImageDataUrl: qrImageDataUrlRaw,
            lastError: "",
          }));
        }
        if (alive) setQrLoading(false);
      } else if (type === "auth_status") {
        setStatus((prev) => ({
          ...prev,
          available: true,
          connected: Boolean(evt.connected),
          accountName: String(evt.accountName ?? ""),
          lastError: "",
        }));
      } else if (type === "auth_disconnected") {
        setStatus((prev) => ({
          ...prev,
          connected: false,
          accountName: "",
          qrText: "",
          qrImageDataUrl: "",
          lastError: "",
        }));
      }
    });
    return () => {
      alive = false;
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [present, bridge, t]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          "rail-wechat-orb__hit group relative flex shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0.5 outline-none transition-[transform,color] duration-[320ms] focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--os-bg-panel)]",
          "text-[var(--os-rail-text-muted)] hover:text-[var(--os-rail-text)]",
          narrow ? "aspect-square w-[2.25rem] rounded-lg" : "rounded-[10px]",
        )}
        title={t("chatLab.channelWechat")}
        aria-expanded={present}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        {...getReferenceProps()}
      >
        <span className="rail-wechat-orb__liquid-inner relative flex size-[1.68rem] items-center justify-center">
          <span className="rail-wechat-orb__liquid-blob" aria-hidden />
          <WechatIcon className="relative z-[1] opacity-[0.94]" />
        </span>
      </button>
      {present ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="outline-none z-[6200] w-[min(90vw,320px)]"
              {...getFloatingProps()}
            >
              <FluidPopupAnimatedSurface
                key={surfaceKey}
                leaving={leaving}
                finishLeave={finishLeave}
                placement={context.placement}
                morphBr="12px"
                className="rail-wechat-popup flex w-full flex-col overflow-hidden rounded-[12px] border border-[var(--os-border)] bg-[var(--os-bg-panel)] p-3 shadow-[0_16px_38px_rgba(15,23,42,0.18)]"
              >
                <div className="rail-wechat-popup__title">{t("chatLab.wechatBindTitle")}</div>
                {status.connected ? (
                  <div className="rail-wechat-popup__body">
                    <div className="rail-wechat-popup__status">
                      {t("chatLab.wechatBoundAs", { name: status.accountName || "WeChat" })}
                    </div>
                    <button
                      type="button"
                      className="rail-wechat-popup__btn"
                      onClick={() => void bridge?.wechatAuthDisconnect?.()}
                    >
                      {t("chatLab.wechatDisconnect")}
                    </button>
                  </div>
                ) : (
                  <div className="rail-wechat-popup__body">
                    {status.qrImageDataUrl ? (
                      <img src={status.qrImageDataUrl} alt={t("chatLab.wechatQrImageAlt")} className="rail-wechat-popup__qr-img" />
                    ) : (
                      <div className="rail-wechat-popup__qr-placeholder">
                        {status.qrText
                          ? t("chatLab.wechatQrHint", { qr: status.qrText })
                          : qrLoading
                            ? t("chatLab.wechatQrLoading")
                            : ""}
                      </div>
                    )}
                  </div>
                )}
                {status.lastError ? <div className="rail-wechat-popup__error">{status.lastError}</div> : null}
              </FluidPopupAnimatedSurface>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
