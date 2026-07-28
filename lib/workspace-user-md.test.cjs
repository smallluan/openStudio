"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  composeWorkspaceUserMd,
  syncWorkspaceUserMdFromStudio,
} = require("./openclaw-agent-crud.cjs");

test("composeWorkspaceUserMd merges global profile without data-url avatars", () => {
  const md = composeWorkspaceUserMd(
    {
      userProfile: {
        displayName: "田硕",
        gender: "male",
        avatar: `data:image/jpeg;base64,${"Z".repeat(5000)}`,
        userMd: "likes tea",
      },
    },
    "Agent-specific note",
  );
  assert.match(md, /Name:\*\* 田硕/);
  assert.match(md, /likes tea/);
  assert.match(md, /Agent-specific note/);
  assert.doesNotMatch(md, /data:image/);
});

test("syncWorkspaceUserMdFromStudio writes USER.md and refreshes about-user block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-studio-user-md-"));
  const first = syncWorkspaceUserMdFromStudio(dir, {
    userProfile: { displayName: "A", userMd: "one" },
  });
  assert.equal(first, true);
  const body1 = fs.readFileSync(path.join(dir, "USER.md"), "utf8");
  assert.match(body1, /Name:\*\* A/);

  const second = syncWorkspaceUserMdFromStudio(dir, {
    userProfile: { displayName: "B", userMd: "two" },
  });
  assert.equal(second, true);
  const body2 = fs.readFileSync(path.join(dir, "USER.md"), "utf8");
  assert.match(body2, /Name:\*\* B/);
  assert.match(body2, /two/);
  assert.doesNotMatch(body2, /\bA\b/);
});
