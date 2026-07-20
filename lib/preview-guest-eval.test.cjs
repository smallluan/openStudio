/**
 * Lightweight unit tests for preview-guest-eval helpers.
 * Run: node --test lib/preview-guest-eval.test.cjs
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const evalMod = require("./preview-guest-eval.cjs");

describe("preview-guest-eval", () => {
  it("handleSidebarEval requires expression", async () => {
    const r = await evalMod.handleSidebarEval({});
    assert.equal(r.ok, false);
    assert.equal(r.error, "expression_required");
  });
});
