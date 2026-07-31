const test = require("node:test");
const assert = require("node:assert/strict");

test("analyzeHtmlFenceBody accepts balanced fragment", async () => {
  const { analyzeHtmlFenceBody } = await import("./chatLabHtmlFenceBody.js");
  const out = analyzeHtmlFenceBody("<div><p>Hi</p></div>");
  assert.equal(out.ok, true);
  assert.equal(out.warnings.length, 0);
});

test("analyzeHtmlFenceBody warns on unclosed tags", async () => {
  const { analyzeHtmlFenceBody } = await import("./chatLabHtmlFenceBody.js");
  const out = analyzeHtmlFenceBody("<table><tr><td>A");
  assert.equal(out.ok, false);
  assert.ok(out.warnings.some((w) => /Unclosed tags/i.test(w)));
});

test("analyzeHtmlFenceBody warns on mismatched closing tag", async () => {
  const { analyzeHtmlFenceBody } = await import("./chatLabHtmlFenceBody.js");
  const out = analyzeHtmlFenceBody("<div></span>");
  assert.equal(out.ok, false);
  assert.ok(out.warnings.some((w) => /Mismatched tag/i.test(w)));
});

test("analyzeHtmlFenceBody treats blank as empty", async () => {
  const { analyzeHtmlFenceBody } = await import("./chatLabHtmlFenceBody.js");
  const out = analyzeHtmlFenceBody("   ");
  assert.equal(out.empty, true);
  assert.equal(out.ok, false);
});
