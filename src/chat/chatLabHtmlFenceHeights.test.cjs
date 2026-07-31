const test = require("node:test");
const assert = require("node:assert/strict");

test("parseHtmlFenceHeightHint reads comment and meta", async () => {
  const { parseHtmlFenceHeightHint } = await import("./chatLabHtmlFenceHeights.js");
  assert.equal(parseHtmlFenceHeightHint("<!-- openstudio-embed-height: 280 -->"), 280);
  assert.equal(
    parseHtmlFenceHeightHint('<meta name="openstudio-embed-height" content="360" />'),
    360,
  );
});

test("resolveHtmlFenceReservedHeight prefers stored over hint", async () => {
  const { resolveHtmlFenceReservedHeight, HTML_FENCE_DEFAULT_RESERVED_PX } = await import(
    "./chatLabHtmlFenceHeights.js"
  );
  const body = "<!-- openstudio-embed-height: 240 --><p>x</p>";
  assert.equal(resolveHtmlFenceReservedHeight(body, { 0: 400 }, 0), 400);
  assert.equal(resolveHtmlFenceReservedHeight(body, null, 0), 240);
  assert.equal(resolveHtmlFenceReservedHeight("<p>x</p>", null, 0), HTML_FENCE_DEFAULT_RESERVED_PX);
});

test("resolveHtmlFenceReservedHeight uses fixed height for broken html", async () => {
  const { resolveHtmlFenceReservedHeight, HTML_FENCE_ERROR_RESERVED_PX } = await import(
    "./chatLabHtmlFenceHeights.js"
  );
  assert.equal(
    resolveHtmlFenceReservedHeight("<table><tr><td>A", null, 0),
    HTML_FENCE_ERROR_RESERVED_PX,
  );
});

test("resolveHtmlFenceReservedHeight ignores hint when allowHint is false", async () => {
  const { resolveHtmlFenceReservedHeight, HTML_FENCE_DEFAULT_RESERVED_PX } = await import(
    "./chatLabHtmlFenceHeights.js"
  );
  const body = "<!-- openstudio-embed-height: 640 --><p>x</p>";
  assert.equal(
    resolveHtmlFenceReservedHeight(body, null, 0, { allowHint: false }),
    HTML_FENCE_DEFAULT_RESERVED_PX,
  );
});

test("mergeHtmlFenceHeight skips unchanged values", async () => {
  const { mergeHtmlFenceHeight } = await import("./chatLabHtmlFenceHeights.js");
  assert.equal(mergeHtmlFenceHeight({ 0: 200 }, 0, 200), null);
  assert.deepEqual(mergeHtmlFenceHeight({ 0: 200 }, 0, 240), { 0: 240 });
});

test("htmlFenceHeightsCompleteForMarkdown checks all fence indices", async () => {
  const { htmlFenceHeightsCompleteForMarkdown } = await import("./chatLabHtmlFenceHeights.js");
  const md = ["```html", "<p>a</p>", "```", "text", "```html", "<p>b</p>", "```"].join("\n");
  assert.equal(htmlFenceHeightsCompleteForMarkdown(md, null), false);
  assert.equal(htmlFenceHeightsCompleteForMarkdown(md, { 0: 120 }), false);
  assert.equal(htmlFenceHeightsCompleteForMarkdown(md, { 0: 120, 1: 200 }), true);
  assert.equal(htmlFenceHeightsCompleteForMarkdown("hello", { 0: 120 }), true);
});

test("estimateHtmlFenceLayoutExtra adds reserved layout beyond prose estimate", async () => {
  const { estimateHtmlFenceLayoutExtra } = await import("./chatLabHtmlFenceHeights.js");
  const md = ["```html", "<!-- openstudio-embed-height: 400 -->", "<p>Hi</p>", "```"].join("\n");
  const extra = estimateHtmlFenceLayoutExtra(md, null);
  assert.ok(extra > 0);
});
