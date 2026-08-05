const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeAssistantTextChunk,
  preferLongerAssistantText,
  mergeTimelineTextDelta,
  mergeTimelineToolTrace,
  mergeTimelineContentSync,
  reconcileTimelineWithCanonicalText,
  ensureTimelineCoversCanonicalText,
} = require("../src/chat/streamTimelineMerge.js");

test("mergeAssistantTextChunk accepts true prefix extensions even when tail already appears earlier", () => {
  const a = "完整榜单：[百度热搜实时榜](http";
  const b = "完整榜单：[百度热搜实时榜](https://top.baidu.com/board?tab=realtime)";
  assert.equal(mergeAssistantTextChunk(a, b), b);

  // Short repeated tail must not block growth (old includes(tail) heuristic).
  const body = "foo bar baz";
  const extended = "foo bar baz bar more";
  assert.equal(mergeAssistantTextChunk(body, extended), extended);
});

test("preferLongerAssistantText keeps longer body over truncated snapshot", () => {
  const full = "完整榜单：[百度热搜实时榜](https://top.baidu.com/board?tab=realtime)";
  const cut = "完整榜单：[百度热搜实时榜](http s://";
  assert.equal(preferLongerAssistantText(full, cut), full);
  assert.equal(preferLongerAssistantText(cut, full), full);
});

test("post-tool text is kept when cumulative snapshot recontains prior prose", () => {
  let tl = [];
  tl = mergeTimelineTextDelta(tl, "先看天气概况。");
  tl = mergeTimelineToolTrace(tl, { id: "t1", toolName: "web_search", phase: "start" });
  tl = mergeTimelineTextDelta(
    tl,
    "先看天气概况。完整榜单：[百度热搜实时榜](https://top.baidu.com/board?tab=realtime)",
  );
  const last = tl[tl.length - 1];
  assert.equal(last?.kind, "text");
  assert.match(String(last.body), /完整榜单/);
  assert.match(String(last.body), /top\.baidu\.com/);
});

test("content_sync does not swallow distinct post-tool prose still missing from canonical", () => {
  /** @type {import("../src/chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */
  const tl = [
    { kind: "text", body: "开场说明。" },
    { kind: "tool", refId: "tool:1" },
    { kind: "text", body: "完整榜单：[百度热搜实时榜](https://top.baidu.com/board?tab=realtime)" },
  ];
  const reconciled = reconcileTimelineWithCanonicalText(tl, "开场说明。");
  const texts = reconciled.filter((s) => s.kind === "text").map((s) => s.body);
  assert.ok(texts.some((b) => String(b).includes("完整榜单")));
  assert.ok(reconciled.some((s) => s.kind === "tool"));
});

test("mergeTimelineContentSync preserves tool refs while extending prose", () => {
  let tl = [{ kind: "text", body: "A" }, { kind: "tool", refId: "tool:x" }, { kind: "text", body: "B" }];
  tl = mergeTimelineContentSync(tl, "A B more", "");
  assert.ok(tl.some((s) => s.kind === "tool" && s.refId === "tool:x"));
  const joined = tl
    .filter((s) => s.kind === "text")
    .map((s) => s.body)
    .join("");
  assert.match(joined, /more/);
});

test("ensureTimelineCoversCanonicalText appends missing mid-sentence tail", () => {
  const tl = [
    { kind: "text", body: "今日热点如下。\n" },
    { kind: "tool", refId: "tool:news" },
    { kind: "text", body: "需要展开哪条新闻的详情，或查" },
  ];
  const content = "今日热点如下。\n需要展开哪条新闻的详情，或查询完整榜单。";
  const covered = ensureTimelineCoversCanonicalText(tl, content);
  const joined = covered
    .filter((s) => s.kind === "text")
    .map((s) => s.body)
    .join("");
  assert.match(joined, /查询完整榜单/);
  assert.ok(covered.some((s) => s.kind === "tool"));
});

test("mergeTimelineTextDelta grows segment when content is a longer prefix extension", () => {
  let tl = [{ kind: "text", body: "需要展开哪条新闻的详情，或查" }];
  tl = mergeTimelineTextDelta(tl, "需要展开哪条新闻的详情，或查询完整榜单。");
  assert.equal(tl.length, 1);
  assert.match(String(tl[0].body), /查询完整榜单/);
});

test("ensureTimelineCoversCanonicalText recovers mid-sentence cut before lifecycle marker", () => {
  const tl = [
    { kind: "text", body: "完整榜单：[百度热搜实时榜](https://top.baidu.com)\n\n需要我展开某条新闻的" },
    { kind: "activity", refId: "lifecycle:run:end" },
  ];
  const content =
    "完整榜单：[百度热搜实时榜](https://top.baidu.com)\n\n需要我展开某条新闻的详情吗？";
  const covered = ensureTimelineCoversCanonicalText(tl, content);
  const joined = covered
    .filter((s) => s.kind === "text")
    .map((s) => s.body)
    .join("");
  assert.match(joined, /详情吗/);
});
