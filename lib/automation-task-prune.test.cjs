const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAutomationTaskPruneKeepIds } = require("./automation-task-prune.cjs");

test("buildAutomationTaskPruneKeepIds keeps paused tasks missing from gateway list", () => {
  const keepIds = buildAutomationTaskPruneKeepIds(
    ["active-job"],
    [
      { cronJobId: "active-job", enabled: true },
      { cronJobId: "paused-job", enabled: false },
    ],
    (id) => id.startsWith("studio:"),
  );

  assert.deepEqual([...keepIds].sort(), ["active-job", "paused-job"]);
});

test("buildAutomationTaskPruneKeepIds keeps studio-only task ids", () => {
  const keepIds = buildAutomationTaskPruneKeepIds(
    [],
    [{ cronJobId: "studio:abc", enabled: true }],
    (id) => id.startsWith("studio:"),
  );

  assert.deepEqual([...keepIds], ["studio:abc"]);
});
