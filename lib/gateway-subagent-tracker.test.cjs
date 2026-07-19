const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createGatewaySubagentTracker,
  isSpawnToolName,
  isYieldToolName,
  readSpawnRegistration,
} = require("./gateway-subagent-tracker.cjs");

test("isSpawnToolName recognizes sessions_spawn", () => {
  assert.equal(isSpawnToolName("sessions_spawn"), true);
  assert.equal(isSpawnToolName("sidebar_action"), false);
});

test("isYieldToolName recognizes sessions_yield", () => {
  assert.equal(isYieldToolName("sessions_yield"), true);
  assert.equal(isYieldToolName("sessions_spawn"), false);
});

test("readSpawnRegistration parses accepted child", () => {
  const reg = readSpawnRegistration({
    status: "accepted",
    runId: "child-1",
    task: "Review the auth module",
    childSessionKey: "agent:main:subagent:abc",
  });
  assert.ok(reg);
  assert.equal(reg.runId, "child-1");
  assert.match(reg.label, /Review/);
});

test("tracker holds stream until children complete", () => {
  const tracker = createGatewaySubagentTracker({ parentRunId: "parent-1", postCompletionGraceMs: 0 });
  tracker.registerChild({ runId: "child-1", label: "Worker", task: "scan repo" });
  tracker.markParentFinal();
  assert.equal(tracker.shouldHoldStreamOpen(), true);
  tracker.noteAgentPayload({
    runId: "child-1",
    stream: "lifecycle",
    data: { phase: "end" },
  });
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.canFinishStream(), true);
});

test("tracker accepts child run events without parent session key", () => {
  const tracker = createGatewaySubagentTracker({ parentRunId: "parent-1" });
  tracker.registerChild({ runId: "child-1", label: "Worker", task: "" });
  assert.equal(tracker.acceptsRunId("child-1", "parent-1"), true);
  assert.equal(tracker.acceptsRunId("other-run", "parent-1"), false);
});

test("noteToolTrace registers child from sessions_spawn result", () => {
  const tracker = createGatewaySubagentTracker({ parentRunId: "parent-1" });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    result: JSON.stringify({
      status: "accepted",
      runId: "child-2",
      task: "Investigate logs",
    }),
  });
  assert.equal(tracker.isTrackedChildRun("child-2"), true);
});

test("sessions_yield alone keeps stream open after parent final", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
    yieldHoldMs: 60_000,
  });
  tracker.noteToolTrace({
    toolName: "sessions_yield",
    phase: "end",
    summary: "等待项目总结子智能体完成...",
    result: JSON.stringify({ status: "yielded", message: "Turn yielded." }),
  });
  tracker.markParentFinal();
  assert.equal(tracker.shouldHoldStreamOpen(), true);
  assert.equal(tracker.yieldPending, true);
  assert.equal(tracker.hasActiveChildren(), true);
});

test("failed sessions_yield does not keep stream open", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
    yieldHoldMs: 60_000,
  });
  tracker.noteToolTrace({
    toolName: "sessions_yield",
    phase: "end",
    status: "error",
    result: JSON.stringify({
      status: "error",
      error: "sessions_yield is disabled in Open Studio",
    }),
  });
  tracker.markParentFinal();
  assert.equal(tracker.yieldPending, false);
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.shouldHoldStreamOpen(), false);
  assert.equal(tracker.canFinishStream(), true);
});

test("child tool/chat progress does not require parent tool_trace", () => {
  const tracker = createGatewaySubagentTracker({ parentRunId: "parent-1" });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-1",
    phase: "start",
    args: { task: "Analyze", taskName: "analyze-project" },
  });
  assert.equal(tracker.tryClaimChildRun("child-9", "parent-1"), true);
  tracker.noteChildToolProgress("child-9", {
    toolName: "read",
    label: "Reading package.json",
    phase: "start",
  });
  const snap = tracker.buildSubagentActivityPayload("child-9");
  assert.equal(snap?.progressText, "Reading package.json");
  assert.equal(snap?.workerStreaming, true);
  tracker.noteChildChatProgress("child-9", "Let me start.\nChecking src next");
  assert.equal(tracker.buildSubagentActivityPayload("child-9")?.progressText, "Checking src next");
});

test("mid-turn spawn claims child runId before tool result", () => {
  const tracker = createGatewaySubagentTracker({ parentRunId: "parent-1" });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-spawn",
    phase: "start",
    args: { task: "Summarize repo", label: "Summarizer" },
  });
  assert.equal(tracker.tryClaimChildRun("child-live-1", "parent-1"), true);
  assert.equal(tracker.isKnownChildRun("child-live-1"), true);
  assert.equal(tracker.tryClaimChildRun("unrelated", "parent-1"), false);
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-spawn",
    phase: "end",
    result: JSON.stringify({
      status: "completed",
      runId: "child-live-1",
      result: "done",
    }),
  });
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.acceptsRunId("later-run", "parent-1"), false);
});

test("terminal sessions_spawn without parsable result clears pending child", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-raw",
    phase: "start",
    args: { task: "Analyze project", taskName: "project-analysis" },
  });
  assert.equal(tracker.hasActiveChildren(), true);
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-raw",
    phase: "end",
    status: "completed",
    summary: "done",
    // no result JSON -> fallback path must close pending:tc-raw
  });
  tracker.markParentFinal();
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.canFinishStream(), true);
});

test("continuation after yield allows finish on second final", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
    yieldHoldMs: 60_000,
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-1",
    phase: "start",
    args: { task: "Analyze repo", label: "Analyzer" },
  });
  tracker.noteToolTrace({
    toolName: "sessions_yield",
    phase: "end",
    result: JSON.stringify({ status: "yielded" }),
  });
  tracker.markParentFinal();
  assert.equal(tracker.shouldHoldStreamOpen(), true);

  // Steered continuation on a new run id
  assert.equal(tracker.acceptsRunId("parent-cont-2", "parent-1"), true);
  tracker.noteContinuationActivity();
  tracker.markParentFinal();
  assert.equal(tracker.canFinishStream(), true);
  assert.equal(tracker.shouldHoldStreamOpen(), false);
});

test("late accepted spawn result does not resurrect completed child", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-done",
    phase: "start",
    args: { task: "Analyze", label: "Analyzer" },
  });
  assert.equal(
    tracker.tryClaimChildRun("child-done-1", "parent-1", {
      sessionKey: "agent:main:subagent:xyz",
      parentSessionKey: "agent:main:studio:conv",
    }),
    true,
  );
  tracker.noteAgentPayload({
    runId: "child-done-1",
    stream: "lifecycle",
    data: { phase: "end" },
  });
  assert.equal(tracker.hasActiveChildren(), false);

  // Late duplicate "accepted" must not reopen the child (keeps parent stream stuck).
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-done",
    phase: "update",
    result: JSON.stringify({
      status: "accepted",
      runId: "child-done-1",
      task: "Analyze",
    }),
  });
  tracker.markParentFinal();
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.canFinishStream(), true);
});

test("late non-terminal spawn update does not recreate pending ghost", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-ghost",
    phase: "start",
    args: { task: "Scan", label: "Scanner" },
  });
  tracker.tryClaimChildRun("child-ghost-1", "parent-1", {
    sessionKey: "agent:main:subagent:g1",
    parentSessionKey: "agent:main:studio:conv",
  });
  tracker.noteAgentPayload({
    runId: "child-ghost-1",
    stream: "lifecycle",
    data: { phase: "end" },
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-ghost",
    phase: "update",
    args: { task: "Scan", label: "Scanner" },
    // no result — previously recreated pending:tc-ghost as active
  });
  tracker.markParentFinal();
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.canFinishStream(), true);
});

test("tryClaimChildRun ignores unrelated sessions when parentSessionKey is set", () => {
  const tracker = createGatewaySubagentTracker({ parentRunId: "parent-1" });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-claim",
    phase: "start",
    args: { task: "Work", label: "Worker" },
  });
  assert.equal(
    tracker.tryClaimChildRun("unrelated-run", "parent-1", {
      sessionKey: "agent:main:studio:other-conv",
      parentSessionKey: "agent:main:studio:conv",
    }),
    false,
  );
  assert.equal(
    tracker.tryClaimChildRun("child-real", "parent-1", {
      sessionKey: "agent:main:subagent:real",
      parentSessionKey: "agent:main:studio:conv",
    }),
    true,
  );
  assert.equal(tracker.isKnownChildRun("child-real"), true);
});

test("await-spawn completed tool result finishes after parent final", () => {
  const tracker = createGatewaySubagentTracker({
    parentRunId: "parent-1",
    postCompletionGraceMs: 0,
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-await",
    phase: "start",
    args: { task: "Analyze project", taskName: "project-analysis" },
  });
  tracker.tryClaimChildRun("child-await-1", "parent-1", {
    sessionKey: "agent:main:subagent:await1",
    parentSessionKey: "agent:main:studio:conv",
  });
  tracker.noteAgentPayload({
    runId: "child-await-1",
    stream: "lifecycle",
    data: { phase: "end" },
  });
  tracker.noteToolTrace({
    toolName: "sessions_spawn",
    toolCallId: "tc-await",
    phase: "end",
    status: "completed",
    result: JSON.stringify({
      status: "completed",
      runId: "child-await-1",
      result: "ok",
    }),
  });
  tracker.markParentFinal();
  assert.equal(tracker.hasActiveChildren(), false);
  assert.equal(tracker.canFinishStream(), true);
  assert.equal(tracker.shouldHoldStreamOpen(), false);
});
