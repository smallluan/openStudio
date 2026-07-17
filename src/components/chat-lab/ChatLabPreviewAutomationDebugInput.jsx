import { useCallback, useRef, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { Play } from "lucide-react";
import { normalizeAutomationSteps } from "../../chat/chatLabPreviewAutomation.js";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {string} text
 */
function parseDebugAutomationInput(text) {
  const blob = String(text ?? "").trim();
  if (!blob) return [];
  try {
    return normalizeAutomationSteps(JSON.parse(blob));
  } catch {
    const fence = blob.match(/```\s*sidebar-action[^\n]*\r?\n([\s\S]*?)```/i);
    if (fence) {
      try {
        return normalizeAutomationSteps(JSON.parse(fence[1].trim()));
      } catch {
        /* fall through */
      }
    }
    const arr = blob.match(/\[[\s\S]*\]/);
    if (arr) {
      try {
        return normalizeAutomationSteps(JSON.parse(arr[0]));
      } catch {
        /* fall through */
      }
    }
    return [];
  }
}
/**
 * @param {{
 *   onRun: (steps: import("../../chat/chatLabPreviewAutomation.js").SidebarAutomationStep[]) => Promise<unknown>;
 *   disabled?: boolean;
 * }} props
 */
export default function ChatLabPreviewAutomationDebugInput({ onRun, disabled = false }) {
  const { t } = useI18n();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [draft, setDraft] = useState("");
  /** @type {"idle" | "running" | "ok" | "err"} */
  const [statusKind, setStatusKind] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [running, setRunning] = useState(false);

  const runDraft = useCallback(async () => {
    const text = draft.trim();
    if (!text || disabled || running) return;

    const steps = parseDebugAutomationInput(text);
    if (!steps.length) {
      setStatusKind("err");
      setStatusMessage(t("chatLab.previewAutomationDebugParseError"));
      return;
    }

    setRunning(true);
    setStatusKind("running");
    setStatusMessage(t("chatLab.previewAutomationDebugRunning"));

    try {
      const result = /** @type {{ ok?: boolean; error?: string; stopReason?: string; stoppedAt?: number; steps?: unknown[] }} */ (
        await onRun(steps)
      );
      console.info("[sidebar-automation-debug]", { steps, result });

      if (result?.ok === false) {
        const stepNo =
          typeof result.stoppedAt === "number" && Number.isFinite(result.stoppedAt)
            ? result.stoppedAt + 1
            : steps.length;
        const err = String(result.stopReason || result.error || "step_failed");
        setStatusKind("err");
        setStatusMessage(t("chatLab.previewAutomationDebugFailed", { step: stepNo, error: err }));
        return;
      }

      setStatusKind("ok");
      setStatusMessage(t("chatLab.previewAutomationDebugOk", { count: steps.length }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusKind("err");
      setStatusMessage(msg);
      console.warn("[sidebar-automation-debug]", err);
    } finally {
      setRunning(false);
    }
  }, [disabled, draft, onRun, running, t]);

  const inputStatus =
    statusKind === "ok" ? "success"
    : statusKind === "err" ? "error"
    : "default";

  return (
    <div
      className={cn(
        "chat-lab-preview-dock__automation-input-wrap min-w-0 flex-1",
        statusKind === "running" && "chat-lab-preview-dock__automation-input-wrap--running",
      )}
    >
      <Input
        ref={inputRef}
        block
        borderless
        size="small"
        status={inputStatus}
        value={draft}
        onChange={(value) => {
          setDraft(value);
          if (statusKind !== "idle") {
            setStatusKind("idle");
            setStatusMessage("");
          }
        }}
        onEnter={() => {
          void runDraft();
        }}
        placeholder={t("chatLab.previewAutomationDebugPlaceholder")}
        aria-label={t("chatLab.previewAutomationDebugAria")}
        title={statusMessage || t("chatLab.previewAutomationDebugAria")}
        disabled={disabled || running}
        spellCheck={false}
        autocomplete="off"
      />
      <Button
        type="button"
        variant="text"
        shape="square"
        size="small"
        className={cn(
          "chat-lab-preview-dock__icon-btn chat-lab-preview-dock__automation-run",
          running && "chat-lab-preview-dock__automation-run--busy",
        )}
        onClick={() => void runDraft()}
        disabled={disabled || running || !draft.trim()}
        title={statusMessage || t("chatLab.previewAutomationDebugRun")}
        aria-label={t("chatLab.previewAutomationDebugRun")}
      >
        <Play size={14} strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );
}
