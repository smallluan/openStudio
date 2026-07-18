/**
 * Lightweight unit tests for preview-guest-debugger (no Electron guest).
 * Run: node --test lib/preview-guest-debugger.test.cjs
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const debuggerTool = require("./preview-guest-debugger.cjs");
const capture = require("./preview-guest-capture.cjs");

describe("preview-guest-debugger", () => {
  beforeEach(() => {
    debuggerTool.resetDebuggerState();
  });

  it("status works without guest", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "status" });
    assert.equal(r.ok, true);
    assert.equal(r.sessionActive, false);
    assert.equal(r.scriptCount, 0);
    assert.equal(r.breakpointCount, 0);
    assert.equal(r.paused, false);
  });

  it("enable without guest fails cleanly", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "enable" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });

  it("search without guest fails cleanly", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "search", text: "error" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });

  it("unknown op is rejected", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_op");
  });

  it("wait_paused without guest times out", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "wait_paused", timeoutMs: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.paused, false);
    assert.equal(r.reason, "timeout");
  });

  it("inspect without guest fails cleanly", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "inspect" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_guest");
  });

  it("disable succeeds without guest", async () => {
    const r = await debuggerTool.handleSidebarDebugger({ op: "disable" });
    assert.equal(r.ok, true);
    assert.equal(r.sessionActive, false);
  });

  it("capture status still works alongside debugger module", async () => {
    const r = await capture.handleSidebarDebug({ op: "status" });
    assert.equal(r.ok, true);
  });

  it("findColumnsInLine finds Chinese substring columns", () => {
    const needle = "请联系管理员为此交易类型分配至少一个费用项目";
    const line = `foo("${needle}"),"error");bar("${needle}")`;
    const cols = debuggerTool._test.findColumnsInLine(line, needle, true);
    assert.equal(cols.length, 2);
    assert.equal(cols[0], line.indexOf(needle));
    assert.equal(cols[1], line.indexOf(needle, cols[0] + 1));
  });

  it("findTextMatchesInSource finds match beyond typical snippet size", () => {
    const needle = "请联系管理员为此交易类型分配至少一个费用项目";
    const source = `${"x".repeat(600_000)}${needle}tail`;
    const locs = debuggerTool._test.findTextMatchesInSource(source, needle, true);
    assert.equal(locs.length, 1);
    assert.equal(locs[0].line, 0);
    assert.equal(locs[0].column, 600_000);
  });

  it("scriptUrlRank prefers .js over lang packs", () => {
    assert.equal(debuggerTool._test.scriptUrlRank("https://cdn.example/extend.258.min.js"), 0);
    assert.ok(
      debuggerTool._test.scriptUrlRank("https://cdn.example/i18n/zh_CN.js") >
        debuggerTool._test.scriptUrlRank("https://cdn.example/extend.258.min.js"),
    );
  });

  it("isLangPackUrl detects zh_CN locale chunks", () => {
    assert.equal(
      debuggerTool._test.isLangPackUrl(
        "https://mlrc-cdn.example/location/ys/YS_ZNBZ_BZBX-FE-zh_CN-zh_CN-qyic8c7o-v2.js",
      ),
      true,
    );
    assert.equal(
      debuggerTool._test.isLangPackUrl(
        "https://static.example/static/mdf/znbzbx/latest/javascripts/extend.258.66078758.min.js",
      ),
      false,
    );
  });
});
