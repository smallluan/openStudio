const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("chatLabSelectionAddress", () => {
  it("does not treat Chinese slash or-lists as local paths", async () => {
    const { classifySelectionAddress, findLocalPathSpansInText } = await import("./chatLabSelectionAddress.js");

    assert.equal(classifySelectionAddress("/输入/滚动操作页面"), null);
    assert.equal(classifySelectionAddress("/输入/滚动"), null);
    assert.deepEqual(findLocalPathSpansInText("点击 /输入/滚动操作页面"), []);
    assert.deepEqual(findLocalPathSpansInText("browser_action（点击/输入/滚动）"), []);
  });

  it("still detects real unix-style paths", async () => {
    const { classifySelectionAddress, findLocalPathSpansInText } = await import("./chatLabSelectionAddress.js");

    assert.deepEqual(classifySelectionAddress("/src/components/App.tsx"), {
      kind: "local",
      path: "/src/components/App.tsx",
    });
    assert.deepEqual(findLocalPathSpansInText("see /src/components/App.tsx next"), [
      { start: 4, end: 27, path: "/src/components/App.tsx" },
    ]);
  });
});
