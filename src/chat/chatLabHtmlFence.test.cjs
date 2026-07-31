const test = require("node:test");
const assert = require("node:assert/strict");

test("wrapHtmlFenceForInlineSrcDoc wraps fragments and injects resize bootstrap", async () => {
  const {
    INLINE_HTML_FENCE_MESSAGE_CHANNEL,
    wrapHtmlFenceForInlineSrcDoc,
  } = await import("./chatLabDocumentPreview.js");

  const doc = wrapHtmlFenceForInlineSrcDoc("<p>Hi</p>");
  assert.match(doc, /<html/i);
  assert.match(doc, /<p>Hi<\/p>/);
  assert.match(doc, /--os-text:/);
  assert.match(doc, /color-scheme:light/);
  assert.match(doc, new RegExp(INLINE_HTML_FENCE_MESSAGE_CHANNEL));
  assert.match(doc, /ResizeObserver/);
  assert.match(doc, /unhandledrejection/);
});

test("wrapHtmlFenceForInlineSrcDoc injects dark theme tokens", async () => {
  const { wrapHtmlFenceForInlineSrcDoc } = await import("./chatLabDocumentPreview.js");

  const doc = wrapHtmlFenceForInlineSrcDoc("<p>Hi</p>", "dark");
  assert.match(doc, /color-scheme:dark/);
  assert.match(doc, /--os-text:#e8eef4/);
});

test("wrapHtmlFenceForInlineSrcDoc injects into existing head", async () => {
  const { wrapHtmlFenceForInlineSrcDoc, INLINE_HTML_FENCE_MESSAGE_CHANNEL } =
    await import("./chatLabDocumentPreview.js");

  const doc = wrapHtmlFenceForInlineSrcDoc(
    "<!DOCTYPE html><html><head><title>T</title></head><body><div id=x></div></body></html>",
  );
  assert.match(doc, /<title>T<\/title>/);
  assert.match(doc, new RegExp(INLINE_HTML_FENCE_MESSAGE_CHANNEL));
});

test("wrapHtmlFenceForInlineSrcDoc returns empty for blank input", async () => {
  const { wrapHtmlFenceForInlineSrcDoc } = await import("./chatLabDocumentPreview.js");
  assert.equal(wrapHtmlFenceForInlineSrcDoc("   "), "");
});
