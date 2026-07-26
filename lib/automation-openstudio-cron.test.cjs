const test = require("node:test");
const assert = require("node:assert/strict");
const {
  metaToAutomationDraft,
  storedScheduleFromDraft,
} = require("./automation-openstudio-cron.cjs");

test("metaToAutomationDraft maps studio metadata into cron draft fields", () => {
  const draft = metaToAutomationDraft({
    name: "喝水提醒",
    prompt: "该喝水了",
    modelProfileId: "mp-1",
    channel: "open-studio",
    frequencyMode: "interval",
    intervalValue: 5,
    intervalUnit: "minute",
  });
  assert.equal(draft.name, "喝水提醒");
  assert.equal(draft.prompt, "该喝水了");
  assert.equal(draft.modelId, "mp-1");
  assert.equal(draft.channel, "open-studio");
  assert.equal(draft.frequencyMode, "interval");
  assert.equal(draft.intervalValue, 5);
  assert.equal(draft.intervalUnit, "minute");
});

test("storedScheduleFromDraft seeds every-schedule anchorMs", () => {
  const before = Date.now();
  const schedule = storedScheduleFromDraft({
    frequencyMode: "interval",
    intervalValue: 1,
    intervalUnit: "hour",
  });
  const after = Date.now();
  assert.equal(schedule.kind, "every");
  assert.equal(schedule.everyMs, 60 * 60 * 1000);
  const anchorMs = Number(schedule.anchorMs);
  assert.ok(Number.isFinite(anchorMs));
  assert.ok(anchorMs >= before + schedule.everyMs);
  assert.ok(anchorMs <= after + schedule.everyMs + 5);
});
