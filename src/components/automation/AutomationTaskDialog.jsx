import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, GitBranch } from "lucide-react";
import {
  Button,
  DatePicker,
  DateRangePicker,
  Dialog,
  Form,
  Input,
  Radio,
  Select as TSelect,
  Space,
  Textarea,
  TimePicker,
  MessagePlugin,
} from "tdesign-react";
import "tdesign-react/es/message/style/index.css";
import { useWechatChannelAuth } from "../../chat/useWechatChannelAuth.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { useStudio } from "../../context/StudioContext.jsx";
import { ComposerAgentToolbarPicker } from "../chat-lab/ChatLabComposerAgents.jsx";
import { ComposerSkillToolbarPicker } from "../chat-lab/ChatLabComposerSkills.jsx";
import { listSkillsForPicker } from "../../skills/skillRegistry.js";
import { useSkillEnvironment } from "../../skills/useSkillEnvironment.js";
import { listWorkflowsForPicker } from "../../workflow/workflowRuntimeRegistry.js";
import { osPopupAttach } from "../../ui/osPopupShared.js";

const { FormItem } = Form;

const DIALOG_POPUP = {
  attach: osPopupAttach,
  placement: "bottom-start",
  zIndex: 6500,
  popperOptions: {
    strategy: "fixed",
    modifiers: [
      { name: "offset", options: { offset: [0, 4] } },
      { name: "flip", enabled: false },
      { name: "preventOverflow", options: { padding: 8 } },
    ],
  },
};
const MESSAGE_Z_INDEX = 10001;

/** @param {{ children: import("react").ReactNode }} props */
function RequiredLabel({ children }) {
  return (
    <span className="automation-task-dialog__label">
      {children}
      <span className="automation-task-dialog__required" aria-hidden="true">
        *
      </span>
    </span>
  );
}
const PERIOD_CYCLE_OPTIONS = [
  { value: "daily", labelKey: "automationPage.taskPeriodDaily" },
  { value: "weekly", labelKey: "automationPage.taskPeriodWeekly" },
  { value: "monthly", labelKey: "automationPage.taskPeriodMonthly" },
];
const INTERVAL_UNIT_OPTIONS = [
  { value: "minute", labelKey: "automationPage.taskIntervalUnitMinute" },
  { value: "hour", labelKey: "automationPage.taskIntervalUnitHour" },
  { value: "day", labelKey: "automationPage.taskIntervalUnitDay" },
  { value: "month", labelKey: "automationPage.taskIntervalUnitMonth" },
  { value: "quarter", labelKey: "automationPage.taskIntervalUnitQuarter" },
  { value: "year", labelKey: "automationPage.taskIntervalUnitYear" },
];

/** @typedef {{
 *   name: string;
 *   prompt: string;
 *   modelId: string;
 *   agentId: string;
 *   skillRow: import("../../skills/skillRegistry.js").SkillPickRow | null;
 *   workflowId: string;
 *   channel: string;
 *   frequencyMode: "period" | "interval" | "once";
 *   periodCycle: string;
 *   periodTime: string;
 *   intervalValue: number;
 *   intervalUnit: string;
 *   onceDate: string;
 *   onceTime: string;
 *   effectiveRange: string[];
 * }} AutomationTaskDraft */

/** @returns {AutomationTaskDraft} */
function emptyDraft() {
  return {
    name: "",
    prompt: "",
    modelId: "",
    agentId: "",
    skillRow: null,
    workflowId: "",
    channel: "",
    frequencyMode: "period",
    periodCycle: "daily",
    periodTime: "09:00",
    intervalValue: 1,
    intervalUnit: "hour",
    onceDate: "",
    onceTime: "09:00",
    effectiveRange: [],
  };
}

/**
 * @param {{
 *   open: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   onSubmit?: (draft: AutomationTaskDraft) => void | Promise<void>;
 *   submitting?: boolean;
 * }} props
 */
export default function AutomationTaskDialog({ open, onOpenChange, onSubmit, submitting = false }) {
  const { t } = useI18n();
  const { agents, mainAgent } = useStudio();
  const { status: wechatStatus } = useWechatChannelAuth({ active: open });
  const skillEnv = useSkillEnvironment();
  const skillPickEnv = useMemo(
    () => (skillEnv.loading ? { platform: skillEnv.platform, loading: true } : skillEnv),
    [skillEnv],
  );
  const [config, setConfig] = useState(/** @type {* | null} */ (null));
  const [workflowPickerBump, setWorkflowPickerBump] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState(
    /** @type {{ name: string; prompt: string; channel: string }} */ ({
      name: "",
      prompt: "",
      channel: "",
    }),
  );

  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setFieldErrors({ name: "", prompt: "", channel: "" });
    let cancelled = false;
    (async () => {
      try {
        const c = await window.studioBridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") setConfig(c);
      } catch {
        if (!cancelled) setConfig(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const onWorkflowLibChange = () => setWorkflowPickerBump((n) => n + 1);
    window.addEventListener("openstudio-workflow-library-changed", onWorkflowLibChange);
    return () => window.removeEventListener("openstudio-workflow-library-changed", onWorkflowLibChange);
  }, []);

  const skillPickList = useMemo(() => listSkillsForPicker(skillPickEnv), [skillPickEnv]);
  const workflowPickList = useMemo(() => {
    void workflowPickerBump;
    return listWorkflowsForPicker();
  }, [workflowPickerBump]);

  const workflowLocked = Boolean(String(draft.workflowId ?? "").trim());

  const enabledModelOptions = useMemo(() => {
    const profiles = Array.isArray(config?.modelProfiles) ? config.modelProfiles : [];
    const activeId = typeof config?.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
    const enabledIds = Array.isArray(config?.enabledModelProfileIds)
      ? config.enabledModelProfileIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)
      : (activeId ? [activeId] : []);
    return enabledIds
      .map((id) => profiles.find((p) => p && p.id === id))
      .filter(Boolean)
      .map((p) => {
        const modelId = String(p.modelId ?? "").trim();
        return { value: p.id, label: modelId || t("chatLab.modelNeedConfig") };
      });
  }, [config?.enabledModelProfileIds, config?.modelProfiles, t]);

  const workflowPickerOptions = useMemo(
    () =>
      workflowPickList.map((row) => ({
        value: row.id,
        label: row.label || row.id,
      })),
    [workflowPickList],
  );

  const periodCycleOptions = useMemo(
    () => PERIOD_CYCLE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  const intervalUnitOptions = useMemo(
    () => INTERVAL_UNIT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );

  const channelOptions = useMemo(
    () => [
      { value: "open-studio", label: t("automationPage.taskChannelOpenStudio") },
      {
        value: "wechat",
        label: t("automationPage.taskChannelWechat"),
        disabled: !wechatStatus.enabled || !wechatStatus.connected,
      },
    ],
    [t, wechatStatus.connected, wechatStatus.enabled],
  );

  useEffect(() => {
    if (!open) return;
    setDraft((prev) => {
      const allowed = new Set(
        channelOptions.filter((o) => !o.disabled).map((o) => String(o.value)),
      );
      if (!prev.channel || allowed.has(prev.channel)) return prev;
      return { ...prev, channel: "" };
    });
  }, [channelOptions, open]);

  useEffect(() => {
    if (!open) return;
    const globalActiveId = typeof config?.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
    const next =
      enabledModelOptions.some((o) => o.value === globalActiveId)
        ? globalActiveId
        : (enabledModelOptions[0]?.value ?? "");
    setDraft((prev) => (prev.modelId ? prev : { ...prev, modelId: next }));
  }, [open, config?.activeModelProfileId, enabledModelOptions]);

  useEffect(() => {
    if (!open) return;
    const defaultAgentId = mainAgent?.id ?? agents[0]?.id ?? "";
    setDraft((prev) => (prev.agentId ? prev : { ...prev, agentId: defaultAgentId }));
  }, [agents, mainAgent?.id, open]);

  const patchDraft = useCallback((patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      if ("name" in patch) next.name = "";
      if ("prompt" in patch) next.prompt = "";
      if ("channel" in patch) next.channel = "";
      return next;
    });
  }, []);

  const collectFieldErrors = useCallback(() => {
    const allowedChannels = new Set(
      channelOptions.filter((o) => !o.disabled).map((o) => String(o.value)),
    );
    return {
      name: draft.name.trim() ? "" : t("automationPage.taskNameRequired"),
      prompt: draft.prompt.trim() ? "" : t("automationPage.taskPromptRequired"),
      channel:
        draft.channel.trim() && allowedChannels.has(draft.channel.trim())
          ? ""
          : t("automationPage.taskChannelRequired"),
    };
  }, [channelOptions, draft.channel, draft.name, draft.prompt, t]);

  const showValidationError = useCallback((content) => {
    MessagePlugin.error({
      content,
      zIndex: MESSAGE_Z_INDEX,
      attach: () => document.body,
      placement: "top",
      duration: 3000,
    });
  }, []);

  const handleConfirm = () => {
    const nextErrors = collectFieldErrors();
    setFieldErrors(nextErrors);
    const message = nextErrors.name || nextErrors.prompt || nextErrors.channel;
    if (message) {
      showValidationError(message);
      return;
    }
    onSubmit?.(draft);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog
      visible={open}
      attach="body"
      placement="center"
      header={t("automationPage.taskDialogTitle")}
      width={560}
      zIndex={6000}
      destroyOnClose={false}
      closeOnOverlayClick
      closeOnEscKeydown
      dialogClassName="os-tdesign-dialog os-tdesign-dialog--automation-task"
      onClose={handleCancel}
      footer={
        <Space size="small">
          <Button variant="outline" onClick={handleCancel}>
            {t("automationPage.taskCancel")}
          </Button>
          <Button theme="primary" loading={submitting} disabled={submitting} onClick={handleConfirm}>
            {t("automationPage.taskAdd")}
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" labelAlign="top" className="automation-task-dialog__form">
        <FormItem label={<RequiredLabel>{t("automationPage.taskName")}</RequiredLabel>}>
          <Input
            value={draft.name}
            placeholder={t("automationPage.taskNamePlaceholder")}
            status={fieldErrors.name ? "error" : "default"}
            tips={fieldErrors.name || undefined}
            onChange={(value) => patchDraft({ name: String(value ?? "") })}
          />
        </FormItem>

        <FormItem label={<RequiredLabel>{t("automationPage.taskPrompt")}</RequiredLabel>}>
          <div
            className={fieldErrors.prompt ? "automation-task-dialog__prompt automation-task-dialog__prompt--error" : "automation-task-dialog__prompt"}
          >
            <Textarea
              value={draft.prompt}
              autosize={{ minRows: 4, maxRows: 10 }}
              placeholder={t("automationPage.taskPromptPlaceholder")}
              status={fieldErrors.prompt ? "error" : "default"}
              onChange={(value) => patchDraft({ prompt: String(value ?? "") })}
            />
            <Space size="small" className="automation-task-dialog__prompt-toolbar">
              <ComposerAgentToolbarPicker
                agents={agents}
                value={draft.agentId}
                disabled={workflowLocked || agents.length === 0}
                popupZIndex={6500}
                popupProps={DIALOG_POPUP}
                placeholder={t("automationPage.taskAgentPlaceholder")}
                title={workflowLocked ? t("automationPage.taskAgentWorkflowLocked") : t("automationPage.taskAgent")}
                t={t}
                onChange={(agentId) => patchDraft({ agentId })}
              />
              <TSelect
                borderless
                autoWidth
                prefixIcon={<Cpu size={14} strokeWidth={2} aria-hidden />}
                placeholder={
                  enabledModelOptions.length > 0
                    ? t("chatLab.toolbarAuto")
                    : t("chatLab.modelNeedConfig")
                }
                value={enabledModelOptions.length > 0 ? draft.modelId : ""}
                options={enabledModelOptions}
                className="chat-lab__pill-model"
                disabled={enabledModelOptions.length === 0 || workflowLocked}
                title={workflowLocked ? t("automationPage.taskModelWorkflowLocked") : undefined}
                popupProps={DIALOG_POPUP}
                onChange={(value) => patchDraft({ modelId: String(value ?? "") })}
              />
              <ComposerSkillToolbarPicker
                skills={skillPickList}
                selected={draft.skillRow}
                popupZIndex={6500}
                popupProps={DIALOG_POPUP}
                onSelect={(row) => patchDraft({ skillRow: row })}
                t={t}
              />
              <TSelect
                borderless
                autoWidth
                prefixIcon={<GitBranch size={14} strokeWidth={2} aria-hidden />}
                clearable={Boolean(draft.workflowId)}
                placeholder={t("chatLab.toolbarWorkflow")}
                value={draft.workflowId}
                options={workflowPickerOptions}
                className="chat-lab__pill-workflow"
                title={t("chatLab.toolbarWorkflowHint")}
                popupProps={DIALOG_POPUP}
                onClear={() => patchDraft({ workflowId: "" })}
                onChange={(value) => patchDraft({ workflowId: String(value ?? "") })}
              />
            </Space>
            {fieldErrors.prompt ? (
              <p className="automation-task-dialog__field-error" role="alert">
                {fieldErrors.prompt}
              </p>
            ) : null}
          </div>
        </FormItem>

        <FormItem label={<RequiredLabel>{t("automationPage.taskChannel")}</RequiredLabel>}>
          <TSelect
            value={draft.channel}
            options={channelOptions}
            placeholder={t("automationPage.taskChannelPlaceholder")}
            status={fieldErrors.channel ? "error" : "default"}
            tips={fieldErrors.channel || undefined}
            popupProps={DIALOG_POPUP}
            onChange={(value) => patchDraft({ channel: String(value ?? "") })}
          />
        </FormItem>

        <FormItem label={t("automationPage.taskFrequency")}>
          <Space direction="vertical" size="medium" className="automation-task-dialog__frequency">
            <Radio.Group
              theme="button"
              variant="default-filled"
              value={draft.frequencyMode}
              onChange={(value) => patchDraft({ frequencyMode: String(value ?? "period") })}
            >
              <Radio.Button value="period">{t("automationPage.taskFrequencyPeriod")}</Radio.Button>
              <Radio.Button value="interval">{t("automationPage.taskFrequencyInterval")}</Radio.Button>
              <Radio.Button value="once">{t("automationPage.taskFrequencyOnce")}</Radio.Button>
            </Radio.Group>

            {draft.frequencyMode === "period" ? (
              <Space size="small" className="automation-task-dialog__frequency-row">
                <TSelect
                  value={draft.periodCycle}
                  options={periodCycleOptions}
                  popupProps={DIALOG_POPUP}
                  onChange={(value) => patchDraft({ periodCycle: String(value ?? "daily") })}
                />
                <TimePicker
                  format="HH:mm"
                  value={draft.periodTime}
                  clearable={false}
                  onChange={(value) => patchDraft({ periodTime: String(value ?? "09:00") })}
                  popupProps={DIALOG_POPUP}
                />
              </Space>
            ) : null}

            {draft.frequencyMode === "interval" ? (
              <Space size="small" align="center" className="automation-task-dialog__frequency-row automation-task-dialog__frequency-row--compact">
                <span className="automation-task-dialog__frequency-prefix">{t("automationPage.taskIntervalEvery")}</span>
                <Input
                  type="number"
                  min={1}
                  value={String(draft.intervalValue)}
                  className="automation-task-dialog__interval-input"
                  onChange={(value) => {
                    const n = Number.parseInt(String(value ?? ""), 10);
                    patchDraft({ intervalValue: Number.isFinite(n) && n > 0 ? n : 1 });
                  }}
                />
                <TSelect
                  value={draft.intervalUnit}
                  options={intervalUnitOptions}
                  className="automation-task-dialog__interval-unit"
                  popupProps={DIALOG_POPUP}
                  onChange={(value) => patchDraft({ intervalUnit: String(value ?? "hour") })}
                />
              </Space>
            ) : null}

            {draft.frequencyMode === "once" ? (
              <Space size="small" className="automation-task-dialog__frequency-row">
                <DatePicker
                  value={draft.onceDate}
                  placeholder={t("automationPage.taskOnceDatePlaceholder")}
                  popupProps={DIALOG_POPUP}
                  onChange={(value) => patchDraft({ onceDate: String(value ?? "") })}
                />
                <TimePicker
                  format="HH:mm"
                  value={draft.onceTime}
                  clearable={false}
                  onChange={(value) => patchDraft({ onceTime: String(value ?? "09:00") })}
                  popupProps={DIALOG_POPUP}
                />
              </Space>
            ) : null}
          </Space>
        </FormItem>

        <FormItem
          label={
            <span>
              {t("automationPage.taskEffectiveRange")}
              <span className="automation-task-dialog__label-hint">{t("automationPage.taskEffectiveRangeHint")}</span>
            </span>
          }
        >
          <DateRangePicker
            clearable
            value={draft.effectiveRange}
            placeholder={[t("automationPage.taskEffectiveRangePlaceholder"), t("automationPage.taskEffectiveRangePlaceholder")]}
            popupProps={DIALOG_POPUP}
            onChange={(value) => patchDraft({ effectiveRange: Array.isArray(value) ? value.map(String) : [] })}
          />
        </FormItem>
      </Form>
    </Dialog>
  );
}
