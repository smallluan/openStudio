/**
 * Unit tests for browser_action observation pruning.
 * Run: node --test lib/browser-observation-prune.test.cjs
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const prune = require("./browser-observation-prune.cjs");

function toolResult(payload, toolName = "browser_action") {
  return {
    role: "toolResult",
    toolName,
    toolCallId: `call_${Math.random().toString(16).slice(2)}`,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function browserPayload(gen, url, { elements = 3, text = "hello page" } = {}) {
  return {
    ok: true,
    steps: [{ ok: true, action: "click" }],
    observation: {
      ok: true,
      url,
      title: `Title ${gen}`,
      pageGeneration: gen,
      text,
      elements: Array.from({ length: elements }, (_, i) => ({
        ref: `e${i + 1}`,
        name: `el${i + 1}`,
      })),
    },
    hint: "Use observation.elements[].ref",
  };
}

describe("advancePageGeneration", () => {
  it("starts at generation 1", () => {
    const next = prune.advancePageGeneration({ pageGeneration: 0, lastUrl: "" }, { url: "https://a.example/" });
    assert.equal(next.pageGeneration, 1);
    assert.equal(next.pageChanged, false);
  });

  it("bumps on URL change", () => {
    const next = prune.advancePageGeneration(
      { pageGeneration: 1, lastUrl: "https://a.example/" },
      { url: "https://b.example/" },
    );
    assert.equal(next.pageGeneration, 2);
    assert.equal(next.pageChanged, true);
  });

  it("bumps on forced reload of same URL", () => {
    const next = prune.advancePageGeneration(
      { pageGeneration: 2, lastUrl: "https://a.example/" },
      { url: "https://a.example/", forceBump: true },
    );
    assert.equal(next.pageGeneration, 3);
    assert.equal(next.pageChanged, true);
  });

  it("does not bump for same URL without force", () => {
    const next = prune.advancePageGeneration(
      { pageGeneration: 2, lastUrl: "https://a.example/path" },
      { url: "https://a.example/path#section" },
    );
    assert.equal(next.pageGeneration, 2);
    assert.equal(next.pageChanged, false);
  });
});

describe("pruneStaleBrowserActionDom", () => {
  it("keeps only the latest observation DOM", () => {
    const messages = [
      { role: "user", content: "go" },
      toolResult(browserPayload(1, "https://a.example/")),
      toolResult(browserPayload(2, "https://b.example/")),
    ];
    const out = prune.pruneStaleBrowserActionDom(messages);
    const first = JSON.parse(out[1].content[0].text);
    const second = JSON.parse(out[2].content[0].text);
    assert.equal(first.observation.domStripped, true);
    assert.equal(first.observation.elementCount, 3);
    assert.equal(first.observation.elements, undefined);
    assert.equal(first.observation.text, undefined);
    assert.ok(Array.isArray(second.observation.elements));
    assert.equal(second.observation.elements.length, 3);
    assert.equal(second.observation.text, "hello page");
  });

  it("strips older same-page inventories too", () => {
    const messages = [
      toolResult(browserPayload(1, "https://a.example/")),
      toolResult(browserPayload(1, "https://a.example/")),
    ];
    const out = prune.pruneStaleBrowserActionDom(messages);
    const first = JSON.parse(out[0].content[0].text);
    const second = JSON.parse(out[1].content[0].text);
    assert.equal(first.observation.domStripped, true);
    assert.ok(Array.isArray(second.observation.elements));
  });

  it("retainPriorPageDom keeps previous generation DOM", () => {
    const messages = [
      toolResult(browserPayload(1, "https://a.example/")),
      toolResult({
        ...browserPayload(2, "https://b.example/"),
        retainPriorPageDom: true,
      }),
    ];
    const out = prune.pruneStaleBrowserActionDom(messages);
    const first = JSON.parse(out[0].content[0].text);
    const second = JSON.parse(out[1].content[0].text);
    assert.ok(Array.isArray(first.observation.elements));
    assert.ok(Array.isArray(second.observation.elements));
  });

  it("leaves non-browser tool results alone", () => {
    const messages = [
      toolResult({ ok: true, path: "/tmp/x.png" }, "browser_screenshot"),
      toolResult(browserPayload(1, "https://a.example/")),
    ];
    const out = prune.pruneStaleBrowserActionDom(messages);
    assert.equal(out[0], messages[0]);
  });
});
