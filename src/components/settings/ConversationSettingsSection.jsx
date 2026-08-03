import { useEffect, useMemo, useState } from "react";
import { normalizeLinkOpenMode, readLinkOpenModeLocal, writeLinkOpenModeLocal } from "../../chat/chatLabLinkOpenPreference.js";
import { useMotionPreference } from "../../context/MotionPreferenceContext.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { Input, Select as TSelect, Switch, Typography } from "tdesign-react";

const SETTINGS_SELECT_POPUP = { attach: () => document.body, zIndex: 2600 };
const BROWSER_AUTOMATION_MAX_STEPS_DEFAULT = 20;
const BROWSER_AUTOMATION_MAX_STEPS_MIN = 1;
const BROWSER_AUTOMATION_MAX_STEPS_MAX = 100;

function normalizeBrowserAutomationMaxSteps(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return BROWSER_AUTOMATION_MAX_STEPS_DEFAULT;
  return Math.min(
    BROWSER_AUTOMATION_MAX_STEPS_MAX,
    Math.max(BROWSER_AUTOMATION_MAX_STEPS_MIN, Math.floor(n)),
  );
}

function ConversationSettingRow({ title, children }) {
  return (
    <div className="general-setting-row">
      <Typography.Text className="general-setting-row__label">{title}</Typography.Text>
      <div className="general-setting-row__control">{children}</div>
    </div>
  );
}

/** Chat behavior and automation preferences. */
export default function ConversationSettingsSection() {
  const { t } = useI18n();
  const { mode: uiMotion, setMode: setUiMotion } = useMotionPreference();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;

  const [chatLabAutoTitle, setChatLabAutoTitle] = useState(false);
  const [chatLabGroupContinuousConversation, setChatLabGroupContinuousConversation] = useState(true);
  const [linkOpenMode, setLinkOpenMode] = useState(readLinkOpenModeLocal);
  const [browserAutomationMaxSteps, setBrowserAutomationMaxSteps] = useState(
    BROWSER_AUTOMATION_MAX_STEPS_DEFAULT,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
          setChatLabGroupContinuousConversation(
            typeof c.chatLabGroupContinuousConversation === "boolean"
              ? c.chatLabGroupContinuousConversation
              : true,
          );
          setBrowserAutomationMaxSteps(
            normalizeBrowserAutomationMaxSteps(c.chatLabBrowserAutomationMaxSteps),
          );
          if (c.chatLabLinkOpenMode === "external" || c.chatLabLinkOpenMode === "sidebar") {
            const mode = normalizeLinkOpenMode(c.chatLabLinkOpenMode);
            setLinkOpenMode(mode);
            writeLinkOpenModeLocal(mode);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const persistChatLabAutoTitle = async (next) => {
    setChatLabAutoTitle(next);
    try {
      await bridge?.setUserConfig?.({ chatLabAutoTitle: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") setChatLabAutoTitle(Boolean(c.chatLabAutoTitle));
      } catch {
        setChatLabAutoTitle(false);
      }
    }
  };

  const persistChatLabGroupContinuousConversation = async (next) => {
    setChatLabGroupContinuousConversation(next);
    try {
      await bridge?.setUserConfig?.({ chatLabGroupContinuousConversation: next });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") {
          setChatLabGroupContinuousConversation(
            typeof c.chatLabGroupContinuousConversation === "boolean"
              ? c.chatLabGroupContinuousConversation
              : true,
          );
        }
      } catch {
        setChatLabGroupContinuousConversation(true);
      }
    }
  };

  const persistLinkOpenMode = async (next) => {
    const mode = normalizeLinkOpenMode(next);
    setLinkOpenMode(mode);
    writeLinkOpenModeLocal(mode);
    try {
      await bridge?.setUserConfig?.({ chatLabLinkOpenMode: mode });
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (
          c &&
          typeof c === "object" &&
          (c.chatLabLinkOpenMode === "external" || c.chatLabLinkOpenMode === "sidebar")
        ) {
          const restored = normalizeLinkOpenMode(c.chatLabLinkOpenMode);
          setLinkOpenMode(restored);
          writeLinkOpenModeLocal(restored);
        }
      } catch {
        setLinkOpenMode(readLinkOpenModeLocal());
      }
    }
  };

  const persistBrowserAutomationMaxSteps = async (next) => {
    const value = normalizeBrowserAutomationMaxSteps(next);
    setBrowserAutomationMaxSteps(value);
    try {
      await bridge?.setUserConfig?.({ chatLabBrowserAutomationMaxSteps: value });
      window.dispatchEvent(
        new CustomEvent("openstudio-chatlab-browser-automation-max-steps", {
          detail: { maxSteps: value },
        }),
      );
    } catch {
      try {
        const c = await bridge?.getUserConfig?.();
        if (c && typeof c === "object") {
          setBrowserAutomationMaxSteps(
            normalizeBrowserAutomationMaxSteps(c.chatLabBrowserAutomationMaxSteps),
          );
        }
      } catch {
        setBrowserAutomationMaxSteps(BROWSER_AUTOMATION_MAX_STEPS_DEFAULT);
      }
    }
  };

  const uiMotionOptions = useMemo(
    () => [
      { value: "full", label: t("settings.uiMotion.full") },
      { value: "system", label: t("settings.uiMotion.system") },
      { value: "reduced", label: t("settings.uiMotion.reduced") },
    ],
    [t],
  );

  const linkOpenModeOptions = useMemo(
    () => [
      { value: "sidebar", label: t("settings.linkOpenMode.sidebar") },
      { value: "external", label: t("settings.linkOpenMode.external") },
    ],
    [t],
  );

  return (
    <div className="general-settings w-full">
      <ConversationSettingRow title={t("settings.uiMotionShort")}>
        <TSelect
          id="settings-ui-motion"
          borderless
          value={uiMotion}
          onChange={(v) => {
            if (v === "full" || v === "system" || v === "reduced") setUiMotion(v);
          }}
          options={uiMotionOptions}
          popupProps={SETTINGS_SELECT_POPUP}
          className="settings-select"
        />
      </ConversationSettingRow>

      <ConversationSettingRow title={t("settings.linkOpenModeShort")}>
        <TSelect
          id="settings-link-open-mode"
          borderless
          value={linkOpenMode}
          onChange={(v) => void persistLinkOpenMode(v)}
          options={linkOpenModeOptions}
          popupProps={SETTINGS_SELECT_POPUP}
          className="settings-select"
        />
      </ConversationSettingRow>

      <ConversationSettingRow title={t("settings.browserAutomationMaxSteps")}>
        <Input
          id="settings-browser-automation-max-steps"
          type="number"
          min={BROWSER_AUTOMATION_MAX_STEPS_MIN}
          max={BROWSER_AUTOMATION_MAX_STEPS_MAX}
          value={String(browserAutomationMaxSteps)}
          onChange={(value) => {
            const n = Number.parseInt(String(value ?? ""), 10);
            if (Number.isFinite(n)) setBrowserAutomationMaxSteps(normalizeBrowserAutomationMaxSteps(n));
          }}
          onBlur={() => void persistBrowserAutomationMaxSteps(browserAutomationMaxSteps)}
          className="settings-number-input"
        />
      </ConversationSettingRow>

      <ConversationSettingRow title={t("settings.autoSummarize")}>
        <Switch
          id="settings-auto-summarize"
          aria-label={t("settings.autoSummarizeTitle")}
          value={chatLabAutoTitle}
          onChange={(v) => void persistChatLabAutoTitle(Boolean(v))}
        />
      </ConversationSettingRow>

      <ConversationSettingRow title={t("settings.groupContinuousConversation")}>
        <Switch
          id="settings-group-continuous-conversation"
          aria-label={t("settings.groupContinuousConversationAria")}
          value={chatLabGroupContinuousConversation}
          onChange={(v) => void persistChatLabGroupContinuousConversation(Boolean(v))}
        />
      </ConversationSettingRow>
    </div>
  );
}
