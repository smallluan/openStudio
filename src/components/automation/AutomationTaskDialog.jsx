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
import { listSkillsForPicker, pickRowFromSkillMeta } from "../../skills/skillRegistry.js";
import { useSkillEnvironment } from "../../skills/useSkillEnvironment.js";
import { listWorkflowsForPicker } from "../../workflow/workflowRuntimeRegistry.js";
import { automationTaskSkillMeta } from "../../automation/automationTaskToDraft.js";
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
      { name: "flip", options: { padding: 8 } },
      { name: "preventOverflow", options: { padding: 8 } },
    ],
  },
};

/** Date pickers near dialog bottom need flip enabled (default DIALOG_POPUP disables it). */
const DIALOG_DATE_POPUP = {
  attach: osPopupAttach,
  placement: "top-start",
  zIndex: 6500,
  popperOptions: {
    strategy: "fixed",
    modifiers: [
      { name: "offset", options: { offset: [0, 4] } },
      {
        name: "flip",
        options: {
          padding: 8,
          fallbackPlacements: ["bottom-start", "top-end", "bottom-end"],
        },
      },
      { name: "preventOverflow", options: { padding: 8, altBoundary: true } },
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

/**
 * @param {{
 *   open?: boolean;
 *   onOpenChange: (open: boolean) => void;
 *   onSubmit?: (draft: AutomationTaskDraft) => void | Promise<void>;
 *   submitting?: boolean;
 *   editingTask?: import("../../automation/useAutomationTasks.js").AutomationTaskCard | null;
 *   initialDraft: AutomationTaskDraft;
 * }} props
 */
export default function AutomationTaskDialog({
  open = true,
  onOpenChange,
  onSubmit,
  submitting = false,
  editingTask = null,
  initialDraft,
}) {
  const pickFirstNonEmptyText = useCallback((values) => {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return "";
  }, []);
  const normalizeChannelValue = useCallback((value) => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return "";
    if (raw === "internal" || raw === "studio" || raw === "openstudio") return "open-studio";
    if (raw === "weixin") return "wechat";
    return raw;
  }, []);

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
  const [draft, setDraft] = useState(initialDraft);
  const [fieldErrors, setFieldErrors] = useState(
    /** @type {{ name: string; prompt: string; channel: string }} */ ({
      name: "",
      prompt: "",
      channel: "",
    }),
  );
  const isEditMode = Boolean(editingTask);
  const editingMeta = editingTask?.meta && typeof editingTask.meta === "object" ? editingTask.meta : {};
  const editingCronJob =
    editingTask?.cronJob && typeof editingTask.cronJob === "object"
      ? /** @type {Record<string, unknown>} */ (editingTask.cronJob)
      : null;
  const editingFallbackName = pickFirstNonEmptyText([
    editingTask?.name,
    editingMeta.name,
    editingCronJob?.name,
    editingTask?.prompt,
    editingMeta.prompt,
    editingMeta.message,
    initialDraft?.prompt,
  ]);
  const editingFallbackChannel = normalizeChannelValue(
    pickFirstNonEmptyText([editingTask?.channel, editingMeta.channel, "open-studio"]),
  );
  const resolvedName =
    String(draft.name ?? "").trim() || (isEditMode ? editingFallbackName : "");
  const resolvedChannel =
    normalizeChannelValue(draft.channel) ||
    (isEditMode ? editingFallbackChannel : "") ||
    "open-studio";

  useEffect(() => {
    if (!open) return;
    setDraft((prev) => {
      const base = initialDraft && typeof initialDraft === "object" ? initialDraft : prev;
      return {
        ...base,
        name: String(base.name ?? "").trim() || (isEditMode ? editingFallbackName : ""),
        channel:
          normalizeChannelValue(base.channel) ||
          (isEditMode ? editingFallbackChannel : "") ||
          "open-studio",
      };
    });
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
  }, [editingFallbackChannel, editingFallbackName, initialDraft, isEditMode, normalizeChannelValue, open]);

  useEffect(() => {
    const onWorkflowLibChange = () => setWorkflowPickerBump((n) => n + 1);
    window.addEventListener("openstudio-workflow-library-changed", onWorkflowLibChange);
    return () => window.removeEventListener("openstudio-workflow-library-changed", onWorkflowLibChange);
  }, []);

  const skillPickList = useMemo(() => listSkillsForPicker(skillPickEnv), [skillPickEnv]);

  useEffect(() => {
    if (!open || !editingTask) return;
    const skillMeta = automationTaskSkillMeta(editingTask);
    if (!skillMeta) return;
    const row = pickRowFromSkillMeta(skillMeta, skillPickList);
    if (!row) return;
    setDraft((prev) => (prev.skillRow ? prev : { ...prev, skillRow: row }));
  }, [editingTask, open, skillPickList]);

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
  const channelSelectOptions = useMemo(() => {
    const normalizedCurrent = normalizeChannelValue(resolvedChannel);
    if (!normalizedCurrent) return channelOptions;
    const hasCurrent = channelOptions.some((o) => String(o.value) === normalizedCurrent);
    if (hasCurrent) {
      return channelOptions.map((o) =>
        String(o.value) === normalizedCurrent ? { ...o, disabled: false } : o,
      );
    }
    return [
      ...channelOptions,
      {
        value: normalizedCurrent,
        label:
          normalizedCurrent === "open-studio"
            ? t("automationPage.taskChannelOpenStudio")
            : normalizedCurrent === "wechat"
              ? t("automationPage.taskChannelWechat")
              : normalizedCurrent,
        disabled: false,
      },
    ];
  }, [channelOptions, normalizeChannelValue, resolvedChannel, t]);

  useEffect(() => {
    if (!open || isEditMode) return;
    setDraft((prev) => {
      const allowed = new Set(
        channelOptions.filter((o) => !o.disabled).map((o) => String(o.value)),
      );
      if (!prev.channel || allowed.has(prev.channel)) return prev;
      return { ...prev, channel: "" };
    });
  }, [channelOptions, isEditMode, open]);

  useEffect(() => {
    if (!open) return;
    const globalActiveId = typeof config?.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
    const next =
      enabledModelOptions.some((o) => o.value === globalActiveId)
        ? globalActiveId
        : (enabledModelOptions[0]?.value ?? "");
    setDraft((prev) => (prev.modelId ? prev : { ...prev, modelId: next }));
  }, [config?.activeModelProfileId, enabledModelOptions, open]);

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
      channelSelectOptions.filter((o) => !o.disabled).map((o) => String(o.value)),
    );
    return {
      name: resolvedName.trim() ? "" : t("automationPage.taskNameRequired"),
      prompt: draft.prompt.trim() ? "" : t("automationPage.taskPromptRequired"),
      channel:
        resolvedChannel.trim() && allowedChannels.has(resolvedChannel.trim())
          ? ""
          : t("automationPage.taskChannelRequired"),
    };
  }, [channelSelectOptions, draft.prompt, resolvedChannel, resolvedName, t]);

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
    const submitDraft = {
      ...draft,
      name: resolvedName,
      channel: resolvedChannel,
    };
    const nextErrors = collectFieldErrors();
    setFieldErrors(nextErrors);
    const message = nextErrors.name || nextErrors.prompt || nextErrors.channel;
    if (message) {
      showValidationError(message);
      return;
    }
    onSubmit?.(submitDraft);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog
      visible={open}
      attach="body"
      placement="center"
      header={isEditMode ? t("automationPage.taskDialogEditTitle") : t("automationPage.taskDialogTitle")}
      width={560}
      zIndex={6000}
      destroyOnClose
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
            {isEditMode ? t("automationPage.taskSave") : t("automationPage.taskAdd")}
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" labelAlign="top" className="automation-task-dialog__form">
        <FormItem label={<RequiredLabel>{t("automationPage.taskName")}</RequiredLabel>}>
          {/* Avoid FormItem overriding controlled value with its empty internal formValue. */}
          <div className="automation-task-dialog__control">
            <Input
              value={resolvedName}
              placeholder={t("automationPage.taskNamePlaceholder")}
              status={fieldErrors.name ? "error" : "default"}
              tips={fieldErrors.name || undefined}
              onChange={(value) => patchDraft({ name: String(value ?? "") })}
            />
          </div>
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
          <div className="automation-task-dialog__control">
            <TSelect
              value={resolvedChannel}
              options={channelSelectOptions}
              placeholder={t("automationPage.taskChannelPlaceholder")}
              status={fieldErrors.channel ? "error" : "default"}
              tips={fieldErrors.channel || undefined}
              popupProps={DIALOG_POPUP}
              onChange={(value) => patchDraft({ channel: String(value ?? "") })}
            />
          </div>
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
                  popupProps={DIALOG_DATE_POPUP}
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
          <div className="automation-task-dialog__control">
            <DateRangePicker
              clearable
              value={draft.effectiveRange}
              placeholder={[t("automationPage.taskEffectiveRangePlaceholder"), t("automationPage.taskEffectiveRangePlaceholder")]}
              popupProps={DIALOG_DATE_POPUP}
              onChange={(value) => patchDraft({ effectiveRange: Array.isArray(value) ? value.map(String) : [] })}
            />
          </div>
        </FormItem>
      </Form>
    </Dialog>
  );
}
