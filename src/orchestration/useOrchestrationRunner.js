import { useCallback, useEffect, useRef, useState } from "react";
import { composeChatLabSystemPrompt } from "../chat/chatLabSystemPrompt.js";
import {
  deriveTitleFromMessages,
  getSession,
  updateSessionOrchestration,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import { agentDisplayLabel } from "../studio/agents.js";
import { normalizeOrchestrationRun } from "../studio/orchestration.js";
import { formatOrchestrationEvent } from "../studio/orchestrationEventLabel.js";

/**
 * @param {import("../chat/chatSessionsStore.js").PersistedChatMessage[]} messages
 */
function persistMessages(conversationId, messages, extra = {}) {
  const rec = getSession(conversationId);
  const title = deriveTitleFromMessages(messages);
  upsertSession(conversationId, title || rec?.title || "…", messages, {
    participantIds: rec?.participantIds,
    orchestration: extra.orchestration ?? rec?.orchestration,
    orchestrationMode: extra.orchestrationMode ?? rec?.orchestrationMode,
    orchestrationFastMode: extra.orchestrationFastMode ?? rec?.orchestrationFastMode,
  });
}

/**
 * @param {{
 *   conversationId: string;
 *   agents: import("../studio/agents.js").LobsterAgent[];
 *   mainAgent: import("../studio/agents.js").LobsterAgent | null;
 *   participantIds: string[];
 *   agentById: Map<string, import("../studio/agents.js").LobsterAgent>;
 *   messagesRef: import("react").MutableRefObject<Array<Record<string, unknown>>>;
 *   setMessages: import("react").Dispatch<import("react").SetStateAction<Array<Record<string, unknown>>>>;
 *   bridge: { orchestrationCommand?: Function; onOrchestrationEvent?: Function } | undefined;
 *   beginGatewayStream: (args: { conversationId: string; streamId: string; assistantMessageId: string }) => void;
 *   resetGatewayStream: (streamId: string) => void;
 *   flushAndResetGatewayStream?: (streamId: string) => void;
 *   finalizeAssistantById: (id: string, extra?: Record<string, unknown>) => void;
 *   abortAllActiveStreams: () => Promise<void>;
 *   activeStreamIdsRef: import("react").MutableRefObject<Set<string>>;
 *   assistantStreamIdsRef: import("react").MutableRefObject<Map<string, string>>;
 *   orchestrationFastMode?: boolean;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} deps
 */
export function useOrchestrationRunner(deps) {
  const pausedRef = useRef(false);
  const runningRef = useRef(false);
  const activeConversationRef = useRef(/** @type {string | null} */ (null));
  const [runnerActivityTick, setRunnerActivityTick] = useState(0);

  const syncRunnerActivity = useCallback(() => {
    setRunnerActivityTick((n) => n + 1);
  }, []);

  const isViewingConversation = useCallback(
    (conversationId) => conversationId === deps.conversationId,
    [deps.conversationId],
  );

  const applyMessagesUpdate = useCallback(
    (conversationId, updater) => {
      if (isViewingConversation(conversationId)) {
        deps.setMessages(updater);
        return;
      }
      const rec = getSession(conversationId);
      const prevUi = (rec?.messages ?? []).map((m) => ({ ...m }));
      const next = typeof updater === "function" ? updater(prevUi) : updater;
      persistMessages(conversationId, next.map(toPersistRow));
    },
    [deps, isViewingConversation],
  );

  const saveRun = useCallback((conversationId, run) => {
    updateSessionOrchestration(conversationId, run);
  }, []);

  const orchestrationPayloadBase = useCallback(
    (conversationId, extra = {}) => {
      const rec = getSession(conversationId);
      const messages = isViewingConversation(conversationId)
        ? deps.messagesRef.current
        : rec?.messages ?? [];
      return {
        conversationId,
        agents: deps.agents,
        mainAgentId: deps.mainAgent?.id ?? "",
        participantIds: rec?.participantIds ?? deps.participantIds,
        messages,
        systemPromptFallback: composeChatLabSystemPrompt(deps.t),
        run: rec?.orchestration ?? null,
        fastMode: deps.orchestrationFastMode ?? Boolean(rec?.orchestrationFastMode),
        ...extra,
      };
    },
    [deps, isViewingConversation],
  );

  const sendCommand = useCallback(
    async (payload) => {
      if (!deps.bridge?.orchestrationCommand) throw new Error("orchestration_unavailable");
      return deps.bridge.orchestrationCommand(payload);
    },
    [deps.bridge],
  );

  const appendEventFromKey = useCallback(
    (conversationId, eventKey, agentId, extra = {}) => {
      const vars = { ...extra };
      if (typeof vars.agentLabel === "string") {
        vars.agent = vars.agentLabel;
      }
      if (typeof vars.title === "string" && !vars.agent) {
        /* task_start uses title + agentLabel */
      }
      const content = formatOrchestrationEvent(deps.t, eventKey, vars);
      const now = Date.now();
      const runId =
        (typeof extra.runId === "string" && extra.runId.trim()) ||
        (typeof extra.orchestrationRunId === "string" && extra.orchestrationRunId.trim()) ||
        getSession(conversationId)?.orchestration?.runId;
      const row = {
        id: newId(),
        role: /** @type {const} */ ("assistant"),
        messageKind: /** @type {const} */ ("orchestration_event"),
        content,
        createdAt: now,
        ...(runId ? { orchestrationRunId: runId } : {}),
        ...(agentId ? { agentId } : {}),
        orchestrationEventKey: eventKey,
        ...(extra.taskId ? { orchestrationTaskId: extra.taskId } : {}),
        ...(extra.workerAgentId ? { orchestrationWorkerId: extra.workerAgentId } : {}),
      };
      applyMessagesUpdate(conversationId, (prev) => {
        const next = [...prev, row];
        persistMessages(conversationId, next.map(toPersistRow));
        return next;
      });
      syncRunnerActivity();
    },
    [applyMessagesUpdate, deps.t, syncRunnerActivity],
  );

  useEffect(() => {
    if (!deps.bridge?.onOrchestrationEvent) return undefined;
    return deps.bridge.onOrchestrationEvent((evt) => {
      if (!evt || typeof evt !== "object") return;
      const conversationId = typeof evt.conversationId === "string" ? evt.conversationId : "";
      if (!conversationId) return;

      if (evt.type === "run_patch" && evt.run) {
        const run = normalizeOrchestrationRun(evt.run) ?? evt.run;
        saveRun(conversationId, run);
        if (run.status === "planning" || run.status === "revising" || run.status === "running") {
          runningRef.current = true;
          activeConversationRef.current = conversationId;
        }
        syncRunnerActivity();
        return;
      }

      if (evt.type === "run_finished") {
        runningRef.current = false;
        activeConversationRef.current = null;
        syncRunnerActivity();

        // 发送系统通知（仅在窗口不在前台时）
        if (typeof document !== "undefined" && !document.hasFocus()) {
          try {
            window.studioBridge?.showSystemNotification?.({
              title: "Open Studio",
              body: "任务回复已完成",
              silent: false,
            });
          } catch (e) {
            // 忽略通知错误
          }
        }

        return;
      }

      if (evt.type === "append_message" && evt.message) {
        applyMessagesUpdate(conversationId, (prev) => [...prev, { ...evt.message }]);
        syncRunnerActivity();
        return;
      }

      if (evt.type === "remove_messages" && Array.isArray(evt.ids)) {
        const drop = new Set(evt.ids);
        applyMessagesUpdate(conversationId, (prev) => prev.filter((m) => !drop.has(m.id)));
        return;
      }

      if (evt.type === "finalize_message" && evt.messageId) {
        const patch = evt.patch && typeof evt.patch === "object" ? evt.patch : {};
        if (isViewingConversation(conversationId)) {
          deps.finalizeAssistantById(String(evt.messageId), patch);
        } else {
          applyMessagesUpdate(conversationId, (prev) =>
            prev.map((m) => (m.id === evt.messageId ? { ...m, ...patch } : m)),
          );
        }
        return;
      }

      if (evt.type === "stream_begin" && evt.streamId && evt.assistantMessageId) {
        deps.beginGatewayStream({
          conversationId,
          streamId: String(evt.streamId),
          assistantMessageId: String(evt.assistantMessageId),
        });
        deps.activeStreamIdsRef.current.add(String(evt.streamId));
        deps.assistantStreamIdsRef.current.set(String(evt.assistantMessageId), String(evt.streamId));
        return;
      }

      if (evt.type === "stream_end" && evt.streamId) {
        const streamId = String(evt.streamId);
        if (deps.flushAndResetGatewayStream) {
          deps.flushAndResetGatewayStream(streamId);
        } else {
          deps.resetGatewayStream(streamId);
        }
        deps.activeStreamIdsRef.current.delete(streamId);

        // 发送系统通知（仅在窗口不在前台时）
        if (typeof document !== "undefined" && !document.hasFocus()) {
          try {
            window.studioBridge?.showSystemNotification?.({
              title: "Open Studio",
              body: "消息回复已完成",
              silent: false,
            });
          } catch (e) {
            // 忽略通知错误
          }
        }

        return;
      }

      if (evt.type === "orchestration_event" && evt.eventKey) {
        const agentId = typeof evt.agentId === "string" ? evt.agentId : deps.mainAgent?.id;
        const workerId = typeof evt.workerAgentId === "string" ? evt.workerAgentId : "";
        const agentLabel =
          workerId && deps.agentById.get(workerId)
            ? agentDisplayLabel(deps.agentById.get(workerId))
            : "";
        appendEventFromKey(conversationId, String(evt.eventKey), agentId, {
          runId: typeof evt.orchestrationRunId === "string" ? evt.orchestrationRunId : undefined,
          taskId: evt.taskId,
          workerAgentId: workerId,
          agentLabel,
          title: evt.title,
          count: evt.count,
          message: evt.message,
        });
      }
    });
  }, [
    appendEventFromKey,
    applyMessagesUpdate,
    deps,
    isViewingConversation,
    saveRun,
    syncRunnerActivity,
  ]);

  const startOrchestration = useCallback(
    async (conversationId, userRequirement, mentionIds = []) => {
      if (!deps.mainAgent) return;
      runningRef.current = true;
      activeConversationRef.current = conversationId;
      syncRunnerActivity();
      await sendCommand(
        orchestrationPayloadBase(conversationId, {
          action: "start",
          userRequirement: userRequirement.trim(),
          mentionIds: Array.isArray(mentionIds) ? mentionIds.filter(Boolean) : [],
        }),
      );
    },
    [deps.mainAgent, orchestrationPayloadBase, sendCommand, syncRunnerActivity],
  );

  const approvePlan = useCallback(
    async (conversationId) => {
      const run = getSession(conversationId)?.orchestration;
      if (!run || run.status !== "awaiting_approval" || !run.plan) return;
      await sendCommand(orchestrationPayloadBase(conversationId, { action: "approve", run }));
    },
    [orchestrationPayloadBase, sendCommand],
  );

  const rejectPlan = useCallback(
    async (conversationId) => {
      const run = getSession(conversationId)?.orchestration;
      if (!run || run.status !== "awaiting_approval") return;
      await sendCommand(orchestrationPayloadBase(conversationId, { action: "reject", run }));
    },
    [orchestrationPayloadBase, sendCommand],
  );

  const revisePlan = useCallback(
    async (conversationId, notes) => {
      const run = getSession(conversationId)?.orchestration;
      if (!run || run.status !== "awaiting_approval") return;
      await sendCommand(
        orchestrationPayloadBase(conversationId, {
          action: "revise",
          run,
          revisionNotes: notes.trim(),
        }),
      );
    },
    [orchestrationPayloadBase, sendCommand],
  );

  const pauseOrchestration = useCallback(
    async (conversationId) => {
      const cid = conversationId ?? activeConversationRef.current ?? deps.conversationId;
      pausedRef.current = true;
      await deps.abortAllActiveStreams();
      await sendCommand(orchestrationPayloadBase(cid, { action: "pause" }));
      const run = getSession(cid)?.orchestration;
      if (run && (run.status === "running" || run.status === "planning" || run.status === "revising")) {
        saveRun(cid, { ...run, status: "paused", updatedAt: Date.now() });
      }
    },
    [deps, orchestrationPayloadBase, saveRun, sendCommand],
  );

  const resumeOrchestration = useCallback(
    async (conversationId) => {
      pausedRef.current = false;
      const run = getSession(conversationId)?.orchestration;
      if (!run || run.status !== "paused") return;
      await sendCommand(orchestrationPayloadBase(conversationId, { action: "resume", run }));
    },
    [orchestrationPayloadBase, sendCommand],
  );

  const recoverOrphanOrchestration = useCallback(
    async (conversationId) => {
      if (runningRef.current) return;
      const run = getSession(conversationId)?.orchestration;
      if (!run) return;
      if (run.status === "paused" || run.status === "awaiting_approval" || run.status === "completed") {
        return;
      }
      if (run.status === "failed") return;
      await sendCommand(orchestrationPayloadBase(conversationId, { action: "resume", run }));
    },
    [orchestrationPayloadBase, sendCommand],
  );

  const isOrchestrationRunnerActive = useCallback((conversationId) => {
    return runningRef.current && activeConversationRef.current === conversationId;
  }, []);

  const isOrchestrationStreamBusy = useCallback(
    (conversationId) => {
      if (
        runningRef.current &&
        activeConversationRef.current === conversationId &&
        deps.activeStreamIdsRef.current.size > 0
      ) {
        return true;
      }
      const run = getSession(conversationId)?.orchestration;
      if (!run) return false;
      return run.status === "planning" || run.status === "revising" || run.status === "running";
    },
    [deps.activeStreamIdsRef],
  );

  const isOrchestrationInProgress = useCallback((conversationId) => {
    const run = getSession(conversationId)?.orchestration;
    if (!run) return false;
    return ["planning", "revising", "running", "awaiting_approval", "paused"].includes(run.status);
  }, []);

  return {
    startOrchestration,
    approvePlan,
    rejectPlan,
    revisePlan,
    pauseOrchestration,
    resumeOrchestration,
    recoverOrphanOrchestration,
    isOrchestrationStreamBusy,
    isOrchestrationRunnerActive,
    isOrchestrationInProgress,
    runnerActivityTick,
    pausedRef,
    runningRef,
  };
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/** @param {Record<string, unknown>} m */
function toPersistRow(m) {
  return {
    id: String(m.id ?? ""),
    role: m.role === "user" || m.role === "assistant" ? m.role : "assistant",
    content: String(m.content ?? ""),
    ...(m.thinking && String(m.thinking).trim() ? { thinking: String(m.thinking) } : {}),
    ...(typeof m.createdAt === "number" ? { createdAt: m.createdAt } : {}),
    ...(typeof m.agentId === "string" && m.agentId ? { agentId: m.agentId } : {}),
    ...(m.messageKind === "orchestration_event" ||
    m.messageKind === "orchestration_plan" ||
    m.messageKind === "orchestration_internal"
      ? { messageKind: m.messageKind }
      : {}),
    ...(m.orchestrationPlan && typeof m.orchestrationPlan === "object"
      ? { orchestrationPlan: m.orchestrationPlan }
      : {}),
    ...(typeof m.orchestrationTaskId === "string" && m.orchestrationTaskId
      ? { orchestrationTaskId: m.orchestrationTaskId }
      : {}),
    ...(typeof m.orchestrationPhase === "string" && m.orchestrationPhase
      ? { orchestrationPhase: m.orchestrationPhase }
      : {}),
    ...(typeof m.orchestrationEventKey === "string" && m.orchestrationEventKey
      ? { orchestrationEventKey: m.orchestrationEventKey }
      : {}),
    ...(typeof m.orchestrationWorkerId === "string" && m.orchestrationWorkerId
      ? { orchestrationWorkerId: m.orchestrationWorkerId }
      : {}),
    ...(typeof m.orchestrationRunId === "string" && m.orchestrationRunId
      ? { orchestrationRunId: m.orchestrationRunId }
      : {}),
    ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
    ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
    ...(Array.isArray(m.assistantTimeline) && m.assistantTimeline.length
      ? { assistantTimeline: m.assistantTimeline }
      : {}),
  };
}
