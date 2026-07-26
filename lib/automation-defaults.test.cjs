const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveDefaultModelProfileId,
  resolveAutomationStudioMetaDefaults,
  MAIN_AGENT_STUDIO_ID,
} = require("./automation-defaults.cjs");

test("resolveDefaultModelProfileId prefers active profile", () => {
  const cfg = {
    activeModelProfileId: "active-1",
    modelProfiles: [
      { id: "other", modelId: "m1", enabled: true },
      { id: "active-1", modelId: "m2", enabled: true },
    ],
  };
  assert.equal(resolveDefaultModelProfileId(cfg), "active-1");
});

test("resolveAutomationStudioMetaDefaults uses main agent and active model", () => {
  const cfg = {
    activeModelProfileId: "profile-1",
    modelProfiles: [{ id: "profile-1", modelId: "gpt-4", enabled: true }],
  };
  const defaults = resolveAutomationStudioMetaDefaults(cfg, {}, {
    payload: { kind: "agentTurn", message: "喝水" },
  });
  assert.equal(defaults.agentId, MAIN_AGENT_STUDIO_ID);
  assert.equal(defaults.modelProfileId, "profile-1");
});
