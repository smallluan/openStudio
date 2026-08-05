const test = require("node:test");
const assert = require("node:assert/strict");
const { decideStreamFinishAction } = require("./openclaw-gateway-stream.cjs");

test("lifecycle-ready finish waits for chat.final instead of closing immediately", () => {
  assert.equal(
    decideStreamFinishAction({ chatFinalReceived: false, canFinish: true, graceArmed: false }),
    "arm-grace",
  );
  assert.equal(
    decideStreamFinishAction({ chatFinalReceived: false, canFinish: true, graceArmed: true }),
    "wait-grace",
  );
  assert.equal(
    decideStreamFinishAction({ chatFinalReceived: true, canFinish: true, graceArmed: true }),
    "finish-now",
  );
});

test("unsettled children keep the stream open even after chat.final", () => {
  assert.equal(
    decideStreamFinishAction({ chatFinalReceived: true, canFinish: false }),
    "wait-children",
  );
});
