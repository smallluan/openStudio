import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  avatarRefForLlmContext,
  buildGlobalUserMd,
  buildIdentityMd,
} from "./agents.js";

describe("avatarRefForLlmContext", () => {
  it("strips data-url avatars from LLM-bound context", () => {
    const dataUrl = `data:image/jpeg;base64,${"A".repeat(2000)}`;
    assert.equal(avatarRefForLlmContext(dataUrl), "");
    assert.equal(avatarRefForLlmContext("https://cdn.example/a.png"), "https://cdn.example/a.png");
  });
});

describe("buildGlobalUserMd", () => {
  it("keeps name/gender/userMd but never embeds base64 avatar pixels", () => {
    const md = buildGlobalUserMd({
      displayName: "田硕",
      gender: "male",
      avatar: `data:image/jpeg;base64,${"B".repeat(8000)}`,
      userMd: "喜欢编程",
    });
    assert.match(md, /Name:\*\* 田硕/);
    assert.match(md, /Gender:\*\* Male/);
    assert.match(md, /喜欢编程/);
    assert.doesNotMatch(md, /data:image/);
    assert.doesNotMatch(md, /base64/);
    assert.ok(md.length < 200);
  });
});

describe("buildIdentityMd", () => {
  it("omits data: agent avatars from IDENTITY.md", () => {
    const md = buildIdentityMd({
      name: "小婷",
      description: "助手",
      avatar: "data:image/png;base64,xxxx",
    });
    assert.match(md, /Name:\*\* 小婷/);
    assert.doesNotMatch(md, /Avatar:/);
    assert.doesNotMatch(md, /data:image/);
  });
});
