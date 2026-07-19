const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveSubagentRowsFromToolTrace,
  coalesceSubagentActivityRows,
  toolTraceAwaitsSubagent,
} = require("../src/chat/toolTraceMerge.js");

test("deriveSubagentRows shows two cards from tasks[] args while spawn is in-flight", () => {
  const rows = deriveSubagentRowsFromToolTrace(
    [
      {
        id: "spawn-1",
        toolName: "sessions_spawn",
        phase: "start",
        done: false,
        args: {
          tasks: [
            { task: "Analyze frontend", taskName: "analyze-frontend" },
            { task: "Analyze backend", taskName: "analyze-backend" },
          ],
        },
      },
    ],
    { streaming: true },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "analyze-frontend");
  assert.equal(rows[1].title, "analyze-backend");
  assert.equal(rows[0].workerStreaming, true);
  assert.equal(rows[1].workerStreaming, true);
});

test("deriveSubagentRows expands tasks[] hard-barrier results into multiple cards", () => {
  const rows = deriveSubagentRowsFromToolTrace(
    [
      {
        id: "spawn-1",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        args: {
          tasks: [
            { task: "Analyze frontend", taskName: "analyze-frontend" },
            { task: "Analyze backend", taskName: "analyze-backend" },
          ],
        },
        result: JSON.stringify({
          status: "completed",
          results: [
            { runId: "child-fe", label: "analyze-frontend", task: "Analyze frontend", status: "completed", result: "fe" },
            { runId: "child-be", label: "analyze-backend", task: "Analyze backend", status: "completed", result: "be" },
          ],
        }),
      },
    ],
    { streaming: false },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "analyze-frontend");
  assert.equal(rows[1].title, "analyze-backend");
  assert.equal(rows[0].workerStreaming, false);
  assert.equal(rows[1].workerStreaming, false);
});

test("deriveSubagentRows keeps accepted detach spawns active until yield settles", () => {
  const rows = deriveSubagentRowsFromToolTrace(
    [
      {
        id: "spawn-1",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        args: { task: "Analyze frontend", taskName: "frontend-analysis", awaitResult: false },
        result: JSON.stringify({
          status: "accepted",
          runId: "child-fe",
          childSessionKey: "agent:main:subagent:fe",
        }),
      },
      {
        id: "spawn-2",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        args: { task: "Analyze backend", taskName: "backend-analysis", awaitResult: false },
        result: JSON.stringify({
          status: "accepted",
          runId: "child-be",
          childSessionKey: "agent:main:subagent:be",
        }),
      },
    ],
    { streaming: true },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].workerStreaming, true);
  assert.equal(rows[1].workerStreaming, true);
});

test("coalesce does not overwrite frontend progress with backend activity", () => {
  const fromTools = deriveSubagentRowsFromToolTrace(
    [
      {
        id: "spawn-1",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        args: { task: "fe", taskName: "frontend-analysis" },
        result: JSON.stringify({ status: "accepted", runId: "child-fe" }),
      },
      {
        id: "spawn-2",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        args: { task: "be", taskName: "backend-analysis" },
        result: JSON.stringify({ status: "accepted", runId: "child-be" }),
      },
    ],
    { streaming: true },
  );
  const fromLog = [
    {
      id: "subagent:child-fe",
      stream: "subagent",
      title: "frontend-analysis",
      text: "reading urpBuilder/package.json",
      subagentRunId: "child-fe",
      workerStreaming: true,
      seq: 1,
    },
    {
      id: "subagent:child-be",
      stream: "subagent",
      title: "backend-analysis",
      text: 'exec dir /s /b "...\\urpBuilder-backend"',
      subagentRunId: "child-be",
      workerStreaming: true,
      seq: 2,
    },
  ];
  const rows = coalesceSubagentActivityRows(fromLog, fromTools, { streaming: true });
  assert.equal(rows.length, 2);
  assert.match(String(rows[0].text), /urpBuilder\/package|frontend|reading/i);
  assert.match(String(rows[1].text), /urpBuilder-backend|backend|exec/i);
  assert.ok(!String(rows[0].text).includes("urpBuilder-backend"));
});

test("tasks[] cards settle independently when one child activity ends", () => {
  const fromTools = deriveSubagentRowsFromToolTrace(
    [
      {
        id: "spawn-batch",
        toolName: "sessions_spawn",
        phase: "start",
        done: false,
        args: {
          tasks: [
            { task: "Analyze frontend", taskName: "analyze-frontend" },
            { task: "Analyze backend", taskName: "analyze-backend" },
          ],
        },
      },
    ],
    { streaming: true },
  );
  const rows = coalesceSubagentActivityRows(
    [
      {
        id: "subagent:fe",
        stream: "subagent",
        title: "analyze-frontend",
        text: "frontend report ready",
        workerStreaming: false,
        phase: "end",
        seq: 1,
      },
      {
        id: "subagent:be",
        stream: "subagent",
        title: "analyze-backend",
        text: 'exec dir "urpBuilder-backend"',
        workerStreaming: true,
        phase: "running",
        seq: 2,
      },
    ],
    fromTools,
    { streaming: true },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].workerStreaming, false);
  assert.equal(rows[0].phase, "end");
  assert.equal(rows[1].workerStreaming, true);
});

test("tasks[] in-flight cards do not share one child's progress line", () => {
  const fromTools = deriveSubagentRowsFromToolTrace(
    [
      {
        id: "spawn-batch",
        toolName: "sessions_spawn",
        phase: "start",
        done: false,
        summary: "read from D:\\x\\urpBuilder-backend\\package.json",
        args: {
          tasks: [
            { task: "Analyze frontend at urpBuilder", taskName: "analyze-frontend" },
            { task: "Analyze backend at urpBuilder-backend", taskName: "analyze-backend" },
          ],
        },
      },
    ],
    { streaming: true },
  );
  assert.equal(fromTools.length, 2);
  assert.equal(fromTools[0].text, "");
  assert.equal(fromTools[1].text, "");

  const rows = coalesceSubagentActivityRows(
    [
      {
        id: "subagent:fe",
        stream: "subagent",
        title: "analyze-frontend",
        text: "read from D:\\x\\urpBuilder\\package.json",
        workerStreaming: true,
        seq: 1,
      },
      {
        id: "subagent:be",
        stream: "subagent",
        title: "analyze-backend",
        text: "read from D:\\x\\urpBuilder-backend\\package.json",
        workerStreaming: true,
        seq: 2,
      },
    ],
    fromTools,
    { streaming: true },
  );
  assert.equal(rows.length, 2);
  assert.match(String(rows[0].text), /urpBuilder\\package|urpBuilder\/package/i);
  assert.ok(!String(rows[0].text).includes("urpBuilder-backend"));
  assert.match(String(rows[1].text), /urpBuilder-backend/i);
});

test("toolTraceAwaitsSubagent stays true for accepted spawns before yield", () => {
  assert.equal(
    toolTraceAwaitsSubagent([
      {
        id: "spawn-1",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        result: JSON.stringify({ status: "accepted", runId: "child-fe" }),
      },
    ]),
    true,
  );
  assert.equal(
    toolTraceAwaitsSubagent([
      {
        id: "spawn-1",
        toolName: "sessions_spawn",
        phase: "end",
        done: true,
        result: JSON.stringify({ status: "accepted", runId: "child-fe" }),
      },
      {
        id: "yield-1",
        toolName: "sessions_yield",
        phase: "end",
        done: true,
        result: JSON.stringify({
          status: "completed",
          results: [{ runId: "child-fe", status: "completed", result: "ok" }],
        }),
      },
    ]),
    false,
  );
});
