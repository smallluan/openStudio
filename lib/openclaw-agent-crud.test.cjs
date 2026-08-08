const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  removeOpenClawAgent,
  pruneOrphanOpenClawAgents,
  removeAgentDirectory,
} = require("./openclaw-agent-crud.cjs");

/** @type {string[]} */
const temps = [];
/** @type {{ HOME?: string; USERPROFILE?: string }} */
const prevEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};

afterEach(() => {
  if (prevEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = prevEnv.HOME;
  if (prevEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevEnv.USERPROFILE;
  while (temps.length) {
    const dir = temps.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-agent-crud-"));
  temps.push(dir);
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
}

function studioCfg() {
  return {
    openclaw: {
      gatewayBaseUrl: "http://127.0.0.1:19999",
      sessionKey: "agent:dev:dev",
    },
  };
}

function seedState(home, list) {
  const stateDir = path.join(home, ".openclaw");
  fs.mkdirSync(path.join(stateDir, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "openclaw.json"),
    `${JSON.stringify({ agents: { list } }, null, 2)}\n`,
    "utf8",
  );
  for (const entry of list) {
    const root = path.join(stateDir, "agents", entry.id);
    fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(root, "sessions", "sessions.sqlite"), "x");
  }
  return stateDir;
}

test("removeOpenClawAgent removes registry entry and disk even when already gone from list", () => {
  const home = tempHome();
  const stateDir = seedState(home, [
    { id: "dev", default: true },
    { id: "agent-2" },
  ]);

  const first = removeOpenClawAgent({ gatewayAgentId: "agent-2" }, studioCfg());
  assert.equal(first.ok, true);
  assert.equal(first.removed, true);
  assert.equal(first.listRemoved, true);
  assert.equal(fs.existsSync(path.join(stateDir, "agents", "agent-2")), false);

  const cfg = JSON.parse(fs.readFileSync(path.join(stateDir, "openclaw.json"), "utf8"));
  assert.deepEqual(
    cfg.agents.list.map((e) => e.id),
    ["dev"],
  );

  // Re-create orphan folder without registry entry — still deleted.
  fs.mkdirSync(path.join(stateDir, "agents", "agent-2", "sessions"), { recursive: true });
  const second = removeOpenClawAgent({ gatewayAgentId: "agent-2" }, studioCfg());
  assert.equal(second.ok, true);
  assert.equal(second.listRemoved, false);
  assert.equal(second.removed, true);
  assert.equal(fs.existsSync(path.join(stateDir, "agents", "agent-2")), false);
});

test("removeOpenClawAgent refuses to remove the main agent", () => {
  const home = tempHome();
  seedState(home, [{ id: "dev", default: true }]);
  const result = removeOpenClawAgent({ gatewayAgentId: "dev" }, studioCfg());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cannot_remove_main_agent");
});

test("pruneOrphanOpenClawAgents drops registry leftovers not in keep list", () => {
  const home = tempHome();
  const stateDir = seedState(home, [
    { id: "dev", default: true },
    { id: "agent" },
    { id: "agent-2" },
    { id: "helper" },
  ]);

  const result = pruneOrphanOpenClawAgents(
    { keepGatewayAgentIds: ["dev", "helper"] },
    studioCfg(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.pruned, 2);
  assert.deepEqual(result.removed.sort(), ["agent", "agent-2"]);

  const cfg = JSON.parse(fs.readFileSync(path.join(stateDir, "openclaw.json"), "utf8"));
  assert.deepEqual(
    cfg.agents.list.map((e) => e.id).sort(),
    ["dev", "helper"],
  );
  assert.equal(fs.existsSync(path.join(stateDir, "agents", "agent")), false);
  assert.equal(fs.existsSync(path.join(stateDir, "agents", "agent-2")), false);
  assert.equal(fs.existsSync(path.join(stateDir, "agents", "helper")), true);
  assert.equal(fs.existsSync(path.join(stateDir, "agents", "dev")), true);
});

test("removeAgentDirectory is a no-op when the folder is already gone", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-agent-dir-"));
  temps.push(stateDir);
  const result = removeAgentDirectory(stateDir, "missing-agent");
  assert.equal(result.ok, true);
  assert.equal(result.removed, false);
});
