"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

describe("sidebar-action-tool-bridge port fallback", () => {
  /** @type {import("http").Server | null} */
  let blocker = null;
  /** @type {typeof import("./sidebar-action-tool-bridge.cjs")} */
  let bridge;

  before(async () => {
    // Occupy 19112 so the bridge must fall back when NODE_ENV=development.
    process.env.NODE_ENV = "development";
    delete process.env.OPEN_STUDIO_SIDEBAR_TOOL_PORT;
    delete process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL;
    delete process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN;

    blocker = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("busy");
    });
    await new Promise((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(19112, "127.0.0.1", resolve);
    });

    // Fresh require after env is set.
    delete require.cache[require.resolve("./sidebar-action-tool-bridge.cjs")];
    bridge = require("./sidebar-action-tool-bridge.cjs");
  });

  after(async () => {
    try {
      bridge?.stopSidebarActionToolBridge?.();
    } catch {
      /* ignore */
    }
    if (blocker) {
      await new Promise((resolve) => blocker.close(() => resolve(undefined)));
      blocker = null;
    }
  });

  it("binds the next free port when preferred is in use and updates env", async () => {
    const info = await bridge.startSidebarActionToolBridge({
      getMainWindow: () => null,
      log: null,
    });
    assert.equal(info.port, 19113);
    assert.equal(info.url, "http://127.0.0.1:19113");
    assert.equal(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL, "http://127.0.0.1:19113");
    assert.match(String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || ""), /dev/);

    const health = await fetch("http://127.0.0.1:19113/health");
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.port, 19113);
  });
});
