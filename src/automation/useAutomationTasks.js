import { useCallback, useEffect, useState } from "react";
import { automationDraftToStudioMeta } from "./buildAutomationCronMessage.js";

/**
 * @typedef {import("../components/automation/AutomationTaskDialog.jsx").AutomationTaskDraft} AutomationTaskDraft
 */

/**
 * @typedef {{
 *   cronJobId: string;
 *   name: string;
 *   prompt: string;
 *   channel: string;
 *   scheduleLabel?: string;
 *   enabled?: boolean;
 *   lastRunStatus?: string;
 *   lastRunAtMs?: number;
 *   nextRunAtMs?: number;
 *   lastError?: string;
 *   lastDiagnosticSummary?: string;
 *   lastErrorReason?: string;
 *   consecutiveErrors?: number;
 *   schedule?: { kind?: string; everyMs?: number; anchorMs?: number };
 *   meta?: Record<string, unknown>;
 *   cronJob?: Record<string, unknown>;
 * }} AutomationTaskCard
 */

export function useAutomationTasks() {
  const [tasks, setTasks] = useState(/** @type {AutomationTaskCard[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
    if (!bridge?.automationTasksList) {
      setTasks([]);
      if (!silent) setLoading(false);
      setError("bridge_unavailable");
      return { ok: false, error: "bridge_unavailable" };
    }
    if (!silent) setLoading(true);
    try {
      const result = await bridge.automationTasksList();
      if (result?.ok && Array.isArray(result.tasks)) {
        setTasks(result.tasks);
        setError("");
        return result;
      }
      const msg = String(result?.error ?? "list_failed");
      setError(msg);
      return result ?? { ok: false, error: msg };
    } catch (e) {
      const msg = String(e?.message ?? e);
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh({ silent: true }), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * @param {AutomationTaskDraft} draft
   * @param {string} message
   */
  const createTask = useCallback(
    async (draft, message) => {
      const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
      if (!bridge?.automationTaskCreate) return { ok: false, error: "bridge_unavailable" };
      const result = await bridge.automationTaskCreate({
        draft,
        message: String(message ?? "").trim(),
        studioMeta: automationDraftToStudioMeta(draft),
      });
      if (result?.ok) await refresh();
      return result ?? { ok: false, error: "create_failed" };
    },
    [refresh],
  );

  const removeTask = useCallback(
    async (cronJobId) => {
      const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
      if (!bridge?.automationTaskRemove) return { ok: false, error: "bridge_unavailable" };
      const result = await bridge.automationTaskRemove(cronJobId);
      if (result?.ok) await refresh({ silent: true });
      return result ?? { ok: false, error: "remove_failed" };
    },
    [refresh],
  );

  const runTaskNow = useCallback(
    async (cronJobId) => {
      const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
      if (!bridge?.automationTaskRunNow) return { ok: false, error: "bridge_unavailable" };
      const result = await bridge.automationTaskRunNow(cronJobId);
      if (result?.ok) await refresh({ silent: true });
      return result ?? { ok: false, error: "run_failed" };
    },
    [refresh],
  );

  return {
    tasks,
    loading,
    error,
    refresh,
    createTask,
    removeTask,
    runTaskNow,
  };
}
