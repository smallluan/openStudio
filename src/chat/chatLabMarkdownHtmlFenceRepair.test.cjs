const test = require("node:test");
const assert = require("node:assert/strict");

test("repairHtmlCodeFences closes unclosed html fence", async () => {
  const { repairHtmlCodeFences } = await import("./chatLabMarkdownHtmlFenceRepair.js");
  const source = ["```html", "<div>Hi</div>"].join("\n");
  const out = repairHtmlCodeFences(source);
  assert.match(out, /<div>Hi<\/div>/);
  assert.equal((out.match(/```/g) || []).length, 2);
});

test("repairHtmlMarkdownForRender does not alter html body", async () => {
  const { repairHtmlMarkdownForRender } = await import("./chatLabMarkdownHtmlFenceRepair.js");
  const html = [
    "<!DOCTYPE html>",
    "<html><body><table>",
    '<td rowspan="2">A</td><td colspan="4">B</td>',
    "</table></body></html>",
  ].join("\n");
  const source = ["Intro", "", "```html", html, "```"].join("\n");
  const out = repairHtmlMarkdownForRender(source);
  assert.match(out, /rowspan="2"/);
  assert.match(out, /colspan="4"/);
  assert.doesNotMatch(out, /progress-wrap/);
});

test("segmentMarkdownContentBlocks extracts html fence without body repair", async () => {
  const { segmentMarkdownContentBlocks } = await import("./chatLabMarkdownImageGrid.js");
  const html = "<!DOCTYPE html><html><body><p>OK</p></body></html>";
  const blocks = segmentMarkdownContentBlocks(["```html", html, "```"].join("\n"));
  assert.equal(blocks.filter((b) => b.kind === "html").length, 1);
  assert.match(blocks.find((b) => b.kind === "html")?.body ?? "", /<p>OK<\/p>/);
});
