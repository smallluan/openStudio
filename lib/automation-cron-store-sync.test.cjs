const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAutomationTasksStore } = require("./automation-tasks-store.cjs");
const {
  shouldImportCronJobToAutomationStore,
  cronJobToAutomationStoreRow,
  inferAutomationChannelFromCronJob,
  syncGatewayCronJobsToAutomationStore,
} = require("./automation-cron-store-sync.cjs");

/** @param {string} prefix */
function tempUserData(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("shouldImportCronJobToAutomationStore accepts agentTurn jobs with message", () => {
  assert.equal(
    shouldImportCronJobToAutomationStore({
      id: "job-1",
      payload: { kind: "agentTurn", message: "该喝水了" },
    }),
    true,
  );
  assert.equal(
    shouldImportCronJobToAutomationStore({
      id: "job-2",
      payload: { kind: "agentTurn", message: "   " },
    }),
    false,
  );
});

test("inferAutomationChannelFromCronJob maps wechat delivery", () => {
  assert.equal(
    inferAutomationChannelFromCronJob({
      delivery: { mode: "announce", channel: "wechat" },
    }),
    "wechat",
  );
  assert.equal(
    inferAutomationChannelFromCronJob({
      delivery: { mode: "none" },
    }),
    "open-studio",
  );
  assert.equal(
    inferAutomationChannelFromCronJob({
      delivery: { mode: "announce", channel: "qqbot" },
    }),
    "open-studio",
  );
});

test("syncGatewayCronJobsToAutomationStore imports orphan gateway cron jobs", () => {
  const store = createAutomationTasksStore(tempUserData("os-cron-sync-"));
  const cfg = /** @type {import("./config-store.cjs").UserConfig} */ ({
    activeModelProfileId: "profile-1",
    modelProfiles: [{ id: "profile-1", modelId: "gpt-4", enabled: true }],
  });

  store.upsert({
    cronJobId: "existing-1",
    name: "手动任务",
    prompt: "hello",
    message: "hello",
    channel: "open-studio",
    agentId: "agent-main",
    modelProfileId: "profile-1",
  });

  const result = syncGatewayCronJobsToAutomationStore(cfg, store, [
    {
      id: "existing-1",
      name: "手动任务",
      enabled: true,
      payload: { kind: "agentTurn", message: "hello" },
      schedule: { kind: "every", everyMs: 3_600_000 },
    },
    {
      id: "ai-1",
      name: "喝水提醒",
      enabled: true,
      payload: { kind: "agentTurn", message: "该喝水了" },
      schedule: { kind: "every", everyMs: 300_000 },
      delivery: { mode: "none" },
    },
  ]);

  assert.equal(result.imported, 1);
  assert.equal(result.refreshed, 0);
  assert.equal(store.list().length, 2);

  const imported = store.get("ai-1");
  assert.ok(imported);
  assert.equal(imported.name, "喝水提醒");
  assert.equal(imported.prompt, "该喝水了");
  assert.equal(imported.channel, "open-studio");
  assert.equal(imported.importedFromGateway, true);
  assert.equal(imported.agentId, "agent-main");
  assert.equal(imported.modelProfileId, "profile-1");
  assert.equal(imported.frequencyMode, "interval");
  assert.equal(imported.intervalValue, 5);
  assert.equal(imported.intervalUnit, "minute");
});

test("syncGatewayCronJobsToAutomationStore preserves user pause state", () => {
  const store = createAutomationTasksStore(tempUserData("os-cron-sync-pause-"));
  const cfg = /** @type {import("./config-store.cjs").UserConfig} */ ({
    activeModelProfileId: "profile-1",
    modelProfiles: [{ id: "profile-1", modelId: "gpt-4", enabled: true }],
  });

  store.upsert({
    cronJobId: "ai-1",
    name: "喝水提醒",
    prompt: "该喝水了",
    message: "该喝水了",
    channel: "open-studio",
    enabled: false,
    importedFromGateway: true,
    agentId: "agent-main",
    modelProfileId: "profile-1",
  });

  syncGatewayCronJobsToAutomationStore(cfg, store, [
    {
      id: "ai-1",
      name: "喝水提醒",
      enabled: true,
      payload: { kind: "agentTurn", message: "该喝水了" },
      schedule: { kind: "every", everyMs: 300_000 },
      delivery: { mode: "none" },
    },
  ]);

  assert.equal(store.get("ai-1")?.enabled, false);
});

test("cronJobToAutomationStoreRow falls back to prompt for missing name", () => {
  const cfg = /** @type {import("./config-store.cjs").UserConfig} */ ({
    activeModelProfileId: "profile-1",
    modelProfiles: [{ id: "profile-1", modelId: "gpt-4", enabled: true }],
  });
  const row = cronJobToAutomationStoreRow(cfg, {
    id: "ai-2",
    enabled: true,
    payload: { kind: "agentTurn", message: "检查邮件" },
    schedule: { kind: "cron", expr: "0 9 * * *" },
    delivery: { mode: "none" },
  });
  assert.equal(row.name, "检查邮件");
  assert.equal(row.message, "检查邮件");
  assert.equal(row.agentId, "agent-main");
  assert.equal(row.modelProfileId, "profile-1");
});
