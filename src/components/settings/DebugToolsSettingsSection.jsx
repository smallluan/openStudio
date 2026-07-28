import { useEffect, useState } from "react";
import { useI18n } from "../../context/I18nContext.jsx";
import { Switch, Typography } from "tdesign-react";
import { cn } from "../../ui/cn.js";

/**
 * @param {{ title: string; children: import("react").ReactNode }} props
 */
function DebugSettingRow({ title, children }) {
  return (
    <div className="general-setting-row">
      <Typography.Text className="general-setting-row__label">{title}</Typography.Text>
      <div className="general-setting-row__control">{children}</div>
    </div>
  );
}

/** Raw trace panel + automation sidebar debug controls. */
export default function DebugToolsSettingsSection() {
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [rawTraceEnabled, setRawTraceEnabled] = useState(false);
  const [showAutomationDebugInput, setShowAutomationDebugInput] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          setRawTraceEnabled(Boolean(c.chatLabRawTraceEnabled));
          setShowAutomationDebugInput(Boolean(c.chatLabShowAutomationDebugInput));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const persistRawTraceEnabled = async (next) => {
    setRawTraceEnabled(next);
    try {
      await bridge?.setUserConfig?.({ chatLabRawTraceEnabled: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") setRawTraceEnabled(Boolean(c.chatLabRawTraceEnabled));
      } catch {
        setRawTraceEnabled(false);
      }
    }
  };

  const persistShowAutomationDebugInput = async (next) => {
    setShowAutomationDebugInput(next);
    try {
      await bridge?.setUserConfig?.({ chatLabShowAutomationDebugInput: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") setShowAutomationDebugInput(Boolean(c.chatLabShowAutomationDebugInput));
      } catch {
        setShowAutomationDebugInput(false);
      }
    }
  };

  return (
    <div className={cn("general-settings", "w-full")}>
      <DebugSettingRow title={t("settings.rawTraceEnabled")}>
        <Switch
          id="settings-raw-trace"
          aria-label={t("settings.rawTraceEnabledTitle")}
          value={rawTraceEnabled}
          onChange={(v) => void persistRawTraceEnabled(Boolean(v))}
        />
      </DebugSettingRow>

      <DebugSettingRow title={t("settings.showAutomationDebugInput")}>
        <Switch
          id="settings-show-automation-debug-input"
          aria-label={t("settings.showAutomationDebugInputTitle")}
          value={showAutomationDebugInput}
          onChange={(v) => void persistShowAutomationDebugInput(Boolean(v))}
        />
      </DebugSettingRow>
    </div>
  );
}
