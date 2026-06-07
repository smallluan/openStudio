import {
  OrchestrationRole,
  agentsByOrchestrationRole,
  orchestrationParticipantIds,
  orchestrationRoleForAgent,
} from "./orchestrationRoles.js";

export const MAX_ORCHESTRATION_PHASES = 7;

/** @typedef {'todo' | 'in_progress' | 'done' | 'blocked' | 'review'} OrchestrationTaskStatus */
/** @typedef {'pm_research' | 'development' | 'review' | 'rollup'} OrchestrationTaskPhase */
/** @typedef {'planning' | 'awaiting_approval' | 'revising' | 'running' | 'paused' | 'completed' | 'failed'} OrchestrationRunStatus */

/**
 * @typedef {object} OrchestrationTask
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string | null} [ownerAgentId]
 * @property {import("./orchestrationRoles.js").OrchestrationRoleValue} [ownerRole]
 * @property {string} [domain]
 * @property {OrchestrationTaskStatus} status
 * @property {OrchestrationTaskPhase} phase
 * @property {string[]} dependsOn
 * @property {string} [output]
 * @property {number} [reviewRound]
 */

/**
 * @typedef {object} OrchestrationPlan
 * @property {number} version
 * @property {string} summary
 * @property {string} [feasibility]
 * @property {OrchestrationTask[]} tasks
 */

/**
 * @typedef {object} OrchestrationRun
 * @property {string} runId
 * @property {OrchestrationRunStatus} status
 * @property {string} [currentPhase]
 * @property {string} userRequirement
 * @property {string[]} [mentionIds]
 * @property {string[]} [participantIds] Snapshot of session participants when the run started
 * @property {string} [revisionNotes]
 * @property {OrchestrationPlan | null} plan
 * @property {string | null} [activeTaskId]
 * @property {number} [planMessageId]
 * @property {Record<string, { approved: boolean; findings: string[] }>} [reviewResults]
 * @property {number} startedAt
 * @property {number} [updatedAt]
 */

/** @returns {string} */
export function newOrchestrationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `orch_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * @param {unknown} raw
 * @returns {OrchestrationTask | null}
 */
export function normalizeOrchestrationTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : newOrchestrationId();
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;
  const statusRaw = typeof r.status === "string" ? r.status : "todo";
  /** @type {OrchestrationTaskStatus} */
  const status =
    statusRaw === "in_progress" ||
    statusRaw === "done" ||
    statusRaw === "blocked" ||
    statusRaw === "review"
      ? statusRaw
      : "todo";
  const phaseRaw = typeof r.phase === "string" ? r.phase : "development";
  /** @type {OrchestrationTaskPhase} */
  const phase =
    phaseRaw === "pm_research" || phaseRaw === "review" || phaseRaw === "rollup"
      ? phaseRaw
      : "development";
  const dependsOn = Array.isArray(r.dependsOn)
    ? r.dependsOn.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
    : [];
  return {
    id,
    title,
    description: typeof r.description === "string" ? r.description : "",
    ownerAgentId: typeof r.ownerAgentId === "string" ? r.ownerAgentId : null,
    ownerRole:
      typeof r.ownerRole === "string"
        ? /** @type {import("./orchestrationRoles.js").OrchestrationRoleValue} */ (r.ownerRole)
        : OrchestrationRole.NONE,
    domain: typeof r.domain === "string" ? r.domain : "",
    status,
    phase,
    dependsOn,
    output: typeof r.output === "string" ? r.output : undefined,
    reviewRound: Number.isFinite(r.reviewRound) ? Math.floor(Number(r.reviewRound)) : undefined,
  };
}

/**
 * @param {string} title
 * @param {number} phaseIndex 1-based
 */
export function formatPhaseTitle(title, phaseIndex) {
  const n = Math.max(1, Math.min(MAX_ORCHESTRATION_PHASES, Math.floor(phaseIndex)));
  const label = `Phase ${n}`;
  const trimmed = String(title ?? "").trim();
  const stripped = trimmed.replace(/^phase\s*\d+\s*[:\-–—.]?\s*/i, "").trim();
  return stripped ? `${label}: ${stripped}` : label;
}

/**
 * @param {string} title
 * @param {number} [fallback]
 */
export function parsePhaseNumber(title, fallback = 1) {
  const m = /^phase\s*(\d+)/i.exec(String(title ?? "").trim());
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(MAX_ORCHESTRATION_PHASES, n));
  }
  return Math.max(1, Math.min(MAX_ORCHESTRATION_PHASES, Math.floor(fallback)));
}

/**
 * @param {OrchestrationPlan} plan
 * @returns {OrchestrationPlan}
 */
export function enforcePlanPhaseFormat(plan) {
  let tasks = plan.tasks.map((task) => {
    const phaseNum = parsePhaseNumber(task.title, 1);
    return { ...task, title: formatPhaseTitle(task.title, phaseNum) };
  });
  const distinct = [...new Set(tasks.map((t) => parsePhaseNumber(t.title, 1)))].sort((a, b) => a - b);
  if (distinct.length > MAX_ORCHESTRATION_PHASES) {
    /** @type {Map<number, number>} */
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

/**
 * @param {unknown} raw
 * @returns {OrchestrationPlan | null}
 */
export function normalizeOrchestrationPlan(raw) {
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
    tasks: /** @type {OrchestrationTask[]} */ (tasks),
  });
}

/**
 * @param {unknown} raw
 * @returns {OrchestrationRun | null}
 */
export function normalizeOrchestrationRun(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const runId = typeof r.runId === "string" && r.runId.trim() ? r.runId.trim() : "";
  if (!runId) return null;
  const statusRaw = typeof r.status === "string" ? r.status : "planning";
  /** @type {OrchestrationRunStatus} */
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
    mentionIds: Array.isArray(r.mentionIds)
      ? r.mentionIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [],
    participantIds: Array.isArray(r.participantIds)
      ? r.participantIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [],
    revisionNotes: typeof r.revisionNotes === "string" ? r.revisionNotes : undefined,
    plan,
    activeTaskId: typeof r.activeTaskId === "string" ? r.activeTaskId : null,
    reviewResults:
      r.reviewResults && typeof r.reviewResults === "object"
        ? /** @type {Record<string, { approved: boolean; findings: string[] }>} */ (r.reviewResults)
        : {},
    startedAt: Number.isFinite(r.startedAt) ? Number(r.startedAt) : Date.now(),
    updatedAt: Number.isFinite(r.updatedAt) ? Number(r.updatedAt) : undefined,
  };
}

/**
 * Extract JSON plan from model output.
 * @param {string} text
 * @returns {OrchestrationPlan | null}
 */
export function parsePlanFromResponse(text) {
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
      const plan = normalizeOrchestrationPlan(parsed);
      if (plan) return plan;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{ approved: boolean; findings: string[] } | null}
 */
export function parseReviewFromResponse(text) {
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
      const approved = Boolean(parsed.approved);
      const findings = Array.isArray(parsed.findings)
        ? parsed.findings.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
        : [];
      return { approved, findings };
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

/**
 * @param {OrchestrationTask[]} tasks
 * @returns {OrchestrationTask[]}
 */
export function readyTasks(tasks) {
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return tasks.filter((t) => {
    if (t.status !== "todo" && t.status !== "blocked") return false;
    return t.dependsOn.every((dep) => doneIds.has(dep));
  });
}

/**
 * Assign ownerAgentId on tasks missing one, using role + domain.
 * @param {OrchestrationPlan} plan
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ participantIds?: string[]; mainAgent?: import("./agents.js").LobsterAgent | null }} opts
 * @returns {OrchestrationPlan}
 */
/** @param {{ participantIds?: string[]; mentionIds?: string[]; mainAgent?: import("./agents.js").LobsterAgent | null }} opts */
export function orchestrationAssignOpts(agents, opts = {}) {
  return {
    mainAgent: opts.mainAgent ?? null,
    participantIds: orchestrationParticipantIds(agents, opts),
    mentionIds: opts.mentionIds ?? [],
  };
}

/**
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ mainAgent?: import("./agents.js").LobsterAgent | null; participantIds?: string[]; mentionIds?: string[] }} opts
 */
export function orchestrationTeamAgents(agents, opts = {}) {
  const poolIds = new Set(orchestrationParticipantIds(agents, opts));
  return agents.filter((a) => poolIds.has(a.id));
}

/**
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ mainAgent?: import("./agents.js").LobsterAgent | null; participantIds?: string[]; mentionIds?: string[] }} opts
 * @param {(key: string) => string} [t]
 */
export function formatOrchestrationTeamRoster(agents, opts, t) {
  const team = orchestrationTeamAgents(agents, opts).filter((a) => !a.isMain);
  if (!team.length) return "";
  const roleLabel = (role) =>
    t
      ? t(`orchestration.roles.${role === OrchestrationRole.NONE ? "none" : role}`)
      : role;
  return team
    .map((a) => {
      const role = orchestrationRoleForAgent(a);
      const domain = (a.orchestrationDomain || a.description || "").trim();
      const name = a.name || a.gatewayAgentId || a.id;
      return `- id: \`${a.id}\` · **${name}** · ${roleLabel(role)}${domain ? ` · ${domain}` : ""}`;
    })
    .join("\n");
}

/**
 * Pick the best agent for a task among idle candidates with a matching role.
 * @param {import("./agents.js").LobsterAgent[]} candidates
 * @param {string} domain
 * @param {Map<string, number>} loadByAgent
 */
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
 * @param {OrchestrationTask} task
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {{ participantIds?: string[]; mentionIds?: string[]; mainAgent?: import("./agents.js").LobsterAgent | null }} opts
 * @param {Set<string>} busyAgentIds
 * @param {Map<string, number>} [loadByAgent]
 * @returns {import("./agents.js").LobsterAgent | null}
 */
export function pickExecutionOwner(task, agents, opts = {}, busyAgentIds = new Set(), loadByAgent = new Map()) {
  const role = task.ownerRole || OrchestrationRole.NONE;
  if (!role || role === OrchestrationRole.MAIN) {
    return opts.mainAgent ?? agents.find((a) => a.isMain) ?? null;
  }
  const candidates = agentsByOrchestrationRole(agents, role, opts).filter((a) => !busyAgentIds.has(a.id));
  return pickCandidateAgent(candidates, task.domain || "", loadByAgent);
}

/** Strip pre-assigned owners — execution assigns dynamically by role + availability. */
export function assignTaskOwners(plan, agents, opts = {}) {
  void agents;
  void opts;
  const tasks = plan.tasks.map((task) => ({ ...task, ownerAgentId: null }));
  return { ...plan, tasks };
}

/**
 * @param {OrchestrationPlan} plan
 * @param {string} taskId
 * @param {Partial<OrchestrationTask>} patch
 * @returns {OrchestrationPlan}
 */
export function patchPlanTask(plan, taskId, patch) {
  return {
    ...plan,
    tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
  };
}

/**
 * Merge user revision text into plan via main-agent prompt context (returns tasks for re-plan).
 * @param {OrchestrationPlan} plan
 * @param {string} revisionNotes
 * @returns {string}
 */
export function buildPlanRevisionPrompt(plan, revisionNotes) {
  return [
    "The user requested changes to the development plan. Merge their feedback into an updated plan.",
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
    '    "ownerRole": "pm|fe|be|reviewer",',
    '    "domain": "<optional>",',
    '    "phase": "pm_research|development|review|rollup",',
    '    "status": "todo",',
    '    "dependsOn": ["<task-id>"]',
    "  }]",
    "}",
    "",
    `STRICT: at most ${MAX_ORCHESTRATION_PHASES} distinct phase numbers.`,
    "Do NOT set ownerAgentId — only ownerRole. Runtime assigns idle teammates with matching roles.",
    "Multiple parallel tasks may share the same phase number. Use dependsOn only for real blockers.",
  ].join("\n");
}

/**
 * @param {string} requirement
 * @param {string} teamRoster
 * @returns {string}
 */
export function buildOrchestrationTriagePrompt(requirement, teamRoster = "", hasPmAgents = false) {
  return [
    "You are the lead orchestrator. Analyze the user's request and decide how to proceed before any work begins.",
    teamRoster ? `\n## Available team\n${teamRoster}` : "",
    hasPmAgents
      ? "\nA product manager (PM) agent IS available in this session."
      : "\nNo PM agent is in this session — set needsPmResearch to false.",
    "",
    "## User requirement",
    requirement.trim(),
    "",
    "Respond with ONLY JSON:",
    "{",
    '  "summary": "<brief interpretation of the request>",',
    '  "needsPmResearch": <true|false>,',
    '  "planNotes": "<guidance for plan synthesis: approach, risks, which roles are needed>"',
    "}",
    "",
    "Rules for needsPmResearch:",
    "- TRUE for new features, product requirements, multi-step development, greenfield builds, websites/apps, or unclear scope that PM should clarify.",
    "- FALSE only for: bug fixes, hotfixes, tiny tweaks, typo/copy edits, refactors with clear scope, or simple Q&A.",
    "- When PM is available and the user asks to build/implement/develop something, default to TRUE unless it is clearly a small fix.",
    "- planNotes should describe the right plan shape (roles, parallelism), not a fixed pipeline.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** @type {RegExp[]} */
const TRIAGE_SKIP_PM_PATTERNS = [
  /\bbug\b/i,
  /修\s*复|修复|改\s*bug|bug\s*修/i,
  /hot\s*fix|hotfix/i,
  /patch\b/i,
  /typo|拼写|错别字/i,
  /微调|小改|小修|小调整/,
  /refactor/i,
  /^(什么是|解释一下|how\s+(do|to)|what\s+is)\b/i,
];

/** @type {RegExp[]} */
const TRIAGE_DEV_FEATURE_PATTERNS = [
  /开发|实现|搭建|构建|新建|创建|做一?个/,
  /官网|网站|网页|web\s*site|landing\s*page/i,
  /功能|需求|feature|implement|build|create|develop/i,
  /从\s*0|从零|scratch|greenfield/i,
  /项目|系统|平台|app|应用/,
];

/**
 * Decide whether PM research should run. LLM triage is advisory; code enforces user intent.
 * @param {{ needsPmResearch?: boolean } | null | undefined} triage
 * @param {string} requirement
 * @param {boolean} hasPmAgents
 */
export function resolveTriageNeedsPm(triage, requirement, hasPmAgents) {
  if (!hasPmAgents) return false;
  const text = String(requirement ?? "").trim();
  if (!text) return false;
  if (TRIAGE_SKIP_PM_PATTERNS.some((re) => re.test(text))) return false;
  if (TRIAGE_DEV_FEATURE_PATTERNS.some((re) => re.test(text))) return true;
  if (triage?.needsPmResearch) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {{ summary: string; needsPmResearch: boolean; planNotes: string } | null}
 */
export function parseTriageFromResponse(text) {
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
        summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
        needsPmResearch: Boolean(parsed.needsPmResearch),
        planNotes: typeof parsed.planNotes === "string" ? parsed.planNotes.trim() : "",
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * @param {string} requirement
 * @param {import("./agents.js").LobsterAgent} pm
 * @returns {string}
 */
export function buildPmResearchPrompt(requirement, pm, teamRoster = "") {
  const domain = (pm.orchestrationDomain || pm.description || "").trim();
  return [
    "You are a product manager on a multi-agent team. Research this feature request and assess feasibility from your specialty.",
    domain ? `Your focus area: ${domain}` : "",
    teamRoster ? `\n## Team colleagues (orchestration)\n${teamRoster}` : "",
    "",
    "## User requirement",
    requirement.trim(),
    "",
    "Respond in markdown with:",
    "1. Key user stories / scope",
    "2. Technical risks and dependencies",
    "3. Feasibility verdict (feasible / feasible-with-caveats / not-feasible) and why",
    "4. Suggested task breakdown for engineering",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {string} requirement
 * @param {Array<{ agent: import("./agents.js").LobsterAgent; output: string }>} pmResults
 * @returns {string}
 */
export function buildPlanSynthesisPrompt(requirement, pmResults, teamRoster = "", planNotes = "") {
  const blocks = pmResults.map(
    ({ agent, output }) => `### ${agent.name || agent.gatewayAgentId}\n${output.trim()}`,
  );
  return [
    "You are the lead orchestrator. Produce a single development plan for user approval.",
    teamRoster ? "\n## Available team (use ownerRole only — do not assign specific agent ids)\n" + teamRoster : "",
    "",
    "## User requirement",
    requirement.trim(),
    planNotes ? `\n## Orchestration notes\n${planNotes}` : "",
    blocks.length ? `\n## PM research\n${blocks.join("\n\n")}` : "",
    "",
    "Respond with ONLY a JSON object:",
    "{",
    '  "version": 1,',
    '  "summary": "<one paragraph plan overview>",',
    '  "feasibility": "<overall feasibility summary>",',
    '  "tasks": [{',
    '    "id": "t1",',
    '    "title": "Phase 1: <short deliverable>",',
    '    "description": "<what to deliver>",',
    '    "ownerRole": "fe|be|pm|reviewer",',
    '    "domain": "<optional module>",',
    '    "phase": "development|review",',
    '    "status": "todo",',
    '    "dependsOn": []',
    "  }]",
    "}",
    "",
    `STRICT: use at most ${MAX_ORCHESTRATION_PHASES} distinct phase numbers (Phase 1 … Phase ${MAX_ORCHESTRATION_PHASES}).`,
    "Do NOT set ownerAgentId. Set ownerRole only — idle teammates with matching roles are assigned at runtime.",
    "Multiple tasks MAY share the same phase number when they can run in parallel.",
    "Use dependsOn ONLY for real blockers (e.g. UI depends on API). Tasks with empty dependsOn run concurrently when ready.",
    "Balance work across roles; any idle agent with a matching role may pick up ready tasks without waiting.",
    "Include review tasks (ownerRole reviewer) after their development deliverable via dependsOn.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {OrchestrationTask} task
 * @param {string} requirement
 * @param {OrchestrationPlan} plan
 * @returns {string}
 */
export function buildDevTaskPrompt(task, requirement, plan, teamRoster = "") {
  const deps = plan.tasks
    .filter((t) => task.dependsOn.includes(t.id) && t.output)
    .map((t) => `### ${t.title}\n${t.output}`)
    .join("\n\n");
  const peerTasks = plan.tasks
    .filter((t) => t.id !== task.id && t.status !== "done" && t.ownerRole && t.ownerRole === task.ownerRole)
    .map((t) => `- **${t.title}** (${t.ownerRole})`)
    .join("\n");
  return [
    `You are executing task: **${task.title}**`,
    task.description ? task.description : "",
    teamRoster ? `\n## Team colleagues\n${teamRoster}` : "",
    peerTasks ? `\n## Other assigned tasks (do not duplicate their work)\n${peerTasks}` : "",
    "",
    "## Original requirement",
    requirement.trim(),
    "",
    deps ? `## Completed dependencies\n${deps}` : "",
    "",
    "Deliver your work summary: what you built/changed, files touched, how to verify. Be concrete.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {OrchestrationTask} devTask
 * @param {string} devOutput
 * @returns {string}
 */
export function buildReviewPrompt(devTask, devOutput) {
  return [
    "You are a code reviewer. Review the developer's deliverable before it can be marked complete.",
    "",
    `## Task: ${devTask.title}`,
    devTask.description || "",
    "",
    "## Developer deliverable",
    devOutput.trim(),
    "",
    "Inspect code quality, correctness, and alignment with the task. If you have tools to read files or run git diff, use them.",
    "",
    "Respond with ONLY JSON:",
    '{ "approved": true|false, "findings": ["<issue or praise>"] }',
  ].join("\n");
}

/**
 * @param {string} requirement
 * @param {OrchestrationPlan} plan
 * @returns {string}
 */
export function buildRollupPrompt(requirement, plan) {
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

/**
 * @param {import("./agents.js").LobsterAgent[]} agents
 * @param {string | null | undefined} agentId
 * @returns {import("./agents.js").LobsterAgent | null}
 */
export function agentByIdOrRole(agents, agentId, role, opts = {}) {
  if (agentId) {
    const hit = agents.find((a) => a.id === agentId);
    if (hit) return hit;
  }
  const pool = agentsByOrchestrationRole(agents, role, opts);
  return pool[0] ?? null;
}
