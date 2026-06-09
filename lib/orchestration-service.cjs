"use strict";

const { randomUUID } = require("crypto");
const {
  newOrchestrationId,
  orchestrationAssignOpts,
  formatOrchestrationTeamRoster,
  parseTriageFromResponse,
  parsePlanFromResponse,
  parseReviewFromResponse,
  buildOrchestrationTriagePrompt,
  buildPreTaskPrompt,
  buildPlanSynthesisPrompt,
  buildPlanRevisionPrompt,
  buildTaskPrompt,
  buildRollupPrompt,
  assignTaskOwners,
  enforcePlanPhaseFormat,
  sanitizePlanForPool,
  resolveTaskOwner,
  patchPlanTask,
  normalizeTaskKind,
} = require("./orchestration/core.cjs");
const { OrchestrationRole, agentsByOrchestrationRole, orchestrationParticipantIds } = require("./orchestration/roles.cjs");
const { runOrchestrationTaskDag, ORCHESTRATION_TASK_CONCURRENCY } = require("./orchestration/task-scheduler.cjs");
const { runOrchestrationTurn, newStreamId } = require("./orchestration-subagent.cjs");
const { readAgentBootstrapForChat } = require("./openclaw-agent-crud.cjs");
const { waitForGatewayWarmupIfNeeded } = require("./openclaw-gateway-supervisor.cjs");
const { probeOpenClawGateway } = require("./openclaw-gateway-stream.cjs");
const { getStudioLog } = require("./studio-logger.cjs");

const ORCH_EVENT_CHAN = "studio:orchestration-event";

/** @typedef {import("./orchestration/roles.cjs").LobsterAgent} LobsterAgent */

/**
 * @param {string} gatewayAgentId
 */
function sessionKeyForGatewayAgentId(gatewayAgentId) {
  const trimmed = String(gatewayAgentId ?? "").trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 48) || "agent";
  if (slug === "dev") return "agent:dev:dev";
  return `agent:${slug}:main`;
}

/** @param {LobsterAgent} agent */
function sessionKeyForAgent(agent) {
  const fromBinding = agent.openclaw?.sessionKey?.trim();
  if (fromBinding) return fromBinding;
  return sessionKeyForGatewayAgentId(agent.gatewayAgentId || "main");
}

/** @param {LobsterAgent} agent */
function agentDisplayLabel(agent) {
  return agent.name?.trim() || agent.gatewayAgentId || "Agent";
}

function newMessageId() {
  return randomUUID();
}

/**
 * @param {import("electron").WebContents} wc
 * @param {Record<string, unknown>} payload
 */
function emitOrch(wc, payload) {
  if (!wc || wc.isDestroyed()) return;
  wc.send(ORCH_EVENT_CHAN, payload);
}

/** @type {Map<string, { abort: AbortController; paused: boolean }>} */
const runState = new Map();

/**
 * @param {import("electron").WebContents} wc
 * @param {string} conversationId
 * @param {Record<string, unknown>} patch
 */
function emitRunPatch(wc, conversationId, patch) {
  emitOrch(wc, { type: "run_patch", conversationId, run: patch });
}

/**
 * @param {import("electron").WebContents} wc
 * @param {string} conversationId
 * @param {Record<string, unknown>} message
 */
function emitAppendMessage(wc, conversationId, message) {
  emitOrch(wc, { type: "append_message", conversationId, message });
}

function emitRemoveMessages(wc, conversationId, ids) {
  emitOrch(wc, { type: "remove_messages", conversationId, ids });
}

function emitOrchestrationEvent(wc, conversationId, eventKey, agentId, extra = {}) {
  const runId =
    typeof extra.runId === "string" && extra.runId.trim()
      ? extra.runId.trim()
      : typeof extra.orchestrationRunId === "string" && extra.orchestrationRunId.trim()
        ? extra.orchestrationRunId.trim()
        : "";
  emitOrch(wc, {
    type: "orchestration_event",
    conversationId,
    eventKey,
    agentId,
    ...extra,
    ...(runId ? { orchestrationRunId: runId } : {}),
  });
}

/**
 * @param {unknown[]} historyMessages
 * @param {"thread" | "task" | "internal"} mode
 */
function filterHistoryForTurn(historyMessages, mode) {
  if (mode === "task" || mode === "internal") return [];
  return (historyMessages ?? []).filter((m) => {
    if (!m || typeof m !== "object") return false;
    const row = /** @type {Record<string, unknown>} */ (m);
    if (row.error) return false;
    if (row.role !== "user" && row.role !== "assistant") return false;
    const mk = row.messageKind;
    if (mk === "orchestration_internal" || mk === "orchestration_event" || mk === "orchestration_plan") {
      return false;
    }
    return true;
  });
}

/**
 * @param {LobsterAgent} agent
 * @param {LobsterAgent[]} agents
 * @param {LobsterAgent | null} mainAgent
 * @param {string[]} participantIds
 * @param {string} teamRoster
 * @param {string} fallbackSystem
 */
function buildSystemRow(agent, agents, mainAgent, participantIds, teamRoster, fallbackSystem) {
  const poolIds = new Set(participantIds);
  if (mainAgent?.id) poolIds.add(mainAgent.id);
  const groupAgents = agents.filter((a) => poolIds.has(a.id));
  const lines = [fallbackSystem || "You are a helpful assistant."];
  if (groupAgents.length > 1) {
    lines.push("", "Group chat teammates:", ...groupAgents.map((a) => `- ${agentDisplayLabel(a)}`));
  }
  if (teamRoster?.trim()) {
    lines.push("", "Orchestration roster:", teamRoster);
  }
  return { role: "system", content: lines.join("\n") };
}

class OrchestrationService {
  /**
   * @param {{
   *   readConfig: () => Record<string, unknown>;
   *   syncAgentFromStudio: (reason: string) => void;
   *   acquireChatStreamSlot: (streamId: string) => Promise<void>;
   *   releaseChatStreamSlot: () => void;
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    /** @type {Set<string>} */
    this.runningConversations = new Set();
  }

  getState(conversationId) {
    return runState.get(conversationId);
  }

  pause(conversationId) {
    const st = runState.get(conversationId);
    if (st) st.paused = true;
    st?.abort.abort();
  }

  resume(conversationId) {
    const st = runState.get(conversationId);
    if (st) st.paused = false;
  }

  abort(conversationId) {
    const st = runState.get(conversationId);
    st?.abort.abort();
    runState.delete(conversationId);
    this.runningConversations.delete(conversationId);
  }

  /**
   * @param {import("electron").WebContents} wc
   * @param {{
   *   conversationId: string;
   *   userRequirement: string;
   *   mentionIds?: string[];
   *   participantIds?: string[];
   *   agents: LobsterAgent[];
   *   mainAgentId: string;
   *   fastMode?: boolean;
   *   messages?: unknown[];
   *   systemPromptFallback?: string;
   *   run?: Record<string, unknown>;
   *   action?: string;
   *   revisionNotes?: string;
   * }} payload
   */
  async handleCommand(wc, payload) {
    const conversationId = String(payload.conversationId ?? "").trim();
    if (!conversationId) throw new Error("orchestration_missing_conversation");

    const action = String(payload.action ?? "start").trim();
    if (action === "pause") {
      this.pause(conversationId);
      return;
    }
    if (action === "abort") {
      this.abort(conversationId);
      return;
    }
    if (action === "approve") {
      return this.continueRun(wc, conversationId, payload, "running");
    }
    if (action === "reject") {
      emitRunPatch(wc, conversationId, {
        ...(payload.run ?? {}),
        status: "failed",
        updatedAt: Date.now(),
      });
      emitOrchestrationEvent(wc, conversationId, "plan_rejected", payload.mainAgentId);
      return;
    }
    if (action === "revise") {
      return this.continueRun(wc, conversationId, { ...payload, status: "revising" }, "revising");
    }
    if (action === "resume") {
      const run = payload.run;
      const nextStatus =
        run?.plan && run?.currentPhase === "plan_approval"
          ? "awaiting_approval"
          : run?.plan
            ? "running"
            : "planning";
      if (nextStatus === "awaiting_approval") {
        emitRunPatch(wc, conversationId, { ...run, status: "awaiting_approval", updatedAt: Date.now() });
        return;
      }
      return this.continueRun(wc, conversationId, payload, nextStatus);
    }

    if (this.runningConversations.has(conversationId)) return;
    void this.startRun(wc, payload);
  }

  async continueRun(wc, conversationId, payload, status) {
    if (this.runningConversations.has(conversationId)) return;
    const run = {
      ...(payload.run ?? {}),
      status,
      updatedAt: Date.now(),
      ...(status === "revising" && payload.revisionNotes
        ? { revisionNotes: String(payload.revisionNotes).trim(), status: "revising" }
        : {}),
      ...(status === "running" ? { currentPhase: "execution", status: "running" } : {}),
    };
    emitRunPatch(wc, conversationId, run);
    if (status === "running") {
      emitOrchestrationEvent(wc, conversationId, "plan_approved", payload.mainAgentId, {
        runId: payload.run?.runId,
      });
    }
    void this.executeRunLoop(wc, { ...payload, run, conversationId });
  }

  async startRun(wc, payload) {
    const conversationId = String(payload.conversationId ?? "").trim();
    const agents = Array.isArray(payload.agents) ? payload.agents : [];
    const mainAgent = agents.find((a) => a.id === payload.mainAgentId) ?? agents.find((a) => a.isMain) ?? null;
    if (!mainAgent) return;

    const participantIds = Array.isArray(payload.participantIds)
      ? payload.participantIds.filter(Boolean)
      : [];
    const mentionIds = Array.isArray(payload.mentionIds) ? payload.mentionIds.filter(Boolean) : [];
    const requiresApproval = payload.fastMode ? false : true;

    const run = {
      runId: newOrchestrationId(),
      status: "planning",
      currentPhase: "triage",
      userRequirement: String(payload.userRequirement ?? "").trim(),
      mentionIds,
      participantIds,
      plan: null,
      activeTaskId: null,
      reviewResults: {},
      scenarioSummary: "",
      requiresApproval,
      preTasks: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    emitRunPatch(wc, conversationId, run);
    void this.executeRunLoop(wc, {
      ...payload,
      conversationId,
      agents,
      mainAgent,
      run,
      messages: payload.messages ?? [],
      systemPromptFallback: payload.systemPromptFallback ?? "",
    });
  }

  async executeRunLoop(wc, ctx) {
    const conversationId = ctx.conversationId;
    const agents = Array.isArray(ctx.agents) ? ctx.agents : [];
    const mainAgent =
      ctx.mainAgent ??
      agents.find((a) => a.id === ctx.mainAgentId) ??
      agents.find((a) => a.isMain) ??
      null;
    if (!mainAgent) {
      getStudioLog().warn("[orchestration-service] missing main agent", { conversationId });
      emitRunPatch(wc, conversationId, {
        ...(ctx.run && typeof ctx.run === "object" ? ctx.run : {}),
        status: "failed",
        updatedAt: Date.now(),
      });
      emitOrchestrationEvent(wc, conversationId, "failed", "", {
        message: "orchestration_no_main_agent",
      });
      return;
    }
    ctx = { ...ctx, agents, mainAgent };

    if (this.runningConversations.has(conversationId)) return;
    this.runningConversations.add(conversationId);

    const abort = new AbortController();
    runState.set(conversationId, { abort, paused: false });

    const checkPaused = () => {
      const st = runState.get(conversationId);
      if (st?.paused) throw new Error("orchestration_paused");
    };

    const waitIfPaused = async () => {
      while (runState.get(conversationId)?.paused) {
        await new Promise((r) => setTimeout(r, 120));
      }
    };

    try {
      let run = { ...ctx.run };
      const agents = ctx.agents;
      const mainAgent = ctx.mainAgent;
      const roleOpts = orchestrationAssignOpts(agents, {
        mainAgent,
        participantIds: run.participantIds,
        mentionIds: run.mentionIds,
      });
      const poolIds = orchestrationParticipantIds(agents, roleOpts);
      const teamRoster = formatOrchestrationTeamRoster(agents, roleOpts);

      if (run.status === "planning" || run.status === "revising") {
        let plan = run.plan;

        if (run.status === "planning") {
          emitRunPatch(wc, conversationId, { ...run, status: "planning", currentPhase: "triage" });
          emitOrchestrationEvent(wc, conversationId, "started", mainAgent.id, { runId: run.runId });
          emitOrchestrationEvent(wc, conversationId, "analyzing", mainAgent.id, { runId: run.runId });

          const triageTurn = await this.runTurn(wc, ctx, {
            agent: mainAgent,
            userPrompt: buildOrchestrationTriagePrompt(run.userRequirement, teamRoster),
            internal: true,
            phase: "triage",
            run,
          });

          const triageParsed = parseTriageFromResponse(triageTurn.text);
          const triage = {
            scenarioSummary: triageParsed?.scenarioSummary || triageParsed?.summary || "",
            requiresApproval: run.requiresApproval !== false && triageParsed?.requiresApproval !== false,
            preTasks: (triageParsed?.preTasks ?? []).filter((pt) => poolIds.includes(pt.agentId)),
            planNotes: triageParsed?.planNotes || triageParsed?.summary || "",
          };

          run = {
            ...run,
            scenarioSummary: triage.scenarioSummary,
            requiresApproval: triage.requiresApproval,
            preTasks: triage.preTasks,
          };
          emitRunPatch(wc, conversationId, run);

          /** @type {Array<{ agent: LobsterAgent; output: string }>} */
          const preResults = [];
          if (triage.preTasks.length) {
            emitRunPatch(wc, conversationId, { ...run, currentPhase: "pre_tasks" });
            emitOrchestrationEvent(wc, conversationId, "pre_tasks_dispatch", mainAgent.id, {
              count: triage.preTasks.length,
            });
            const preTasks = triage.preTasks
              .map((pt) => {
                const agent = agents.find((a) => a.id === pt.agentId);
                if (!agent) return null;
                return { pt, agent };
              })
              .filter(Boolean);
            await Promise.all(
              preTasks.map(async ({ pt, agent }) => {
                await waitIfPaused();
                checkPaused();
                const preTaskId = `pre-${agent.id}`;
                emitOrchestrationEvent(wc, conversationId, "pre_task_start", mainAgent.id, {
                  workerAgentId: agent.id,
                  taskId: preTaskId,
                });
                emitOrchestrationEvent(wc, conversationId, "pre_task_running", mainAgent.id, {
                  workerAgentId: agent.id,
                  taskId: preTaskId,
                  title: pt.brief,
                  agentLabel: agentDisplayLabel(agent),
                });
                const { text } = await this.runTurn(wc, ctx, {
                  agent,
                  userPrompt: buildPreTaskPrompt(pt.brief, agent, teamRoster),
                  phase: "pre_research",
                  run,
                  taskId: preTaskId,
                });
                preResults.push({ agent, output: text });
                emitOrchestrationEvent(wc, conversationId, "pre_task_done", mainAgent.id, {
                  workerAgentId: agent.id,
                  taskId: preTaskId,
                  title: pt.brief,
                  agentLabel: agentDisplayLabel(agent),
                });
              }),
            );
          }

          checkPaused();
          emitOrchestrationEvent(wc, conversationId, "synthesizing_plan", mainAgent.id);
          const synth = await this.runTurn(wc, ctx, {
            agent: mainAgent,
            userPrompt: buildPlanSynthesisPrompt(run.userRequirement, preResults, teamRoster, triage.planNotes),
            internal: true,
            phase: "plan_synthesis",
            run,
          });

          plan = parsePlanFromResponse(synth.text);
          if (!plan) {
            const raw = String(synth.text ?? "").trim();
            if (!raw) throw new Error("orchestration_plan_empty");
            plan = {
              version: 1,
              summary: raw.slice(0, 4000),
              feasibility: "",
              tasks: [],
            };
          }
          plan = enforcePlanPhaseFormat(sanitizePlanForPool(assignTaskOwners(plan, agents, roleOpts), poolIds).plan);
        } else if (run.plan && run.revisionNotes) {
          emitRunPatch(wc, conversationId, { ...run, currentPhase: "plan_revision" });
          const rev = await this.runTurn(wc, ctx, {
            agent: mainAgent,
            userPrompt: buildPlanRevisionPrompt(run.plan, run.revisionNotes),
            internal: true,
            phase: "plan_synthesis",
            run,
          });
          const revised = parsePlanFromResponse(rev.text);
          if (revised) {
            plan = enforcePlanPhaseFormat(
              sanitizePlanForPool(assignTaskOwners(revised, agents, roleOpts), poolIds).plan,
            );
          }
        }

        if (!plan) throw new Error("orchestration_no_plan");

        if (run.requiresApproval !== false) {
          run = {
            ...run,
            plan,
            status: "awaiting_approval",
            currentPhase: "plan_approval",
            updatedAt: Date.now(),
          };
          emitRunPatch(wc, conversationId, run);
          emitOrchestrationEvent(wc, conversationId, "awaiting_approval", mainAgent.id);
          return;
        }

        run = { ...run, plan, status: "running", currentPhase: "execution", updatedAt: Date.now() };
        emitRunPatch(wc, conversationId, run);
      }

      if (run.status === "running" && run.plan) {
        run = await this.executePlan(wc, ctx, run, checkPaused, waitIfPaused);
        checkPaused();

        emitOrchestrationEvent(wc, conversationId, "rollup", mainAgent.id);
        await this.runTurn(wc, ctx, {
          agent: mainAgent,
          userPrompt: buildRollupPrompt(run.userRequirement, run.plan),
          phase: "rollup",
          run,
        });

        run = { ...run, status: "completed", currentPhase: "done", updatedAt: Date.now() };
        emitRunPatch(wc, conversationId, run);
        emitOrchestrationEvent(wc, conversationId, "completed", mainAgent.id);
      }
    } catch (err) {
      if (String(err?.message) === "orchestration_paused") {
        emitRunPatch(wc, conversationId, { ...ctx.run, status: "paused", updatedAt: Date.now() });
      } else {
        getStudioLog().warn("[orchestration-service] run failed", {
          conversationId,
          message: String(err?.message ?? err),
        });
        emitRunPatch(wc, conversationId, { ...ctx.run, status: "failed", updatedAt: Date.now() });
        emitOrchestrationEvent(wc, conversationId, "failed", ctx.mainAgent?.id, {
          message: String(err?.message ?? err),
        });
      }
    } finally {
      this.runningConversations.delete(conversationId);
      runState.delete(conversationId);
      emitOrch(wc, { type: "run_finished", conversationId });
    }
  }

  async executePlan(wc, ctx, initialRun, checkPaused, waitIfPaused) {
    let run = { ...initialRun };
    const agents = ctx.agents;
    const mainAgent = ctx.mainAgent;
    const roleOpts = orchestrationAssignOpts(agents, {
      mainAgent,
      participantIds: run.participantIds,
      mentionIds: run.mentionIds,
    });
    const teamRoster = formatOrchestrationTeamRoster(agents, roleOpts);
    const maxReviewRounds = 3;
    const reviewResults = { ...(run.reviewResults ?? {}) };

    const executeTask = async (task, owner, planSnapshot) => {
      const kind = task.taskKind || normalizeTaskKind(null, task.phase);
      const streamOpts = {
        taskId: task.id,
        phase: kind === "review" ? "review" : "work",
        run,
      };

      if (kind === "review") {
        const subject = planSnapshot.tasks.find((t) => task.dependsOn.includes(t.id));
        emitOrchestrationEvent(wc, ctx.conversationId, "task_start", mainAgent.id, {
          runId: run.runId,
          taskId: task.id,
          workerAgentId: owner.id,
          title: task.title,
          agentLabel: agentDisplayLabel(owner),
        });
        const reviewTurn = await this.runTurn(wc, ctx, {
          agent: owner,
          userPrompt: buildTaskPrompt(task, run.userRequirement, planSnapshot, teamRoster),
          ...streamOpts,
        });
        const review = parseReviewFromResponse(reviewTurn.text) || {
          approved: false,
          findings: [reviewTurn.text.slice(0, 400)],
        };
        reviewResults[task.id] = review;
        const planPatches = [];

        if (review.approved) {
          planPatches.push({
            taskId: task.id,
            patch: { status: "done", output: review.findings.join("\n") || "Approved" },
          });
          emitOrchestrationEvent(wc, ctx.conversationId, "review_passed", mainAgent.id, {
            taskId: task.id,
            title: task.title,
          });
        } else {
          const round = (task.reviewRound || 0) + 1;
          if (round >= maxReviewRounds) {
            planPatches.push({
              taskId: task.id,
              patch: { status: "blocked", output: review.findings.join("\n") },
            });
            emitOrchestrationEvent(wc, ctx.conversationId, "review_blocked", mainAgent.id, {
              taskId: task.id,
              title: task.title,
            });
          } else {
            planPatches.push({ taskId: task.id, patch: { status: "todo", reviewRound: round } });
            const subjectId = task.dependsOn.find((d) =>
              planSnapshot.tasks.find((t) => t.id === d && t.taskKind !== "review"),
            );
            if (subjectId) {
              planPatches.push({ taskId: subjectId, patch: { status: "todo", output: undefined } });
              emitOrchestrationEvent(wc, ctx.conversationId, "review_rework", mainAgent.id, {
                taskId: subjectId,
                title: planSnapshot.tasks.find((t) => t.id === subjectId)?.title ?? task.title,
                workerAgentId: owner.id,
                agentLabel: agentDisplayLabel(owner),
              });
            }
          }
        }
        return {
          planPatches,
          runPatch: { reviewResults: { ...reviewResults }, updatedAt: Date.now() },
        };
      }

      const linkedReview = planSnapshot.tasks.find(
        (t) => (t.taskKind || normalizeTaskKind(null, t.phase)) === "review" && t.dependsOn.includes(task.id),
      );
      const priorReview = linkedReview ? reviewResults[linkedReview.id] : null;
      const findings = priorReview && !priorReview.approved ? priorReview.findings : null;
      emitOrchestrationEvent(wc, ctx.conversationId, "task_start", mainAgent.id, {
        runId: run.runId,
        taskId: task.id,
        workerAgentId: owner.id,
        title: task.title,
        agentLabel: agentDisplayLabel(owner),
      });

      const workTurn = await this.runTurn(wc, ctx, {
        agent: owner,
        userPrompt: buildTaskPrompt(task, run.userRequirement, planSnapshot, teamRoster, findings),
        ...streamOpts,
      });

      emitOrchestrationEvent(wc, ctx.conversationId, "task_done", mainAgent.id, {
        runId: run.runId,
        taskId: task.id,
        workerAgentId: owner.id,
        title: task.title,
        agentLabel: agentDisplayLabel(owner),
      });

      return {
        planPatches: [{ taskId: task.id, patch: { status: "done", output: workTurn.text } }],
        runPatch: {},
      };
    };

    const { plan, runPatch } = await runOrchestrationTaskDag(run.plan, {
      pickOwner: (task, busyAgentIds, loadByAgent) =>
        resolveTaskOwner(task, agents, roleOpts, busyAgentIds, loadByAgent),
      executeTask,
      onTaskStart: (task, owner, planSnapshot) => {
        const activeIds = planSnapshot.tasks
          .filter((t) => t.status === "in_progress")
          .map((t) => t.id);
        run = {
          ...run,
          plan: planSnapshot,
          activeTaskId: task.id,
          activeTaskIds: activeIds,
          status: "running",
          currentPhase: "execution",
          updatedAt: Date.now(),
        };
        emitRunPatch(wc, ctx.conversationId, run);
        emitOrchestrationEvent(wc, ctx.conversationId, "task_assigned", mainAgent.id, {
          runId: run.runId,
          taskId: task.id,
          workerAgentId: owner.id,
          title: task.title,
          agentLabel: agentDisplayLabel(owner),
        });
      },
      checkPaused,
      waitIfPaused,
      onPlanUpdate: async (nextPlan, patch) => {
        const activeIds = nextPlan.tasks
          .filter((t) => t.status === "in_progress")
          .map((t) => t.id);
        run = {
          ...run,
          plan: nextPlan,
          activeTaskId: activeIds[0] ?? null,
          activeTaskIds: activeIds,
          status: "running",
          ...(patch.reviewResults ? { reviewResults: patch.reviewResults } : {}),
          updatedAt: Date.now(),
        };
        emitRunPatch(wc, ctx.conversationId, run);
      },
      resolveBlockedTasks: (readyTasksList, currentPlan) => {
        let next = currentPlan;
        for (const task of readyTasksList) {
          const ownerId = task.ownerAgentId;
          const pool = new Set(orchestrationParticipantIds(agents, roleOpts));
          const hasOwner =
            (ownerId && pool.has(ownerId)) ||
            resolveTaskOwner(task, agents, roleOpts, new Set(), new Map());
          if (!hasOwner) {
            next = patchPlanTask(next, task.id, { status: "blocked" });
          }
        }
        return next;
      },
    }, { maxConcurrency: ORCHESTRATION_TASK_CONCURRENCY });

    return { ...run, plan, ...(runPatch.reviewResults ? { reviewResults: runPatch.reviewResults } : {}) };
  }

  /**
   * @param {import("electron").WebContents} wc
   * @param {Record<string, unknown>} ctx
   * @param {{
   *   agent: LobsterAgent;
   *   userPrompt: string;
   *   internal?: boolean;
   *   phase?: string;
   *   taskId?: string;
   *   run: Record<string, unknown>;
   * }} turn
   */
  async runTurn(wc, ctx, turn) {
    const streamId = newStreamId();
    const assistantMessageId = newMessageId();
    const now = Date.now();
    const internal = Boolean(turn.internal);
    const contextMode = internal ? "internal" : turn.taskId ? "task" : "thread";

    const assistantMsg = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      thinking: "",
      streaming: true,
      createdAt: now,
      agentId: turn.agent.id,
      orchestrationRunId: turn.run.runId,
      ...(internal ? { messageKind: "orchestration_internal" } : {}),
      ...(turn.taskId ? { orchestrationTaskId: turn.taskId } : {}),
      ...(turn.phase ? { orchestrationPhase: turn.phase } : {}),
    };

    emitOrch(wc, {
      type: "stream_begin",
      conversationId: ctx.conversationId,
      streamId,
      assistantMessageId,
    });
    emitAppendMessage(wc, ctx.conversationId, assistantMsg);

    await this.deps.acquireChatStreamSlot(turn.taskId || turn.run.runId);
    const st = runState.get(ctx.conversationId);
    if (st?.paused) {
      emitOrch(wc, {
        type: "finalize_message",
        conversationId: ctx.conversationId,
        messageId: assistantMessageId,
        patch: { streaming: false, error: "orchestration_paused" },
      });
      emitOrch(wc, { type: "stream_end", conversationId: ctx.conversationId, streamId });
      this.deps.releaseChatStreamSlot();
      throw new Error("orchestration_paused");
    }

    const roleOpts = orchestrationAssignOpts(ctx.agents, {
      mainAgent: ctx.mainAgent,
      participantIds: turn.run.participantIds,
      mentionIds: turn.run.mentionIds,
    });
    const participantIds = orchestrationParticipantIds(ctx.agents, roleOpts);
    const teamRoster = formatOrchestrationTeamRoster(ctx.agents, roleOpts);
    const sysRow = buildSystemRow(
      turn.agent,
      ctx.agents,
      ctx.mainAgent,
      participantIds,
      teamRoster,
      ctx.systemPromptFallback,
    );

    const history = filterHistoryForTurn(ctx.messages, contextMode);
    const cfg = this.deps.readConfig();
    this.deps.syncAgentFromStudio("orchestration");
    await waitForGatewayWarmupIfNeeded(this.deps.readConfig, { probeOpenClawGateway });

    const bootstrap = readAgentBootstrapForChat(turn.agent.gatewayAgentId, cfg);
    const soulBody = String(bootstrap ?? "").trim();
    const outgoing = [
      sysRow.content?.trim() ? sysRow : soulBody ? { role: "system", content: soulBody } : null,
      ...history.map((m) => {
        const row = /** @type {Record<string, unknown>} */ (m);
        return { role: row.role, content: String(row.content ?? "") };
      }),
      { role: "user", content: turn.userPrompt },
    ].filter(Boolean);

    try {
      const { text, thinking } = await runOrchestrationTurn({
        cfg,
        messages: outgoing,
        baseAgentSessionKey: sessionKeyForAgent(turn.agent),
        conversationId: ctx.conversationId,
        runId: String(turn.run.runId),
        taskId: turn.taskId,
        streamId,
        assistantMessageId,
        webContents: wc,
        abortSignal: runState.get(ctx.conversationId)?.abort.signal,
        concurrent: true,
        contextEmbedMode: contextMode === "thread" ? "full" : contextMode,
      });

      emitOrch(wc, {
        type: "finalize_message",
        conversationId: ctx.conversationId,
        messageId: assistantMessageId,
        patch: { content: text, ...(thinking ? { thinking } : {}), streaming: false },
      });

      return { text, thinking, messageId: assistantMessageId };
    } catch (err) {
      emitOrch(wc, {
        type: "finalize_message",
        conversationId: ctx.conversationId,
        messageId: assistantMessageId,
        patch: { error: String(err?.message ?? err), streaming: false },
      });
      throw err;
    } finally {
      this.deps.releaseChatStreamSlot();
      emitOrch(wc, { type: "stream_end", conversationId: ctx.conversationId, streamId });
    }
  }
}

module.exports = {
  OrchestrationService,
  ORCH_EVENT_CHAN,
};
