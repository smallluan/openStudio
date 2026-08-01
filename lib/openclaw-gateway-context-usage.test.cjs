"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeGatewaySessionContextUsage } = require("./openclaw-gateway-context-usage.cjs");

test("normalizeGatewaySessionContextUsage maps gateway session row", () => {
  const usage = normalizeGatewaySessionContextUsage({
    totalTokens: 9800,
    contextTokens: 200000,
    inputTokens: 7900,
    outputTokens: 12,
    compactionCheckpointCount: 0,
  });
  assert.ok(usage);
  assert.equal(usage.usedTokens, 9800);
  assert.equal(usage.contextWindow, 200000);
  assert.equal(usage.inputTokens, 7900);
  assert.equal(usage.outputTokens, 12);
  assert.equal(usage.compactionCount, 0);
  assert.ok(Math.abs(usage.frac - 0.049) < 0.001);
});

test("normalizeGatewaySessionContextUsage rejects invalid rows", () => {
  assert.equal(normalizeGatewaySessionContextUsage(null), null);
  assert.equal(normalizeGatewaySessionContextUsage({ totalTokens: 100 }), null);
  assert.equal(normalizeGatewaySessionContextUsage({ contextTokens: 200000 }), null);
});
