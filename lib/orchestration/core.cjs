"use strict";

const {
  OrchestrationRole,
  agentsByOrchestrationRole,
  orchestrationParticipantIds,
  orchestrationRoleForAgent,
  matchAgentCapability,
} = require("./roles.cjs");

const MAX_ORCHESTRATION_PHASES = 7;

/** @typedef {'todo' | 'in_progress' | 'done' | 'blocked' | 'review'} OrchestrationTaskStatus */
/** @typedef {'research' | 'work' | 'review' | 'synthesize'} OrchestrationTaskKind */
/** @typedef {'pm_research' | 'development' | 'review' | 'rollup'} OrchestrationTaskPhase */
/** @typedef {'planning' | 'awaiting_approval' | 'revising' | 'running' | 'paused' | 'completed' | 'failed'} OrchestrationRunStatus */

/**
 * @typedef {object} OrchestrationPreTask
 * @property {string} agentId
 * @property {string} brief
 */

function newOrchestrationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `orch_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * @param {unknown} raw
 * @returns {OrchestrationTaskKind}
 */
function normalizeTaskKind(raw, phase) {
  const k = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (k === "research" || k === "work" || k === "review" || k === "synthesize") return k;
  const p = typeof phase === "string" ? phase : "";
  if (p === "review") return "review";
  if (p === "pm_research") return "research";
  if (p === "rollup") return "synthesize";
  return "work";
}

/**
 * @param {unknown} raw
 * @returns {import("./roles.cjs").OrchestrationTask | null}
 */
function normalizeOrchestrationTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : newOrchestrationId();
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;
  const statusRaw = typeof r.status === "string" ? r.status : "todo";
  const status =
    statusRaw === "in_progress" ||
    statusRaw === "done" ||
    statusRaw === "blocked" ||
    statusRaw === "review"
      ? statusRaw
      : "todo";
  const phaseRaw = typeof r.phase === "string" ? r.phase : "development";
  const phase =
    phaseRaw === "pm_research" || phaseRaw === "review" || phaseRaw === "rollup"
      ? phaseRaw
      : "development";
  const dependsOn = Array.isArray(r.dependsOn)
    ? r.dependsOn.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
    : [];
  const taskKind = normalizeTaskKind(r.taskKind, phase);
  return {
    id,
    title,
    description: typeof r.description === "string" ? r.description : "",
    ownerAgentId: typeof r.ownerAgentId === "string" ? r.ownerAgentId : null,
    ownerRole:
      typeof r.ownerRole === "string"
        ? /** @type {import("./roles.cjs").OrchestrationRoleValue} */ (r.ownerRole)
        : OrchestrationRole.NONE,
    domain: typeof r.domain === "string" ? r.domain : "",
    taskKind,
    status,
    phase,
    dependsOn,
    output: typeof r.output === "string" ? r.output : undefined,
    reviewRound: Number.isFinite(r.reviewRound) ? Math.floor(Number(r.reviewRound)) : undefined,
  };
}

function formatPhaseTitle(title, phaseIndex) {
  const n = Math.max(1, Math.min(MAX_ORCHESTRATION_PHASES, Math.floor(phaseIndex)));
  const label = `Phase ${n}`;
  const trimmed = String(title ?? "").trim();
  const stripped = trimmed.replace(/^phase\s*\d+\s*[:\-–—.]?\s*/i, "").trim();
  return stripped ? `${label}: ${stripped}` : label;
}

function parsePhaseNumber(title, fallback = 1) {
  const m = /^phase\s*(\d+)/i.exec(String(title ?? "").trim());
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(MAX_ORCHESTRATION_PHASES, n));
  }
  return Math.max(1, Math.min(MAX_ORCHESTRATION_PHASES, Math.floor(fallback)));
}

function enforcePlanPhaseFormat(plan) {
  let tasks = plan.tasks.map((task) => {
    const phaseNum = parsePhaseNumber(task.title, 1);
    return { ...task, title: formatPhaseTitle(task.title, phaseNum) };
  });
  const distinct = [...new Set(tasks.map((t) => parsePhaseNumber(t.title, 1)))].sort((a, b) => a - b);
  if (distinct.length > MAX_ORCHESTRATION_PHASES) {
    const remap = new Map();
    distinct.forEach((n, i) => {
      remap.set(n, i < MAX_ORCHESTRATION_PHASES ? n : MAX_ORCHESTRATION_PHASES);
    });
    tasks = tasks.map((t) => {
      const raw = parsePhaseNumber(t.title, 1);
      const clamped = remap.get(raw) ?? MAX_ORCHESTRATION_PHASES;
      return { ...t, title: formatPhaseTitle(t.title, clamped) };
    });
  }
  return { ...plan, tasks };
}

function normalizeOrchestrationPlan(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const summary = typeof r.summary === "string" ? r.summary.trim() : "";
  if (!summary) return null;
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.map(normalizeOrchestrationTask).filter(Boolean)
    : [];
  return enforcePlanPhaseFormat({
    version: Number.isFinite(r.version) ? Math.max(1, Math.floor(Number(r.version))) : 1,
    summary,
    feasibility: typeof r.feasibility === "string" ? r.feasibility : "",
    tasks,
  });
}

/**
 * @param {unknown} raw
 * @returns {OrchestrationPreTask[]}
 */
function normalizePreTasks(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {OrchestrationPreTask[]} */
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const agentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
    const brief = typeof row.brief === "string" ? row.brief.trim() : "";
    if (agentId && brief) out.push({ agentId, brief });
  }
  return out;
}

function normalizeOrchestrationRun(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const runId = typeof r.runId === "string" && r.runId.trim() ? r.runId.trim() : "";
  if (!runId) return null;
  const statusRaw = typeof r.status === "string" ? r.status : "planning";
  const status =
    statusRaw === "awaiting_approval" ||
    statusRaw === "revising" ||
    statusRaw === "running" ||
    statusRaw === "paused" ||
    statusRaw === "completed" ||
    statusRaw === "failed"
      ? statusRaw
      : "planning";
  const plan = r.plan != null ? normalizeOrchestrationPlan(r.plan) : null;
  return {
    runId,
    status,
    currentPhase: typeof r.currentPhase === "string" ? r.currentPhase : undefined,
    userRequirement: typeof r.userRequirement === "string" ? r.userRequirement : "",
    scenarioSummary: typeof r.scenarioSummary === "string" ? r.scenarioSummary : "",
    requiresApproval: r.requiresApproval !== false,
    preTasks: normalizePreTasks(r.preTasks),
    mentionIds: Array.isArray(r.mentionIds)
      ? r.mentionIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [],
    participantIds: Array.isArray(r.participantIds)
      ? r.participantIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [],
    revisionNotes: typeof r.revisionNotes === "string" ? r.revisionNotes : undefined,
    plan,
    activeTaskId: typeof r.activeTaskId === "string" ? r.activeTaskId : null,
    activeTaskIds: Array.isArray(r.activeTaskIds)
      ? r.activeTaskIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [],
    reviewResults:
      r.reviewResults && typeof r.reviewResults === "object" ? /** @type {Record<string, { approved: boolean; findings: string[] }>} */ (r.reviewResults) : {},
    startedAt: Number.isFinite(r.startedAt) ? Number(r.startedAt) : Date.now(),
    updatedAt: Number.isFinite(r.updatedAt) ? Number(r.updatedAt) : undefined,
  };
}

function tryParseJsonObject(slice) {
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

function parsePlanFromResponse(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  /** @type {string[]} */
  const candidates = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch;
  while ((fenceMatch = fenceRe.exec(raw)) !== null) {
    const body = fenceMatch[1]?.trim();
    if (body) candidates.push(body);
  }
  candidates.push(raw);
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    const parsed = tryParseJsonObject(c.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") continue;
    const plan = normalizeOrchestrationPlan(parsed);
    if (plan) return plan;
    if (Array.isArray(parsed.tasks)) {
      const tasks = parsed.tasks.map(normalizeOrchestrationTask).filter(Boolean);
      if (tasks.length) {
        const summary =
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim()
            : tasks.map((t) => t.title).join(" · ").slice(0, 500);
        return enforcePlanPhaseFormat({
          version: Number.isFinite(parsed.version) ? Math.max(1, Math.floor(Number(parsed.version))) : 1,
          summary,
          feasibility: typeof parsed.feasibility === "string" ? parsed.feasibility : "",
          tasks,
        });
      }
    }
  }
  return null;
}

function parseReviewFromResponse(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = fence ? [fence[1].trim(), raw] : [raw];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(c.slice(start, end + 1));
      if (!parsed || typeof parsed !== "object") continue;
      return {
        approved: Boolean(parsed.approved),
        findings: Array.isArray(parsed.findings)
          ? parsed.findings.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
          : [],
      };
    } catch {
      /* try next */
    }
  }
  const lower = raw.toLowerCase();
  if (lower.includes("approved") && lower.includes("true")) return { approved: true, findings: [] };
  if (lower.includes("approved") && lower.includes("false")) {
    return { approved: false, findings: [raw.slice(0, 800)] };
  }
  return null;
}

function readyTasks(tasks) {
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return tasks.filter((t) => {
    if (t.status !== "todo" && t.status !== "blocked") return false;
    return t.dependsOn.every((dep) => doneIds.has(dep));
  });
}

function orchestrationAssignOpts(agents, opts = {}) {
  return {
    mainAgent: opts.mainAgent ?? null,
    participantIds: orchestrationParticipantIds(agents, opts),
    mentionIds: opts.mentionIds ?? [],
  };
}

function orchestrationTeamAgents(agents, opts = {}) {
  const poolIds = new Set(orchestrationParticipantIds(agents, opts));
  return agents.filter((a) => poolIds.has(a.id));
}

function formatOrchestrationTeamRoster(agents, opts, t) {
  const poolIds = new Set(orchestrationParticipantIds(agents, opts));
  const team = agents.filter((a) => poolIds.has(a.id));
  if (!team.length) return "";
  const roleLabel = (role) =>
    t ? t(`orchestration.roles.${role === OrchestrationRole.NONE ? "none" : role}`) : role;
  return [
    "**Only assign tasks to agents listed below. Do not use any other agent id.**",
    "",
    ...team.map((a) => {
      const role = orchestrationRoleForAgent(a);
      const domain = (a.orchestrationDomain || a.description || "").trim();
      const name = a.name || a.gatewayAgentId || a.id;
      const mainTag = a.isMain ? " (main orchestrator)" : "";
      return `- id: \`${a.id}\` · **${name}**${mainTag} · ${roleLabel(role)}${domain ? ` · ${domain}` : ""}`;
    }),
  ].join("\n");
}

function pickCandidateAgent(candidates, domain, loadByAgent) {
  if (!candidates.length) return null;
  const d = domain.trim().toLowerCase();
  if (d && candidates.length > 1) {
    const domainMatch =
      candidates.find((a) => (a.orchestrationDomain || "").toLowerCase().includes(d)) ||
      candidates.find((a) => (a.description || "").toLowerCase().includes(d));
    if (domainMatch) {
      loadByAgent.set(domainMatch.id, (loadByAgent.get(domainMatch.id) ?? 0) + 1);
      return domainMatch;
    }
  }
  let best = candidates[0];
  let bestLoad = loadByAgent.get(best.id) ?? 0;
  for (const a of candidates) {
    const load = loadByAgent.get(a.id) ?? 0;
    if (load < bestLoad) {
      best = a;
      bestLoad = load;
    }
  }
  loadByAgent.set(best.id, bestLoad + 1);
  return best;
}

/**
 * @param {import("./roles.cjs").OrchestrationTask} task
 * @param {import("./roles.cjs").LobsterAgent[]} agents
 * @param {{ participantIds?: string[]; mentionIds?: string[]; mainAgent?: import("./roles.cjs").LobsterAgent | null }} opts
 * @param {Set<string>} busyAgentIds
 * @param {Map<string, number>} [loadByAgent]
 */
function resolveTaskOwner(task, agents, opts = {}, busyAgentIds = new Set(), loadByAgent = new Map()) {
  const poolIds = new Set(orchestrationParticipantIds(agents, opts));
  const pool = agents.filter((a) => poolIds.has(a.id) && !busyAgentIds.has(a.id));

  const ownerId = typeof task.ownerAgentId === "string" ? task.ownerAgentId.trim() : "";
  if (ownerId && poolIds.has(ownerId)) {
    const hit = pool.find((a) => a.id === ownerId);
    if (hit) {
      loadByAgent.set(hit.id, (loadByAgent.get(hit.id) ?? 0) + 1);
      return hit;
    }
  }

  const capMatches = pool
    .map((a) => ({ agent: a, score: matchAgentCapability(a, task.description || task.title || task.domain || "") }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (capMatches.length) {
    const best = capMatches[0].agent;
    loadByAgent.set(best.id, (loadByAgent.get(best.id) ?? 0) + 1);
    return best;
  }

  const role = task.ownerRole || OrchestrationRole.NONE;
  if (!role || role === OrchestrationRole.MAIN) {
    const main = opts.mainAgent ?? agents.find((a) => a.isMain) ?? null;
    if (main && poolIds.has(main.id) && !busyAgentIds.has(main.id)) return main;
    return null;
  }
  const candidates = agentsByOrchestrationRole(agents, role, opts).filter((a) => !busyAgentIds.has(a.id));
  return pickCandidateAgent(candidates, task.domain || "", loadByAgent);
}

function pickExecutionOwner(task, agents, opts, busyAgentIds, loadByAgent) {
  return resolveTaskOwner(task, agents, opts, busyAgentIds, loadByAgent);
}

/**
 * @param {import("./roles.cjs").OrchestrationPlan} plan
 * @param {Set<string> | string[]} poolAgentIds
 */
function sanitizePlanForPool(plan, poolAgentIds) {
  const pool = new Set(Array.isArray(poolAgentIds) ? poolAgentIds : [...poolAgentIds]);
  let blockedNote = "";
  const tasks = plan.tasks.map((task) => {
    let ownerAgentId = task.ownerAgentId;
    if (ownerAgentId && !pool.has(ownerAgentId)) {
      ownerAgentId = null;
      blockedNote = " Some tasks referenced agents outside this conversation and were adjusted.";
    }
    const next = { ...task, ownerAgentId };
    if (!ownerAgentId && !next.ownerRole) {
      return { ...next, status: next.status === "done" ? "done" : "blocked" };
    }
    return next;
  });
  return {
    plan: {
      ...plan,
      summary: blockedNote ? `${plan.summary}${blockedNote}` : plan.summary,
      tasks,
    },
  };
}

function assignTaskOwners(plan, agents, opts = {}) {
  const poolIds = orchestrationParticipantIds(agents, opts);
  const loadByAgent = new Map();
  const tasks = plan.tasks.map((task) => {
    let ownerAgentId = typeof task.ownerAgentId === "string" ? task.ownerAgentId.trim() : "";
    if (!ownerAgentId || !poolIds.includes(ownerAgentId)) {
      const owner = resolveTaskOwner(task, agents, opts, new Set(), loadByAgent);
      if (owner) ownerAgentId = owner.id;
    }
    return { ...task, ownerAgentId: ownerAgentId || null };
  });
  return sanitizePlanForPool({ ...plan, tasks }, poolIds).plan;
}

function patchPlanTask(plan, taskId, patch) {
  return {
    ...plan,
    tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
  };
}

function taskIsExecutable(task) {
  const kind = task.taskKind || normalizeTaskKind(null, task.phase);
  return (
    (kind === "research" || kind === "work" || kind === "review" || kind === "synthesize") &&
    task.status !== "done" &&
    task.status !== "blocked"
  );
}

function buildPlanRevisionPrompt(plan, revisionNotes) {
  return [
    "The user requested changes to the collaboration plan. Merge their feedback into an updated plan.",
    "",
    "## Current plan (JSON)",
    "```json",
    JSON.stringify(plan, null, 2),
    "```",
    "",
    "## User revision notes",
    revisionNotes.trim(),
    "",
    "Respond with ONLY a JSON object matching this schema:",
    "{",
    '  "version": <number>,',
    '  "summary": "<string>",',
    '  "feasibility": "<string>",',
    '  "tasks": [{',
    '    "id": "<stable-id>",',
    '    "title": "Phase N: <short deliverable>",',
    '    "description": "<string>",',
    '    "ownerAgentId": "<agent-id-from-roster>",',
    '    "ownerRole": "<optional hint>",',
    '    "taskKind": "research|work|review|synthesize",',
    '    "status": "todo",',
    '    "dependsOn": ["<task-id>"]',
    "  }]",
    "}",
    "",
    `STRICT: at most ${MAX_ORCHESTRATION_PHASES} distinct phase numbers.`,
    "Every task MUST set ownerAgentId to an id from the available team roster.",
    "Use dependsOn only for real blockers.",
  ].join("\n");
}

function buildOrchestrationTriagePrompt(requirement, teamRoster = "") {
  return [
    "You are the lead orchestrator. Analyze the user's request and the available agents in this group chat.",
    "Decide how to coordinate work before the main plan is synthesized.",
    teamRoster ? `\n## Available team (ONLY these agents may be assigned)\n${teamRoster}` : "\nNo teammates in this session besides the main agent.",
    "",
    "## User requirement",
    requirement.trim(),
    "",
    "Respond with ONLY JSON:",
    "{",
    '  "scenarioSummary": "<one sentence: e.g. content writing, market research, software development, mixed>",',
    '  "requiresApproval": true,',
    '  "preTasks": [{ "agentId": "<id from roster>", "brief": "<what this agent should research/prepare before planning>" }],',
    '  "planNotes": "<guidance for plan synthesis: workflow shape, parallelism, which agents for which steps>"',
    "}",
    "",
    "Rules:",
    "- preTasks is optional; use when an agent should gather context before the plan (research, draft outline, etc.).",
    "- preTasks agentId MUST be from the roster above.",
    "- Do NOT assume a software-development pipeline; match the scenario (copywriting, research, analysis, coding, etc.).",
    "- requiresApproval: keep true unless the request is trivial single-step work.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseTriageFromResponse(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = fence ? [fence[1].trim(), raw] : [raw];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(c.slice(start, end + 1));
      if (!parsed || typeof parsed !== "object") continue;
      return {
        scenarioSummary: typeof parsed.scenarioSummary === "string" ? parsed.scenarioSummary.trim() : "",
        requiresApproval: parsed.requiresApproval !== false,
        preTasks: normalizePreTasks(parsed.preTasks),
        planNotes: typeof parsed.planNotes === "string" ? parsed.planNotes.trim() : "",
        summary:
          typeof parsed.summary === "string"
            ? parsed.summary.trim()
            : typeof parsed.scenarioSummary === "string"
              ? parsed.scenarioSummary.trim()
              : "",
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

function buildPreTaskPrompt(brief, agent, teamRoster = "") {
  const domain = (agent.orchestrationDomain || agent.description || "").trim();
  return [
    "You are a teammate on a multi-agent team. Complete this preparatory task before the orchestrator finalizes the plan.",
    domain ? `Your focus: ${domain}` : "",
    teamRoster ? `\n## Team colleagues\n${teamRoster}` : "",
    "",
    "## Your assignment",
    brief.trim(),
    "",
    "Respond in markdown with concrete findings, draft material, or recommendations the orchestrator can use when building the plan.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlanSynthesisPrompt(requirement, preResults, teamRoster = "", planNotes = "") {
  const blocks = preResults.map(
    ({ agent, output }) => `### ${agent.name || agent.gatewayAgentId}\n${output.trim()}`,
  );
  return [
    "You are the lead orchestrator. Produce a collaboration plan for user approval.",
    teamRoster ? "\n## Available team — ONLY assign ownerAgentId from this list\n" + teamRoster : "",
    "",
    "## User requirement",
    requirement.trim(),
    planNotes ? `\n## Orchestration notes\n${planNotes}` : "",
    blocks.length ? `\n## Pre-task outputs\n${blocks.join("\n\n")}` : "",
    "",
    "Respond with ONLY a JSON object:",
    "{",
    '  "version": 1,',
    '  "summary": "<one paragraph plan overview>",',
    '  "feasibility": "<overall assessment>",',
    '  "tasks": [{',
    '    "id": "t1",',
    '    "title": "Phase 1: <short deliverable>",',
    '    "description": "<what to deliver>",',
    '    "ownerAgentId": "<required — id from roster>",',
    '    "ownerRole": "<optional hint>",',
    '    "taskKind": "research|work|review|synthesize",',
    '    "status": "todo",',
    '    "dependsOn": []',
    "  }]",
    "}",
    "",
    `STRICT: at most ${MAX_ORCHESTRATION_PHASES} distinct phase numbers.`,
    "Every task MUST include ownerAgentId from the roster. Never invent agent ids.",
    "Use taskKind: research for investigation, work for primary deliverables, review for quality checks, synthesize for final rollup.",
    "Include review tasks only when the scenario benefits from explicit review.",
    "Use dependsOn ONLY for real blockers. Empty dependsOn tasks may run in parallel.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTaskPrompt(task, requirement, plan, teamRoster = "", priorReviewFindings = null) {
  const kind = task.taskKind || normalizeTaskKind(null, task.phase);
  const deps = plan.tasks
    .filter((t) => task.dependsOn.includes(t.id) && t.output)
    .map((t) => `### ${t.title}\n${t.output}`)
    .join("\n\n");

  if (kind === "review") {
    const subject = plan.tasks.find((t) => task.dependsOn.includes(t.id) && t.output);
    return [
      "You are reviewing a teammate's deliverable.",
      "",
      `## Review task: ${task.title}`,
      task.description || "",
      "",
      "## Deliverable under review",
      (subject?.output || "").trim(),
      "",
      "Respond with ONLY JSON:",
      '{ "approved": true|false, "findings": ["<issue or praise>"] }',
    ].join("\n");
  }

  const kindLabel =
    kind === "research"
      ? "research and gather information"
      : kind === "synthesize"
        ? "synthesize and summarize"
        : "complete the assigned deliverable";

  let body = [
    `You are executing task: **${task.title}**`,
    task.description ? task.description : "",
    `Your job: ${kindLabel}.`,
    teamRoster ? `\n## Team colleagues\n${teamRoster}` : "",
    "",
    "## Original requirement",
    requirement.trim(),
    "",
    deps ? `## Completed dependencies\n${deps}` : "",
    "",
    "Deliver your work summary: what you produced, key points, files touched if any, how to verify. Be concrete.",
  ];

  if (priorReviewFindings?.length) {
    body = body.concat([
      "",
      "## Review feedback — address these issues:",
      priorReviewFindings.map((f) => `- ${f}`).join("\n"),
    ]);
  }

  return body.filter(Boolean).join("\n");
}

function buildDevTaskPrompt(task, requirement, plan, teamRoster = "") {
  return buildTaskPrompt(task, requirement, plan, teamRoster);
}

function buildReviewPrompt(subjectTask, subjectOutput) {
  return [
    "You are reviewing a teammate's deliverable.",
    "",
    `## Task: ${subjectTask?.title || "deliverable"}`,
    subjectTask?.description || "",
    "",
    "## Deliverable",
    String(subjectOutput ?? "").trim(),
    "",
    "Respond with ONLY JSON:",
    '{ "approved": true|false, "findings": ["<issue or praise>"] }',
  ].join("\n");
}

function buildRollupPrompt(requirement, plan) {
  const done = plan.tasks
    .filter((t) => t.output)
    .map((t) => `### ${t.title} (${t.status})\n${t.output}`)
    .join("\n\n");
  return [
    "You are the lead orchestrator. Summarize the completed multi-agent workflow for the user.",
    "",
    "## Original requirement",
    requirement.trim(),
    "",
    "## Plan summary",
    plan.summary,
    "",
    "## Task outputs",
    done || "(no outputs yet)",
    "",
    "Provide: executive summary, what was delivered, open risks, and suggested next steps.",
  ].join("\n");
}

function buildPmResearchPrompt(requirement, pm, teamRoster = "") {
  return buildPreTaskPrompt(
    `Research and assess this request from your specialty perspective:\n\n${requirement.trim()}`,
    pm,
    teamRoster,
  );
}

function resolveTriageNeedsPm() {
  return false;
}

module.exports = {
  MAX_ORCHESTRATION_PHASES,
  newOrchestrationId,
  normalizeTaskKind,
  normalizeOrchestrationTask,
  normalizeOrchestrationPlan,
  normalizeOrchestrationRun,
  normalizePreTasks,
  parsePlanFromResponse,
  parseReviewFromResponse,
  parseTriageFromResponse,
  readyTasks,
  orchestrationAssignOpts,
  orchestrationTeamAgents,
  formatOrchestrationTeamRoster,
  resolveTaskOwner,
  pickExecutionOwner,
  sanitizePlanForPool,
  assignTaskOwners,
  patchPlanTask,
  taskIsExecutable,
  enforcePlanPhaseFormat,
  buildPlanRevisionPrompt,
  buildOrchestrationTriagePrompt,
  buildPreTaskPrompt,
  buildPlanSynthesisPrompt,
  buildTaskPrompt,
  buildDevTaskPrompt,
  buildReviewPrompt,
  buildRollupPrompt,
  buildPmResearchPrompt,
  resolveTriageNeedsPm,
};
