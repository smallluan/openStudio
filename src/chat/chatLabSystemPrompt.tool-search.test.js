import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeChatLabStudioSuffix,
  composeToolSearchUserTurnHint,
} from "./chatLabSystemPrompt.js";

const EN = {
  "chatLab.toolSearchPrompt": "## Tool discovery\ntool_search → tool_describe → tool_call",
  "chatLab.toolSearchUserTurnHint": "**Tool Search**: use tool_search first",
  "chatLab.imageDisplayPrompt": "## images",
  "chatLab.chartDisplayPrompt": "## charts",
  "chatLab.htmlDisplayPrompt": "## html embed",
  "chatLab.subagentSpawnPrompt": "## subagents",
  "chatLab.linkOpenSidebarPrompt": "## open via search browser_open",
  "chatLab.sidebarAutomationPrompt": "## automate via search browser_action",
  "chatLab.sidebarPreviewCapabilitiesPrompt": "## sidebar scope",
  "webExploreChat.linkOpenPrompt": "## we open",
  "webExploreChat.pageAutomationPrompt": "## we auto",
};

/** @param {string} key */
function t(key) {
  return EN[key] ?? "";
}

describe("composeChatLabStudioSuffix tool search", () => {
  it("puts Tool Search instructions first", () => {
    const suffix = composeChatLabStudioSuffix(t, { linkOpenMode: "sidebar" });
    assert.match(suffix, /Tool discovery/);
    assert.match(suffix, /browser_open/);
    assert.ok(suffix.indexOf("Tool discovery") < suffix.indexOf("## images"));
  });
});

describe("composeToolSearchUserTurnHint", () => {
  it("returns the short per-turn reminder", () => {
    assert.match(composeToolSearchUserTurnHint(t), /tool_search first/);
  });
});
