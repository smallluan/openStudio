"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizePlanForPool,
  resolveTaskOwner,
  parseTriageFromResponse,
  parsePlanFromResponse,
  assignTaskOwners,
  normalizeOrchestrationTask,
  orchestrationAssignOpts,
} = require("./core.cjs");
const { OrchestrationRole } = require("./roles.cjs");

const agents = [
  { id: "main-1", name: "Lead", gatewayAgentId: "main", isMain: true, orchestrationRole: "" },
  { id: "writer-1", name: "文案助手", description: "营销文案撰写", gatewayAgentId: "writer", orchestrationRole: "" },
  { id: "outsider", name: "Outside", gatewayAgentId: "out", orchestrationRole: "" },
];

const poolOpts = orchestrationAssignOpts(agents, {
  mainAgent: agents[0],
  participantIds: ["writer-1"],
});

describe("sanitizePlanForPool", () => {
  it("strips ownerAgentId outside participant pool", () => {
    const plan = {
      version: 1,
      summary: "test",
      tasks: [
        normalizeOrchestrationTask({
          id: "t1",
          title: "Phase 1: Write copy",
          ownerAgentId: "outsider",
          status: "todo",
        }),
      ],
    };
    const { plan: sanitized } = sanitizePlanForPool(plan, poolOpts.participantIds);
    assert.equal(sanitized.tasks[0].ownerAgentId, null);
    assert.equal(sanitized.tasks[0].status, "blocked");
  });

  it("keeps valid ownerAgentId in pool", () => {
    const plan = {
      version: 1,
      summary: "test",
      tasks: [
        normalizeOrchestrationTask({
          id: "t1",
          title: "Phase 1: Write copy",
          ownerAgentId: "writer-1",
          status: "todo",
        }),
      ],
    };
    const { plan: sanitized } = sanitizePlanForPool(plan, poolOpts.participantIds);
    assert.equal(sanitized.tasks[0].ownerAgentId, "writer-1");
    assert.equal(sanitized.tasks[0].status, "todo");
  });
});

describe("resolveTaskOwner", () => {
  it("prefers explicit ownerAgentId when in pool", () => {
    const task = normalizeOrchestrationTask({
      id: "t1",
      title: "文案",
      ownerAgentId: "writer-1",
      status: "todo",
    });
    const owner = resolveTaskOwner(task, agents, poolOpts, new Set(), new Map());
    assert.equal(owner?.id, "writer-1");
  });

  it("does not pick agents outside pool", () => {
    const task = normalizeOrchestrationTask({
      id: "t1",
      title: "文案",
      ownerAgentId: "outsider",
      status: "todo",
    });
    const owner = resolveTaskOwner(task, agents, poolOpts, new Set(), new Map());
    assert.notEqual(owner?.id, "outsider");
  });
});

describe("parseTriageFromResponse", () => {
  it("parses dynamic preTasks without forcing PM", () => {
    const triage = parseTriageFromResponse(
      JSON.stringify({
        scenarioSummary: "营销文案",
        requiresApproval: true,
        preTasks: [{ agentId: "writer-1", brief: "调研竞品文案" }],
        planNotes: "先调研再撰写",
      }),
    );
    assert.equal(triage?.scenarioSummary, "营销文案");
    assert.equal(triage?.preTasks.length, 1);
    assert.equal(triage?.preTasks[0].agentId, "writer-1");
  });
});

describe("parsePlanFromResponse", () => {
  it("parses JSON in markdown fence with trailing commas", () => {
    const plan = parsePlanFromResponse(
      'Here is the plan:\n```json\n{"version":1,"summary":"Gesture VR site","tasks":[{"id":"t1","title":"Phase 1: Research","ownerAgentId":"writer-1","status":"todo","dependsOn":[]},]}\n```',
    );
    assert.equal(plan?.summary, "Gesture VR site");
    assert.equal(plan?.tasks.length, 1);
  });

  it("accepts tasks without summary field", () => {
    const plan = parsePlanFromResponse(
      JSON.stringify({
        version: 1,
        tasks: [{ id: "t1", title: "Phase 1: Build MVP", ownerAgentId: "writer-1", status: "todo" }],
      }),
    );
    assert.ok(plan?.summary.includes("Phase 1"));
    assert.equal(plan?.tasks.length, 1);
  });
});

describe("assignTaskOwners", () => {
  it("sanitizes plan against participant pool", () => {
    const plan = {
      version: 1,
      summary: "plan",
      tasks: [
        normalizeOrchestrationTask({
          id: "t1",
          title: "Phase 1: Task",
          ownerAgentId: "outsider",
          ownerRole: OrchestrationRole.FE,
          status: "todo",
        }),
      ],
    };
    const next = assignTaskOwners(plan, agents, poolOpts);
    assert.equal(next.tasks[0].ownerAgentId, null);
  });
});
