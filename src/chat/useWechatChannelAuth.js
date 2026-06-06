import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../context/I18nContext.jsx";

/** @typedef {{ enabled: boolean; available: boolean; connected: boolean; accountName: string; qrText: string; qrImageDataUrl: string; lastError: string }} WechatChannelStatus */

const EMPTY_STATUS = /** @type {WechatChannelStatus} */ ({
  enabled: true,
  available: false,
  connected: false,
  accountName: "",
  qrText: "",
  qrImageDataUrl: "",
  lastError: "",
});

/** @param {string} msg */
function isMethodMissingMsg(msg) {
  return /unknown[_\s-]?method|method[_\s-]?not[_\s-]?found|not[_\s-]?implemented|unsupported/i.test(String(msg ?? ""));
}

/**
 * Shared WeChat channel auth state for settings UI (replaces rail popup orb).
 * @param {{ active?: boolean }} [opts] When false, skips polling / QR bootstrap.
 */
export function useWechatChannelAuth(opts) {
  const active = opts?.active !== false;
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [qrLoading, setQrLoading] = useState(false);

  const pullStatus = useCallback(async () => {
    try {
      if (!bridge?.wechatAuthStatus) return { connected: false };
      const r = await bridge.wechatAuthStatus();
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
      }
      const msg = String(r?.message ?? "");
      if (/No handler registered/i.test(msg)) {
        setStatus((prev) => ({
          ...prev,
          available: false,
          connected: false,
          lastError: t("chatLab.wechatNeedRestartMain"),
        }));
        return { connected: false };
      }
      if (isMethodMissingMsg(msg)) return { connected: false };
      setStatus((prev) => ({ ...prev, lastError: msg || "wechat_status_failed" }));
      return { connected: false };
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (/No handler registered/i.test(msg)) {
        setStatus((prev) => ({
          ...prev,
          available: false,
          connected: false,
          lastError: t("chatLab.wechatNeedRestartMain"),
        }));
        return { connected: false };
      }
      if (isMethodMissingMsg(msg)) return { connected: false };
      setStatus((prev) => ({ ...prev, lastError: msg }));
      return { connected: false };
    }
  }, [bridge, t]);

  const startAuth = useCallback(async () => {
    setQrLoading(true);
    try {
      if (!bridge?.wechatAuthStart) return;
      const r = await bridge.wechatAuthStart();
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
      setStatus((prev) => ({ ...prev, lastError: String(err?.message ?? err) }));
    } finally {
      setQrLoading(false);
    }
  }, [bridge, t]);

  const disconnect = useCallback(async () => {
    try {
      await bridge?.wechatAuthDisconnect?.();
    } catch {
      /* ignore */
    }
    setStatus((prev) => ({
      ...prev,
      connected: false,
      accountName: "",
      qrText: "",
      qrImageDataUrl: "",
      lastError: "",
    }));
  }, [bridge]);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;

    void pullStatus().then((st) => {
      if (!alive || st?.connected) return;
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
  }, [active, bridge, pullStatus]);

  return {
    status,
    qrLoading,
    refreshStatus: pullStatus,
    startAuth,
    disconnect,
  };
}
