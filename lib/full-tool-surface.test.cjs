"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createConfigStore, CONFIG_VERSION } = require("./config-store.cjs");
const { patchOpenClawGatewayStudioBinding } = require("./sync-openclaw-agent-from-studio.cjs");

test("config migration removes the obsolete lean-plugin setting", () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-studio-config-"));
  fs.writeFileSync(
    path.join(userDataDir, "studio-user-config.json"),
    JSON.stringify({
      version: 8,
      openclaw: {
        gatewayBaseUrl: "http://127.0.0.1:19002",
        sessionKey: "agent:dev:dev",
        chatLabLeanPlugins: true,
      },
    }),
    "utf8",
  );

  const store = createConfigStore(userDataDir);
  const raw = store.readRaw();
  assert.equal(raw.version, CONFIG_VERSION);
  assert.equal(Object.hasOwn(raw.openclaw, "chatLabLeanPlugins"), false);

  const persisted = JSON.parse(fs.readFileSync(store.filePath(), "utf8"));
  assert.equal(Object.hasOwn(persisted.openclaw, "chatLabLeanPlugins"), false);
});

test("dev gateway sync restores the complete plugin surface", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "open-studio-tools-"));
  const stateDir = path.join(root, ".openclaw-dev");
  fs.mkdirSync(stateDir);
  const cfgPath = path.join(stateDir, "openclaw.json");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      agents: {
        defaults: { model: "old/model" },
        list: [{ id: "dev", model: "old/model" }],
      },
      plugins: { allow: [] },
    }),
    "utf8",
  );

  const result = patchOpenClawGatewayStudioBinding(
    stateDir,
    "dev",
    "deepseek/deepseek-v4-flash",
    "deepseek",
    { chatLabLinkOpenMode: "external" },
  );
  assert.equal(result.ok, true);

  const synced = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.deepEqual(synced.plugins.allow, [
    "acpx",
    "bonjour",
    "browser",
    "device-pair",
    "file-transfer",
    "memory-core",
    "openclaw-weixin",
    "phone-control",
    "talk-voice",
  ]);
  assert.deepEqual(synced.tools?.toolSearch, {
    mode: "tools",
    searchDefaultLimit: 8,
    maxSearchLimit: 20,
  });
});
