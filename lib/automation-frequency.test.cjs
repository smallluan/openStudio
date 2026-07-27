const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cronJobNeedsOpenStudioDeliveryRepair,
  inferAutomationChannelFromCronDelivery,
  isGatewayChannelDeliveryError,
  openStudioTaskNeedsChannelErrorReset,
  stripOpenStudioChannelDeliveryErrors,
} = require("./automation-channel.cjs");
const { resolveAutomationFrequencyFields } = require("./automation-frequency.cjs");

test("inferAutomationChannelFromCronDelivery maps unsupported external channels to open-studio", () => {
  assert.equal(
    inferAutomationChannelFromCronDelivery({
      delivery: { mode: "announce", channel: "qqbot" },
    }),
    "open-studio",
  );
  assert.equal(
    inferAutomationChannelFromCronDelivery({
      delivery: { mode: "none" },
    }),
    "open-studio",
  );
});

test("cronJobNeedsOpenStudioDeliveryRepair detects announce delivery on open-studio tasks", () => {
  assert.equal(
    cronJobNeedsOpenStudioDeliveryRepair("open-studio", {
      delivery: { mode: "announce", channel: "qqbot" },
    }),
    true,
  );
  assert.equal(
    cronJobNeedsOpenStudioDeliveryRepair("open-studio", {
      delivery: { mode: "none" },
    }),
    false,
  );
  assert.equal(
    cronJobNeedsOpenStudioDeliveryRepair("wechat", {
      delivery: { mode: "announce", channel: "wechat" },
    }),
    false,
  );
});

test("openStudioTaskNeedsChannelErrorReset clears stale channel errors after delivery is none", () => {
  assert.equal(
    openStudioTaskNeedsChannelErrorReset(
      "open-studio",
      {
        delivery: { mode: "none" },
        state: {
          lastDiagnosticSummary:
            "Channel is required (no available channels detected). Configured official external channel QQ Bot is missing its plugin.",
        },
      },
      {},
    ),
    true,
  );
});

test("stripOpenStudioChannelDeliveryErrors removes persisted qqbot delivery errors", () => {
  const next = stripOpenStudioChannelDeliveryErrors({
    lastRunStatus: "error",
    lastError: "Channel is required (no available channels detected).",
    lastDiagnosticSummary: "Configured official external channel QQ Bot is missing its plugin.",
  });
  assert.equal(next.lastError, "");
  assert.equal(next.lastDiagnosticSummary, "");
  assert.equal(next.lastRunStatus, "ok");
  assert.equal(isGatewayChannelDeliveryError("Configured official external channel QQ Bot"), true);
});

test("resolveAutomationFrequencyFields infers interval schedule from cron job", () => {
  const frequency = resolveAutomationFrequencyFields({}, { kind: "every", everyMs: 3_600_000 });
  assert.equal(frequency.frequencyMode, "interval");
  assert.equal(frequency.intervalValue, 1);
  assert.equal(frequency.intervalUnit, "hour");
});
