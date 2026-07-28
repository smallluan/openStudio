import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fingerprintStudioSystemContent,
  systemMessageForAgent,
} from "./agents.js";

describe("systemMessageForAgent", () => {
  const agent = {
    id: "dev",
    name: "Dev",
    description: "helper",
    avatar: "🦞",
    soulMd: "# SOUL\nBe helpful and verbose about identity.",
    identityMd: "# IDENTITY\n- **Name:** Dev",
    userMd: "Agent-local user notes",
    isMain: true,
  };

  it("defaults to lean Studio UI rules without re-pasting SOUL/IDENTITY/USER", () => {
    const row = systemMessageForAgent(agent, "General fallback", {
      studioSuffix: "## 图片展示\nUse markdown images.",
      globalUserProfile: {
        displayName: "田硕",
        avatar: `data:image/jpeg;base64,${"X".repeat(4000)}`,
        userMd: "likes coffee",
      },
    });
    assert.ok(row);
    assert.equal(row.role, "system");
    assert.match(row.content, /Studio UI session/);
    assert.match(row.content, /图片展示/);
    assert.doesNotMatch(row.content, /# SOUL/);
    assert.doesNotMatch(row.content, /# USER\.md/);
    assert.doesNotMatch(row.content, /likes coffee/);
    assert.doesNotMatch(row.content, /data:image/);
    assert.ok(row.content.length < 2500);
  });

  it("still supports includeWorkspacePersona for offline/debug", () => {
    const row = systemMessageForAgent(agent, "", { includeWorkspacePersona: true });
    assert.ok(row);
    assert.match(row.content, /# SOUL\.md/);
    assert.match(row.content, /Be helpful/);
  });
});

describe("fingerprintStudioSystemContent", () => {
  it("is stable for identical content and changes when content changes", () => {
    const a = fingerprintStudioSystemContent("hello world");
    const b = fingerprintStudioSystemContent("hello world");
    const c = fingerprintStudioSystemContent("hello world!");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
