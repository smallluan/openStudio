import { useLayoutEffect, useMemo, useRef } from "react";
import { workerMessageLifecycleEnded } from "../../chat/orchestrationWorkerStream.js";
import { agentAvatarGlyph, agentDisplayLabel } from "../../studio/agents.js";
import Avatar from "../../ui/Avatar.jsx";
import ChatLabOrchestrationDockIdle from "./ChatLabOrchestrationDockIdle.jsx";

/**
 * Body content for orchestration inside {@link ChatLabPreviewDock} extension slot.
 * @param {{
 *   mode: "live" | "timeline";
 *   run: import("../../studio/orchestration.js").OrchestrationRun | null;
 *   mainAgent: import("../../studio/agents.js").LobsterAgent | null;
 *   agents: import("../../studio/agents.js").LobsterAgent[];
 *   messages: Array<Record<string, unknown>>;
 *   gatewaySlices: Array<{
 *     assistantMessageId?: string;
 *     content?: string;
 *     thinking?: string;
 *     toolTrace?: import("../../chat/toolTraceMerge.js").ToolTraceRow[];
 *     activityLog?: import("../../chat/toolTraceMerge.js").ActivityRow[];
 *     assistantTimeline?: import("../../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *     active?: boolean;
 *   }>;
 *   busy: boolean;
 *   currentStepTitle?: string;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   renderWorkerMessage: (message: Record<string, unknown>) => import("react").ReactNode;
 * }} props
 */
export default function ChatLabOrchestrationSidePanel({
  mode,
  run,
  mainAgent,
  agents,
  messages,
  gatewaySlices,
  busy,
  currentStepTitle = "",
  t,
  renderWorkerMessage,
}) {
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const runId = run?.runId ?? "";

  const activeTaskIds = useMemo(() => {
    const fromRun = [
      ...(Array.isArray(run?.activeTaskIds) ? run.activeTaskIds : []),
      ...(typeof run?.activeTaskId === "string" && run.activeTaskId ? [run.activeTaskId] : []),
    ];
    const fromPlan = Array.isArray(run?.plan?.tasks)
      ? run.plan.tasks.filter((task) => task.status === "in_progress").map((task) => task.id)
      : [];
    return new Set([...fromRun, ...fromPlan].filter(Boolean));
  }, [run?.activeTaskId, run?.activeTaskIds, run?.plan?.tasks]);

  const sideData = useMemo(() => {
    if (!runId) return { workers: [], events: [] };

    const sliceByAssistantId = new Map(
      gatewaySlices
        .map((s) => [String(s?.assistantMessageId ?? "").trim(), s])
        .filter(([id]) => id),
    );

    const events = [];
    /** @type {Map<string, Record<string, unknown>>} */
    const workerMsgByTask = new Map();
    /** @type {Map<string, string>} */
    const workerAgentByTask = new Map();

    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      if (m.orchestrationRunId !== runId) continue;
      if (m.messageKind === "orchestration_internal") continue;

      if (m.messageKind === "orchestration_event") {
        const title = String(m.content ?? "").trim();
        if (title) events.push({ id: String(m.id ?? ""), title });
        const eventKey = typeof m.orchestrationEventKey === "string" ? m.orchestrationEventKey : "";
        const taskId = typeof m.orchestrationTaskId === "string" ? m.orchestrationTaskId.trim() : "";
        const workerId =
          typeof m.orchestrationWorkerId === "string" ? m.orchestrationWorkerId.trim() : "";
        if (
          taskId &&
          workerId &&
          (eventKey === "task_assigned" || eventKey === "task_start" || eventKey === "pre_task_running")
        ) {
          workerAgentByTask.set(taskId, workerId);
        }
        continue;
      }

      if (m.role !== "assistant") continue;
      const agentId = String(m.agentId ?? "");
      if (!agentId || agentId === mainAgent?.id) continue;
      const orchPhase = String(m.orchestrationPhase ?? "").trim();
      if (orchPhase === "triage" || orchPhase === "plan_synthesis" || orchPhase === "rollup") continue;

      const taskId = typeof m.orchestrationTaskId === "string" ? m.orchestrationTaskId.trim() : "";
      if (!taskId) continue;
      workerMsgByTask.set(taskId, m);
      if (agentId) workerAgentByTask.set(taskId, agentId);
    }

    /** @type {Array<{ taskId: string; agentId: string; message: Record<string, unknown> }>} */
    const workers = [];
    const seenTasks = new Set();

    const considerTask = (taskId, fallbackAgentId = "") => {
      const tid = String(taskId ?? "").trim();
      if (!tid || seenTasks.has(tid)) return;
      const agentId = workerAgentByTask.get(tid) || fallbackAgentId;
      if (!agentId) return;

      const baseMsg =
        workerMsgByTask.get(tid) ??
        ({
          id: `orch-side-placeholder-${tid}`,
          role: "assistant",
          agentId,
          orchestrationTaskId: tid,
          orchestrationRunId: runId,
          content: "",
          streaming: activeTaskIds.has(tid),
        });

      const slice = sliceByAssistantId.get(String(baseMsg.id ?? "").trim());
      const merged = mergeWorkerMessageWithSlice(baseMsg, slice);
      const streamActive = Boolean(merged.streaming || slice?.active);
      const lifecycleEnded = workerMessageLifecycleEnded(merged, slice);
      const taskActive = activeTaskIds.has(tid);

      if (lifecycleEnded) return;
      if (!streamActive && !taskActive && !String(merged.content ?? "").trim()) return;

      seenTasks.add(tid);
      workers.push({ taskId: tid, agentId, message: merged });
    };

    for (const taskId of activeTaskIds) {
      const task = run?.plan?.tasks?.find((row) => row.id === taskId);
      considerTask(taskId, task?.ownerAgentId ?? "");
    }

    for (const [taskId, msg] of workerMsgByTask.entries()) {
      considerTask(taskId, String(msg.agentId ?? ""));
    }

    workers.sort((a, b) => {
      const ta = Number(workerMsgByTask.get(a.taskId)?.createdAt) || 0;
      const tb = Number(workerMsgByTask.get(b.taskId)?.createdAt) || 0;
      return ta - tb;
    });

    return { workers, events };
  }, [messages, gatewaySlices, runId, mainAgent?.id, activeTaskIds, run?.plan?.tasks]);

  const scrollDigest = useMemo(() => {
    if (mode === "timeline") {
      return sideData.events.map((e) => `${e.id}:${e.title}`).join("|");
    }
    return sideData.workers
      .map(({ taskId, agentId, message }) => {
        const m = message;
        return [
          taskId,
          agentId,
          String(m.content ?? "").length,
          String(m.thinking ?? "").length,
          Array.isArray(m.toolTrace) ? m.toolTrace.length : 0,
          Array.isArray(m.activityLog) ? m.activityLog.length : 0,
          Array.isArray(m.assistantTimeline) ? m.assistantTimeline.length : 0,
          m.streaming ? 1 : 0,
        ].join(":");
      })
      .join("|");
  }, [mode, sideData]);

  useLayoutEffect(() => {
    const pin = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      for (const child of el.querySelectorAll(".chat-lab-preview-dock__orch-worker-scroll")) {
        child.scrollTop = child.scrollHeight;
      }
    };
    pin();
    const raf = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(raf);
  }, [scrollDigest, mode]);

  if (mode === "timeline") {
    return (
      <div ref={scrollRef} className="chat-lab-preview-dock__orch-body chat-lab-preview-dock__orch-body--timeline">
        <ol className="chat-lab-preview-dock__orch-timeline">
          {sideData.events.map((e, idx) => (
            <li key={e.id || `${idx}-${e.title}`} className="chat-lab-preview-dock__orch-timeline-step">
              <span className="chat-lab-preview-dock__orch-timeline-dot" aria-hidden />
              <span>{e.title}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const idleStep =
    String(currentStepTitle ?? "").trim() ||
    (busy ? t("chatLab.streaming") : t("orchestration.dock.empty"));

  return (
    <div ref={scrollRef} className="chat-lab-preview-dock__orch-body">
      {sideData.workers.length === 0 ? (
        <ChatLabOrchestrationDockIdle stepTitle={idleStep} />
      ) : (
        sideData.workers.map(({ taskId, agentId, message }) => {
          const agent = agentById.get(agentId);
          const label = agent ? agentDisplayLabel(agent) : agentId;
          const glyph = agent ? agentAvatarGlyph(agent) : "";
          return (
            <section
              key={taskId}
              className="chat-lab-preview-dock__orch-worker"
              aria-label={label}
            >
              <header className="chat-lab-preview-dock__orch-worker-head">
                <Avatar
                  src={glyph}
                  name={label}
                  size="sm"
                  shape="rounded"
                />
                <span className="chat-lab-preview-dock__orch-worker-name">{label}</span>
              </header>
              <div className="chat-lab-preview-dock__orch-worker-scroll">
                {renderWorkerMessage(message)}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/**
 * @param {Record<string, unknown>} message
 * @param {{
 *   content?: string;
 *   thinking?: string;
 *   toolTrace?: import("../../chat/toolTraceMerge.js").ToolTraceRow[];
 *   activityLog?: import("../../chat/toolTraceMerge.js").ActivityRow[];
 *   assistantTimeline?: import("../../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *   active?: boolean;
 * } | undefined} slice
 */
function mergeWorkerMessageWithSlice(message, slice) {
  if (!slice) return message;
  return {
    ...message,
    content: slice.content ?? message.content,
    thinking: slice.thinking ?? message.thinking,
    streaming: Boolean(message.streaming || slice.active),
    toolTrace: slice.toolTrace ?? message.toolTrace,
    activityLog: slice.activityLog ?? message.activityLog,
    assistantTimeline: slice.assistantTimeline ?? message.assistantTimeline,
  };
}
