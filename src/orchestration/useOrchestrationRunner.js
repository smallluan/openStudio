import { useCallback, useRef, useState } from "react";
import {
  deriveTitleFromMessages,
  getSession,
  updateSessionOrchestration,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import {
  agentDisplayLabel,
  groupAgentsInSession,
  sessionKeyForAgent,
  systemMessageForAgent,
} from "../studio/agents.js";
import {
  OrchestrationRole,
  agentsByOrchestrationRole,
  orchestrationParticipantIds,
  orchestrationRoleForAgent,
} from "../studio/orchestrationRoles.js";
import {
  assignTaskOwners,
  buildDevTaskPrompt,
  buildOrchestrationTriagePrompt,
  buildPlanRevisionPrompt,
  buildPlanSynthesisPrompt,
  buildPmResearchPrompt,
  buildReviewPrompt,
  buildRollupPrompt,
  enforcePlanPhaseFormat,
  formatOrchestrationTeamRoster,
  newOrchestrationId,
  orchestrationAssignOpts,
  parsePlanFromResponse,
  parseReviewFromResponse,
  parseTriageFromResponse,
  patchPlanTask,
  pickExecutionOwner,
  readyTasks,
  resolveTriageNeedsPm,
} from "../studio/orchestration.js";

const ASSISTANT_TERMINAL_GRACE_MS = 520;
const ASSISTANT_TERMINAL_TIMEOUT_MS = 180_000;

/**
 * IPC `startChatStream` resolves before the renderer finalizes the assistant bubble — wait for content.
 * @param {string} assistantMessageId
 * @param {import("react").MutableRefObject<Array<Record<string, unknown>>>} messagesRef
 * @param {() => Array<Record<string, unknown>>} [readMessages]
 * @returns {Promise<string>}
 */
function waitForAssistantTerminal(assistantMessageId, messagesRef, readMessages) {
  const readRow = () => {
    const list = readMessages ? readMessages() : messagesRef.current;
    return list.find((m) => m.id === assistantMessageId) ?? null;
  };

  /** @returns {{ settled: boolean; text: string }} */
  const readTerminal = () => {
    const row = readRow();
    if (!row || row.streaming) return { settled: false, text: "" };
    return { settled: true, text: String(row.content ?? "").trim() };
  };

  const existing = readTerminal();
  if (existing.settled) return Promise.resolve(existing.text);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(text);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timeout = setTimeout(() => fail(new Error("orchestration_stream_timeout")), ASSISTANT_TERMINAL_TIMEOUT_MS);
    const poll = setInterval(() => {
      const snap = readTerminal();
      if (snap.settled) finish(snap.text);
    }, 90);

    /** @param {Event} e */
    const onTerminal = (e) => {
      const d = /** @type {CustomEvent} */ (e).detail;
      if (!d || d.assistantMessageId !== assistantMessageId) return;
      const kind = d.kind;
      setTimeout(() => {
        const snap = readTerminal();
        const fallback = String(d.content ?? "").trim();
        if (kind === "error") {
          fail(new Error(String(d.message ?? "orchestration_stream_error")));
          return;
        }
        if (snap.settled) finish(snap.text || fallback);
        else if (kind === "done" || kind === "aborted") finish(fallback);
      }, ASSISTANT_TERMINAL_GRACE_MS);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
      window.removeEventListener("openstudio-gateway-chat-terminal", onTerminal);
    };

    window.addEventListener("openstudio-gateway-chat-terminal", onTerminal);
  });
}

/** @returns {string} */
function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

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
 *   bridge: { startChatStream?: Function; abortChatStream?: Function } | undefined;
 *   beginGatewayStream: (args: { conversationId: string; streamId: string; assistantMessageId: string }) => void;
 *   resetGatewayStream: (streamId: string) => void;
 *   finalizeAssistantById: (id: string, extra?: Record<string, unknown>) => void;
 *   abortAllActiveStreams: () => Promise<void>;
 *   activeStreamIdsRef: import("react").MutableRefObject<Set<string>>;
 *   assistantStreamIdsRef: import("react").MutableRefObject<Map<string, string>>;
 *   buildGatewayPayloadRows: Function;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} deps
 */
export function useOrchestrationRunner(deps) {
  const pausedRef = useRef(false);
  const runningRef = useRef(false);
  const activeConversationRef = useRef(/** @type {string | null} */ (null));
  const resumeWaitRef = useRef(/** @type {(() => void) | null} */ (null));
  const [runnerActivityTick, setRunnerActivityTick] = useState(0);

  const syncRunnerActivity = useCallback(() => {
    setRunnerActivityTick((n) => n + 1);
  }, []);

  const isViewingConversation = useCallback(
    (conversationId) => conversationId === deps.conversationId,
    [deps.conversationId],
  );

  const sessionMessagesFor = useCallback((conversationId) => {
    const rec = getSession(conversationId);
    return Array.isArray(rec?.messages) ? rec.messages : [];
  }, []);

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

  const waitIfPaused = useCallback(async () => {
    if (!pausedRef.current) return;
    await new Promise((resolve) => {
      resumeWaitRef.current = resolve;
    });
  }, []);

  const checkPaused = useCallback(() => {
    if (pausedRef.current) throw new Error("orchestration_paused");
  }, []);

  const saveRun = useCallback(
    (conversationId, run) => {
      updateSessionOrchestration(conversationId, run);
    },
    [],
  );

  const roleOptsForRun = useCallback(
    (run) =>
      orchestrationAssignOpts(deps.agents, {
        mainAgent: deps.mainAgent,
        participantIds: run?.participantIds ?? deps.participantIds,
        mentionIds: run?.mentionIds ?? [],
      }),
    [deps.agents, deps.mainAgent, deps.participantIds],
  );

  const teamRosterForRun = useCallback(
    (run) => formatOrchestrationTeamRoster(deps.agents, roleOptsForRun(run), deps.t),
    [deps.agents, deps.t, roleOptsForRun],
  );

  const removeMessagesById = useCallback(
    (conversationId, ids) => {
      const drop = new Set(ids.filter(Boolean));
      if (!drop.size) return;
      applyMessagesUpdate(conversationId, (prev) => {
        const next = prev.filter((m) => !drop.has(m.id));
        persistMessages(conversationId, next.map(toPersistRow));
        return next;
      });
    },
    [applyMessagesUpdate],
  );

  const orchestrationRunMeta = useCallback((conversationId) => {
    const runId = getSession(conversationId)?.orchestration?.runId;
    return runId ? { orchestrationRunId: runId } : {};
  }, []);

  const appendEvent = useCallback(
    (conversationId, content, agentId, meta = {}) => {
      const now = Date.now();
      const row = {
        id: newId(),
        role: /** @type {const} */ ("assistant"),
        messageKind: /** @type {const} */ ("orchestration_event"),
        content,
        createdAt: now,
        ...orchestrationRunMeta(conversationId),
        ...(agentId ? { agentId } : {}),
        ...(meta.eventKey ? { orchestrationEventKey: meta.eventKey } : {}),
        ...(meta.taskId ? { orchestrationTaskId: meta.taskId } : {}),
        ...(meta.workerAgentId ? { orchestrationWorkerId: meta.workerAgentId } : {}),
      };
      applyMessagesUpdate(conversationId, (prev) => {
        const next = [...prev, row];
        persistMessages(conversationId, next.map(toPersistRow));
        return next;
      });
      return row.id;
    },
    [applyMessagesUpdate, orchestrationRunMeta],
  );

  const runAgentTurn = useCallback(
    async (conversationId, agent, userPrompt, opts = {}) => {
      await waitIfPaused();
      checkPaused();
      if (!deps.mainAgent || !deps.bridge?.startChatStream) throw new Error("orchestration_unavailable");

      const now = Date.now();
      const internal = Boolean(opts.internal);
      const assistantMsg = {
        id: newId(),
        role: /** @type {const} */ ("assistant"),
        content: "",
        thinking: "",
        streaming: true,
        createdAt: now,
        agentId: agent.id,
        ...orchestrationRunMeta(conversationId),
        ...(internal ? { messageKind: /** @type {const} */ ("orchestration_internal") } : {}),
        ...(opts.orchestrationTaskId ? { orchestrationTaskId: opts.orchestrationTaskId } : {}),
        ...(opts.orchestrationPhase ? { orchestrationPhase: opts.orchestrationPhase } : {}),
      };
      const streamId = newId();
      const run = getSession(conversationId)?.orchestration;
      const roleOpts = orchestrationAssignOpts(deps.agents, {
        mainAgent: deps.mainAgent,
        participantIds: run?.participantIds ?? deps.participantIds,
        mentionIds: opts.mentionIds ?? run?.mentionIds ?? [],
      });
      const sessionParticipantIds = orchestrationParticipantIds(deps.agents, roleOpts);
      if (!sessionParticipantIds.includes(agent.id)) sessionParticipantIds.push(agent.id);
      const groupAgents = groupAgentsInSession({
        agents: deps.agents,
        mainAgent: deps.mainAgent,
        participantIds: sessionParticipantIds,
      });
      const teamRoster = formatOrchestrationTeamRoster(deps.agents, roleOpts, deps.t);
      const sysRow = systemMessageForAgent(agent, deps.t("chatLab.systemPrompt"), {
        groupAgents,
        orchestrationTeamRoster: teamRoster,
      });
      const storedRows = sessionMessagesFor(conversationId);
      const historyBefore = (
        isViewingConversation(conversationId) ? deps.messagesRef.current : storedRows
      ).filter((m) => m.id !== assistantMsg.id);
      const priorOnly = deps.buildGatewayPayloadRows(historyBefore, {
        agentById: deps.agentById,
        targetAgentId: agent.id,
        mainAgentStudioId: deps.mainAgent?.id,
      });
      const tailUser = { role: "user", content: userPrompt };
      const outgoing = [...(sysRow ? [sysRow] : []), ...priorOnly, tailUser];

      applyMessagesUpdate(conversationId, (prev) => [...prev, assistantMsg]);
      if (isViewingConversation(conversationId)) {
        deps.beginGatewayStream({ conversationId, streamId, assistantMessageId: assistantMsg.id });
        deps.activeStreamIdsRef.current.add(streamId);
        deps.assistantStreamIdsRef.current.set(assistantMsg.id, streamId);
      }

      const liveRows = isViewingConversation(conversationId)
        ? deps.messagesRef.current
        : [...storedRows, assistantMsg];
      const persistable = liveRows
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map(toPersistRow);
      persistable.push({
        id: assistantMsg.id,
        role: "assistant",
        content: "",
        createdAt: assistantMsg.createdAt,
        agentId: assistantMsg.agentId,
        ...orchestrationRunMeta(conversationId),
        ...(internal ? { messageKind: /** @type {const} */ ("orchestration_internal") } : {}),
        ...(opts.orchestrationTaskId ? { orchestrationTaskId: opts.orchestrationTaskId } : {}),
        ...(opts.orchestrationPhase ? { orchestrationPhase: opts.orchestrationPhase } : {}),
      });
      persistMessages(conversationId, persistable);

      try {
        await deps.bridge.startChatStream({
          streamId,
          conversationId,
          messages: outgoing,
          agentSessionKey: sessionKeyForAgent(agent),
          gatewayAgentId: agent.gatewayAgentId,
          concurrent: Boolean(opts.concurrent),
        });
        const text = await waitForAssistantTerminal(
          assistantMsg.id,
          deps.messagesRef,
          isViewingConversation(conversationId)
            ? undefined
            : () => sessionMessagesFor(conversationId),
        );
        if (isViewingConversation(conversationId)) {
          deps.finalizeAssistantById(assistantMsg.id, { content: text });
        } else {
          applyMessagesUpdate(conversationId, (prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: text, streaming: false } : m,
            ),
          );
        }
        return { text, messageId: assistantMsg.id };
      } catch (err) {
        if (isViewingConversation(conversationId)) {
          deps.resetGatewayStream(streamId);
          deps.activeStreamIdsRef.current.delete(streamId);
          deps.assistantStreamIdsRef.current.delete(assistantMsg.id);
          deps.finalizeAssistantById(assistantMsg.id, {
            error: String(err?.message ?? err),
            streaming: false,
          });
        }
        throw err;
      } finally {
        if (isViewingConversation(conversationId)) {
          deps.activeStreamIdsRef.current.delete(streamId);
          deps.assistantStreamIdsRef.current.delete(assistantMsg.id);
        }
      }
    },
    [checkPaused, deps, isViewingConversation, orchestrationRunMeta, sessionMessagesFor, applyMessagesUpdate, waitIfPaused],
  );

  const resolvePmAgents = useCallback(
    (run) => {
      const roleOpts = roleOptsForRun(run);
      return agentsByOrchestrationRole(deps.agents, OrchestrationRole.PM, roleOpts).filter(
        (a) => !a.isMain && orchestrationRoleForAgent(a) === OrchestrationRole.PM,
      );
    },
    [deps.agents, roleOptsForRun],
  );

  const runPmPhase = useCallback(
    async (conversationId, run) => {
      const targets = resolvePmAgents(run);
      if (!targets.length) {
        appendEvent(conversationId, deps.t("orchestration.events.noPmAgents"), deps.mainAgent?.id, {
          eventKey: "no_pm",
        });
        throw new Error("orchestration_no_pm_agents");
      }

      appendEvent(
        conversationId,
        deps.t("orchestration.events.pmDispatch", { count: targets.length }),
        deps.mainAgent?.id,
        { eventKey: "pm_dispatch" },
      );

      const roster = teamRosterForRun(run);
      const parallel = targets.length > 1;
      const results = await Promise.all(
        targets.map(async (agent) => {
          await waitIfPaused();
          checkPaused();
          appendEvent(
            conversationId,
            deps.t("orchestration.events.pmAgentStart", { agent: agentDisplayLabel(agent) }),
            deps.mainAgent?.id,
            { eventKey: "pm_start", workerAgentId: agent.id },
          );
          const { text: output } = await runAgentTurn(
            conversationId,
            agent,
            buildPmResearchPrompt(run.userRequirement, agent, roster),
            {
              mentionIds: run.mentionIds,
              orchestrationPhase: "pm_research",
              concurrent: parallel,
            },
          );
          if (!output.trim()) {
            appendEvent(
              conversationId,
              deps.t("orchestration.events.pmAgentEmpty", { agent: agentDisplayLabel(agent) }),
              deps.mainAgent?.id,
              { eventKey: "pm_empty", workerAgentId: agent.id },
            );
          }
          return { agent, output };
        }),
      );
      return results;
    },
    [appendEvent, checkPaused, deps, resolvePmAgents, runAgentTurn, teamRosterForRun, waitIfPaused],
  );

  const synthesizePlan = useCallback(
    async (conversationId, run, pmResults, planNotes = "") => {
      if (!deps.mainAgent) throw new Error("no_main_agent");
      const roleOpts = roleOptsForRun(run);
      const roster = teamRosterForRun(run);
      const { text: raw, messageId: synthesisMessageId } = await runAgentTurn(
        conversationId,
        deps.mainAgent,
        buildPlanSynthesisPrompt(run.userRequirement, pmResults, roster, planNotes),
        { internal: true, mentionIds: run.mentionIds },
      );
      let plan = parsePlanFromResponse(raw);
      if (!plan) {
        plan = {
          version: 1,
          summary: raw.slice(0, 600) || run.userRequirement,
          feasibility: "",
          tasks: [],
        };
      }
      plan = enforcePlanPhaseFormat(assignTaskOwners(plan, deps.agents, roleOpts));
      return { plan, synthesisMessageId };
    },
    [deps, roleOptsForRun, runAgentTurn, teamRosterForRun],
  );

  const executeDevelopment = useCallback(
    async (conversationId, run) => {
      if (!run.plan || !deps.mainAgent) return run;
      let plan = { ...run.plan, tasks: [...run.plan.tasks] };
      const maxReviewRounds = 3;

      /**
       * @param {import("../studio/orchestration.js").OrchestrationTask} task
       * @param {import("../studio/agents.js").LobsterAgent} owner
       * @param {import("../studio/orchestration.js").OrchestrationPlan} planSnapshot
       * @param {{ concurrent?: boolean }} opts
       */
      const runReadyTask = async (task, owner, planSnapshot, opts = {}) => {
        const roster = teamRosterForRun(run);
        const streamOpts = {
          mentionIds: run.mentionIds,
          orchestrationTaskId: task.id,
          concurrent: Boolean(opts.concurrent),
        };

        if (task.phase === "review") {
          const devTask = planSnapshot.tasks.find(
            (t) => t.phase === "development" && task.dependsOn.includes(t.id),
          );
          const devOutput = devTask?.output || "";
          const reviewTurn = await runAgentTurn(
            conversationId,
            owner,
            buildReviewPrompt(devTask || task, devOutput),
            { ...streamOpts, orchestrationPhase: "review" },
          );
          const output = reviewTurn.text;
          const review = parseReviewFromResponse(output) || {
            approved: false,
            findings: [output.slice(0, 400)],
          };
          /** @type {Array<{ taskId: string; patch: Record<string, unknown> }>} */
          const planPatches = [];
          /** @type {Record<string, unknown>} */
          const runPatch = {
            reviewResults: { ...(run.reviewResults || {}), [task.id]: review },
            updatedAt: Date.now(),
          };

          if (review.approved) {
            planPatches.push({
              taskId: task.id,
              patch: { status: "done", output: review.findings.join("\n") || "Approved" },
            });
            appendEvent(
              conversationId,
              deps.t("orchestration.events.reviewPassed", { title: task.title }),
              deps.mainAgent?.id,
              { eventKey: "review_passed", taskId: task.id },
            );
          } else {
            const round = (task.reviewRound || 0) + 1;
            if (round >= maxReviewRounds) {
              planPatches.push({
                taskId: task.id,
                patch: { status: "blocked", output: review.findings.join("\n") },
              });
              appendEvent(
                conversationId,
                deps.t("orchestration.events.reviewBlocked", { title: task.title }),
                deps.mainAgent?.id,
                { eventKey: "review_blocked", taskId: task.id },
              );
            } else {
              planPatches.push({ taskId: task.id, patch: { status: "todo", reviewRound: round } });
              const devId = task.dependsOn.find((d) =>
                planSnapshot.tasks.find((t) => t.id === d && t.phase === "development"),
              );
              if (devId) {
                planPatches.push({ taskId: devId, patch: { status: "todo" } });
                const devAgent = planSnapshot.tasks.find((t) => t.id === devId);
                const devOwner =
                  (devAgent?.ownerAgentId && deps.agentById.get(devAgent.ownerAgentId)) || deps.mainAgent;
                if (devOwner && devAgent) {
                  appendEvent(
                    conversationId,
                    deps.t("orchestration.events.reviewRework", {
                      title: devAgent.title,
                      agent: agentDisplayLabel(devOwner),
                    }),
                    deps.mainAgent?.id,
                    { eventKey: "review_rework", taskId: devId, workerAgentId: devOwner.id },
                  );
                  const reworkTurn = await runAgentTurn(
                    conversationId,
                    devOwner,
                    [
                      buildDevTaskPrompt(devAgent, run.userRequirement, planSnapshot, roster),
                      "",
                      "## Code review feedback — address these issues:",
                      review.findings.map((f) => `- ${f}`).join("\n"),
                    ].join("\n"),
                    {
                      mentionIds: run.mentionIds,
                      orchestrationTaskId: devId,
                      orchestrationPhase: "development",
                    },
                  );
                  planPatches.push({
                    taskId: devId,
                    patch: { status: "done", output: reworkTurn.text },
                  });
                }
              }
            }
          }
          return { planPatches, runPatch };
        }

        const devTurn = await runAgentTurn(
          conversationId,
          owner,
          buildDevTaskPrompt(task, run.userRequirement, planSnapshot, roster),
          { ...streamOpts, orchestrationPhase: "development" },
        );
        appendEvent(
          conversationId,
          deps.t("orchestration.events.taskDone", { title: task.title }),
          deps.mainAgent?.id,
          { eventKey: "task_done", taskId: task.id, workerAgentId: owner.id },
        );
        return {
          planPatches: [{ taskId: task.id, patch: { status: "done", output: devTurn.text } }],
          runPatch: {},
        };
      };

      while (true) {
        await waitIfPaused();
        checkPaused();

        const pending = plan.tasks.filter(
          (t) => (t.phase === "development" || t.phase === "review") && t.status !== "done" && t.status !== "blocked",
        );
        if (!pending.length) break;

        const doneIds = new Set(plan.tasks.filter((t) => t.status === "done").map((t) => t.id));
        const ready = pending.filter(
          (t) =>
            (t.status === "todo" || t.status === "blocked") &&
            t.dependsOn.every((dep) => doneIds.has(dep)),
        );
        if (!ready.length) {
          const blocked = pending.some((t) => t.status === "in_progress");
          if (blocked) break;
          throw new Error("orchestration_deadlock");
        }

        await waitIfPaused();
        checkPaused();

        const roleOpts = roleOptsForRun(run);
        /** @type {Set<string>} */
        const busyAgentIds = new Set();
        /** @type {Map<string, number>} */
        const loadByAgent = new Map();
        /** @type {Array<{ task: import("../studio/orchestration.js").OrchestrationTask; owner: import("../studio/agents.js").LobsterAgent }>} */
        const batch = [];

        for (const task of ready) {
          const owner = pickExecutionOwner(task, deps.agents, roleOpts, busyAgentIds, loadByAgent);
          if (!owner) continue;
          busyAgentIds.add(owner.id);
          plan = patchPlanTask(plan, task.id, { status: "in_progress", ownerAgentId: owner.id });
          appendEvent(
            conversationId,
            deps.t("orchestration.events.taskStart", {
              title: task.title,
              agent: agentDisplayLabel(owner),
            }),
            deps.mainAgent?.id,
            { eventKey: "task_start", taskId: task.id, workerAgentId: owner.id },
          );
          batch.push({ task: { ...task, ownerAgentId: owner.id }, owner });
        }

        if (!batch.length) {
          for (const task of ready) {
            const role = task.ownerRole || OrchestrationRole.FE;
            const hasPool = agentsByOrchestrationRole(deps.agents, role, roleOpts).length > 0;
            if (!hasPool) {
              plan = patchPlanTask(plan, task.id, { status: "blocked" });
            }
          }
          saveRun(conversationId, { ...run, plan, updatedAt: Date.now() });
          const stillReady = plan.tasks.filter(
            (t) =>
              (t.phase === "development" || t.phase === "review") &&
              (t.status === "todo" || t.status === "blocked") &&
              t.dependsOn.every((dep) => doneIds.has(dep)),
          );
          if (stillReady.length) throw new Error("orchestration_deadlock");
          continue;
        }

        const planSnapshot = { ...plan, tasks: plan.tasks.map((t) => ({ ...t })) };
        const parallel = batch.length > 1;
        run = {
          ...run,
          plan,
          activeTaskId: batch.length === 1 ? batch[0].task.id : null,
          status: "running",
          updatedAt: Date.now(),
        };
        saveRun(conversationId, run);

        const outcomes = await Promise.all(
          batch.map(({ task, owner }) => runReadyTask(task, owner, planSnapshot, { concurrent: parallel })),
        );

        for (const outcome of outcomes) {
          for (const { taskId, patch } of outcome.planPatches) {
            plan = patchPlanTask(plan, taskId, patch);
          }
          if (outcome.runPatch?.reviewResults) {
            run = {
              ...run,
              reviewResults: /** @type {Record<string, { approved: boolean; findings: string[] }>} */ (
                outcome.runPatch.reviewResults
              ),
              updatedAt: Date.now(),
            };
          }
        }

        run = { ...run, plan, activeTaskId: null, updatedAt: Date.now() };
        saveRun(conversationId, run);
        const rows = isViewingConversation(conversationId)
          ? deps.messagesRef.current
          : sessionMessagesFor(conversationId);
        persistMessages(conversationId, rows.map(toPersistRow), { orchestration: run });
      }
      return { ...run, plan };
    },
    [
      appendEvent,
      checkPaused,
      deps,
      isViewingConversation,
      roleOptsForRun,
      runAgentTurn,
      saveRun,
      sessionMessagesFor,
      teamRosterForRun,
      waitIfPaused,
    ],
  );

  const runLoop = useCallback(
    async (conversationId, run) => {
      if (runningRef.current) return;
      runningRef.current = true;
      activeConversationRef.current = conversationId;
      pausedRef.current = false;
      syncRunnerActivity();
      try {
        if (run.status === "planning" || run.status === "revising") {
          let plan = run.plan;
          /** @type {string | null} */
          let hiddenMessageId = null;
          if (run.status === "planning") {
            saveRun(conversationId, { ...run, status: "planning", currentPhase: "triage", updatedAt: Date.now() });
            appendEvent(conversationId, deps.t("orchestration.events.started"), deps.mainAgent?.id, {
              eventKey: "started",
            });
            appendEvent(conversationId, deps.t("orchestration.events.analyzing"), deps.mainAgent?.id, {
              eventKey: "analyzing",
            });
            const roster = teamRosterForRun(run);
            const pmAgents = resolvePmAgents(run);
            const triageTurn = await runAgentTurn(
              conversationId,
              deps.mainAgent,
              buildOrchestrationTriagePrompt(run.userRequirement, roster, pmAgents.length > 0),
              { internal: true, mentionIds: run.mentionIds, orchestrationPhase: "triage" },
            );
            hiddenMessageId = triageTurn.messageId;
            const triageParsed = parseTriageFromResponse(triageTurn.text);
            const triage = {
              summary: triageParsed?.summary || triageTurn.text.slice(0, 600),
              planNotes: triageParsed?.planNotes || triageParsed?.summary || "",
              needsPmResearch: resolveTriageNeedsPm(
                triageParsed,
                run.userRequirement,
                pmAgents.length > 0,
              ),
            };
            /** @type {Array<{ agent: import("../studio/agents.js").LobsterAgent; output: string }>} */
            let pmResults = [];
            if (triage.needsPmResearch) {
              if (pmAgents.length) {
                saveRun(conversationId, {
                  ...run,
                  status: "planning",
                  currentPhase: "pm_research",
                  updatedAt: Date.now(),
                });
                pmResults = await runPmPhase(conversationId, run);
              } else {
                appendEvent(
                  conversationId,
                  deps.t("orchestration.events.pmSkipped"),
                  deps.mainAgent?.id,
                  { eventKey: "pm_skipped" },
                );
              }
            }
            checkPaused();
            appendEvent(
              conversationId,
              deps.t("orchestration.events.synthesizingPlan"),
              deps.mainAgent?.id,
              { eventKey: "synthesizing_plan" },
            );
            const synthesized = await synthesizePlan(
              conversationId,
              run,
              pmResults,
              triage.planNotes || triage.summary,
            );
            plan = synthesized.plan;
            const synthesisId = synthesized.synthesisMessageId;
            if (hiddenMessageId && synthesisId !== hiddenMessageId) {
              removeMessagesById(conversationId, [hiddenMessageId]);
            }
            hiddenMessageId = synthesisId;
          } else if (run.plan && run.revisionNotes && deps.mainAgent) {
            saveRun(conversationId, { ...run, currentPhase: "plan_revision", updatedAt: Date.now() });
            const revisionTurn = await runAgentTurn(
              conversationId,
              deps.mainAgent,
              buildPlanRevisionPrompt(run.plan, run.revisionNotes),
              { internal: true, mentionIds: run.mentionIds },
            );
            hiddenMessageId = revisionTurn.messageId;
            const revised = parsePlanFromResponse(revisionTurn.text);
            if (revised) {
              plan = enforcePlanPhaseFormat(
                assignTaskOwners(revised, deps.agents, roleOptsForRun(run)),
              );
            }
          }

          if (!plan) throw new Error("orchestration_no_plan");
          if (hiddenMessageId) removeMessagesById(conversationId, [hiddenMessageId]);
          run = {
            ...run,
            plan,
            status: "awaiting_approval",
            currentPhase: "plan_approval",
            updatedAt: Date.now(),
          };
          saveRun(conversationId, run);
          appendEvent(conversationId, deps.t("orchestration.events.awaitingApproval"), deps.mainAgent?.id, {
            eventKey: "awaiting_approval",
          });
          return;
        }

        if (run.status === "running" && run.plan) {
          run = await executeDevelopment(conversationId, run);
          checkPaused();

          if (deps.mainAgent) {
            appendEvent(conversationId, deps.t("orchestration.events.rollup"), deps.mainAgent.id, {
              eventKey: "rollup",
            });
            await runAgentTurn(
              conversationId,
              deps.mainAgent,
              buildRollupPrompt(run.userRequirement, run.plan),
              { mentionIds: run.mentionIds, orchestrationPhase: "rollup" },
            );
          }

          run = { ...run, status: "completed", currentPhase: "done", updatedAt: Date.now() };
          saveRun(conversationId, run);
          appendEvent(conversationId, deps.t("orchestration.events.completed"), deps.mainAgent?.id, {
            eventKey: "completed",
          });
        }
      } catch (err) {
        if (String(err?.message) === "orchestration_paused") {
          const rec = getSession(conversationId);
          const cur = rec?.orchestration;
          if (cur) saveRun(conversationId, { ...cur, status: "paused", updatedAt: Date.now() });
        } else {
          const rec = getSession(conversationId);
          const cur = rec?.orchestration;
          if (cur) saveRun(conversationId, { ...cur, status: "failed", updatedAt: Date.now() });
          appendEvent(
            conversationId,
            deps.t("orchestration.events.failed", { message: String(err?.message ?? err) }),
            deps.mainAgent?.id,
            { eventKey: "failed" },
          );
        }
      } finally {
        runningRef.current = false;
        activeConversationRef.current = null;
        syncRunnerActivity();
      }
    },
    [
      appendEvent,
      checkPaused,
      deps,
      executeDevelopment,
      removeMessagesById,
      resolvePmAgents,
      roleOptsForRun,
      runPmPhase,
      runAgentTurn,
      saveRun,
      syncRunnerActivity,
      synthesizePlan,
      teamRosterForRun,
    ],
  );

  const startOrchestration = useCallback(
    async (conversationId, userRequirement, mentionIds = []) => {
      if (!deps.mainAgent) return;
      const rec = getSession(conversationId);
      const sessionParticipants = Array.isArray(rec?.participantIds)
        ? rec.participantIds.filter(Boolean)
        : [...(deps.participantIds ?? []), ...(deps.mainAgent ? [deps.mainAgent.id] : [])];
      const run = {
        runId: newOrchestrationId(),
        status: /** @type {const} */ ("planning"),
        currentPhase: "triage",
        userRequirement: userRequirement.trim(),
        mentionIds: Array.isArray(mentionIds) ? mentionIds.filter(Boolean) : [],
        participantIds: sessionParticipants,
        plan: null,
        activeTaskId: null,
        reviewResults: {},
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveRun(conversationId, run);
      void runLoop(conversationId, run);
    },
    [deps, runLoop, saveRun],
  );

  const approvePlan = useCallback(
    (conversationId) => {
      const rec = getSession(conversationId);
      const run = rec?.orchestration;
      if (!run || run.status !== "awaiting_approval" || !run.plan) return;
      const next = { ...run, status: /** @type {const} */ ("running"), currentPhase: "development", updatedAt: Date.now() };
      saveRun(conversationId, next);
      appendEvent(conversationId, deps.t("orchestration.events.planApproved"), deps.mainAgent?.id, {
        eventKey: "plan_approved",
      });
      void runLoop(conversationId, next);
    },
    [appendEvent, deps, runLoop, saveRun],
  );

  const rejectPlan = useCallback(
    (conversationId) => {
      const rec = getSession(conversationId);
      const run = rec?.orchestration;
      if (!run || run.status !== "awaiting_approval") return;
      saveRun(conversationId, { ...run, status: "failed", updatedAt: Date.now() });
      appendEvent(conversationId, deps.t("orchestration.events.planRejected"), deps.mainAgent?.id, {
        eventKey: "plan_rejected",
      });
    },
    [appendEvent, deps.mainAgent?.id, deps.t, saveRun],
  );

  const revisePlan = useCallback(
    (conversationId, notes) => {
      const rec = getSession(conversationId);
      const run = rec?.orchestration;
      if (!run || run.status !== "awaiting_approval") return;
      const next = {
        ...run,
        status: /** @type {const} */ ("revising"),
        revisionNotes: notes.trim(),
        updatedAt: Date.now(),
      };
      saveRun(conversationId, next);
      appendEvent(conversationId, deps.t("orchestration.events.planRevising"), deps.mainAgent?.id, {
        eventKey: "plan_revising",
      });
      void runLoop(conversationId, next);
    },
    [appendEvent, deps, runLoop, saveRun],
  );

  const pauseOrchestration = useCallback(
    async (conversationId) => {
      const cid = conversationId ?? activeConversationRef.current ?? deps.conversationId;
      pausedRef.current = true;
      await deps.abortAllActiveStreams();
      const rec = getSession(cid);
      const run = rec?.orchestration;
      if (run && (run.status === "running" || run.status === "planning" || run.status === "revising")) {
        saveRun(cid, { ...run, status: "paused", updatedAt: Date.now() });
      }
    },
    [deps],
  );

  const resumeOrchestration = useCallback(
    (conversationId) => {
      pausedRef.current = false;
      if (resumeWaitRef.current) {
        resumeWaitRef.current();
        resumeWaitRef.current = null;
      }
      const rec = getSession(conversationId);
      const run = rec?.orchestration;
      if (!run || run.status !== "paused") return;
      const nextStatus =
        run.plan && run.currentPhase === "plan_approval"
          ? /** @type {const} */ ("awaiting_approval")
          : run.plan
            ? /** @type {const} */ ("running")
            : /** @type {const} */ ("planning");
      const next = { ...run, status: nextStatus, updatedAt: Date.now() };
      saveRun(conversationId, next);
      appendEvent(conversationId, deps.t("orchestration.events.resumed"), deps.mainAgent?.id, {
        eventKey: "resumed",
      });
      if (nextStatus === "awaiting_approval") return;
      void runLoop(conversationId, next);
    },
    [appendEvent, deps, runLoop, saveRun],
  );

  /** Resume a run left mid-flight (e.g. after reload) when the runner is idle. */
  const recoverOrphanOrchestration = useCallback(
    (conversationId) => {
      if (runningRef.current) return;
      const run = getSession(conversationId)?.orchestration;
      if (!run) return;
      if (run.status === "paused" || run.status === "awaiting_approval" || run.status === "completed") {
        return;
      }
      if (run.status === "failed") return;
      void runLoop(conversationId, run);
    },
    [runLoop],
  );

  /** Runner loop is actively awaiting LLM / task work for this conversation. */
  const isOrchestrationRunnerActive = useCallback((conversationId) => {
    return runningRef.current && activeConversationRef.current === conversationId;
  }, []);

  /** LLM streams in flight — show stop, disable plan actions. */
  const isOrchestrationStreamBusy = useCallback(
    (conversationId) => {
      if (isOrchestrationRunnerActive(conversationId)) return true;
      const run = getSession(conversationId)?.orchestration;
      if (!run) return false;
      return run.status === "planning" || run.status === "revising" || run.status === "running";
    },
    [isOrchestrationRunnerActive],
  );

  /** Blocks starting a second orchestration run in the same session. */
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
