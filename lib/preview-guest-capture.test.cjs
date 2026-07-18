/**
 * Lightweight unit tests for preview-guest-capture helpers (no Electron guest).
 * Run: node --test lib/preview-guest-capture.test.cjs
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// Re-require a fresh module state is hard; test via public handleSidebarDebug ops
// that don't need a guest (status/clear/catalog/fetch on empty buffers).
const capture = require("./preview-guest-capture.cjs");

describe("preview-guest-capture", () => {
  beforeEach(async () => {
    await capture.handleSidebarDebug({ op: "clear" });
    await capture.handleSidebarDebug({ op: "stop" });
  });

  it("status works without guest", async () => {
    const r = await capture.handleSidebarDebug({ op: "status" });
    assert.equal(r.ok, true);
    assert.equal(r.recording.active, false);
    assert.equal(r.recording.consoleCount, 0);
    assert.equal(r.recording.networkCount, 0);
  });

  it("start without guest fails cleanly", async () => {
    const r = await capture.handleSidebarDebug({ op: "start" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });

  it("screenshot without guest fails cleanly", async () => {
    const r = await capture.handleSidebarScreenshot({});
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });

  it("catalog on empty buffers returns empty lists", async () => {
    const r = await capture.handleSidebarDebug({ op: "catalog" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.logCatalog, []);
    assert.deepEqual(r.networkCatalog, []);
  });

  it("fetch with no matches returns no_matches", async () => {
    const r = await capture.handleSidebarDebug({
      op: "fetch",
      networkIds: ["req_999"],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_matches");
  });

  it("unknown op is rejected", async () => {
    const r = await capture.handleSidebarDebug({ op: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_op");
  });

  it("reload without guest fails cleanly", async () => {
    const r = await capture.handleSidebarDebug({ op: "reload" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });

  it("start with reload without guest fails cleanly", async () => {
    const r = await capture.handleSidebarDebug({ op: "start", reload: true });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });
});
