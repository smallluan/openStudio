const test = require("node:test");
const assert = require("node:assert/strict");

test("markdown table repair and chart fence parsing", async () => {
  const { parseChartDsl } = await import("./chatLabChartDsl.js");
  const { repairGfmMarkdownTables } = await import("./chatLabMarkdownTableRepair.js");
  const { looksLikeMarkdownTableBlock } = await import("./chatLabMarkdownTableChart.js");

  const input = [
    "| Week | Frontend | Backend |",
    "| Week 4 | P0 done | P0 done |",
  ].join("\n");
  const out = repairGfmMarkdownTables(input);
  assert.match(out, /\| --- \|/);
  assert.match(out, /Week 4/);
  assert.doesNotMatch(out, /\| 任务 \|/);

  const timeline = [
    "| Week | Frontend | Backend |",
    "| --- | --- | --- |",
    "| Week 4 | P0 done | P0 done |",
  ].join("\n");
  assert.equal(looksLikeMarkdownTableBlock(timeline), true);
  const parsedTimeline = parseChartDsl(timeline);
  assert.equal(parsedTimeline.ok, false);
  assert.equal(parsedTimeline.markdownTable, true);

  const numeric = [
    "| Month | Sales |",
    "| --- | --- |",
    "| Jan | 12 |",
    "| Feb | 18 |",
  ].join("\n");
  const parsedNumeric = parseChartDsl(numeric);
  assert.equal(parsedNumeric.ok, true);
  assert.equal(parsedNumeric.spec.type, "bar");
  assert.deepEqual(parsedNumeric.spec.x, ["Jan", "Feb"]);
  assert.deepEqual(parsedNumeric.spec.values, [12, 18]);
});

test("structural table repair without inventing headers", async () => {
  const {
    repairGfmMarkdownTables,
    expandSectionHeadingInlineTable,
  } = await import("./chatLabMarkdownTableRepair.js");

  const split = expandSectionHeadingInlineTable(
    "Section A: label | Alpha | Beta | 3-5 |",
  );
  assert.equal(split.length, 2);
  assert.match(split[0], /Section A:/);
  assert.match(split[1], /Alpha/);

  const source = [
    "P1: planning | Item one | Detail one | 3d |",
    "| Item two | Detail two | 2d |",
  ].join("\n");

  const repaired = repairGfmMarkdownTables(source);
  assert.match(repaired, /P1: planning\n\| Item one \|/);
  assert.match(repaired, /\| --- \|/);
  assert.match(repaired, /\| Item two \|/);
  assert.doesNotMatch(repaired, /\| 任务 \|/);
  assert.doesNotMatch(repaired, /\| 列1 \|/);
});

test("sanitize broken chart fence structurally", async () => {
  const { repairChartCodeFences } = await import("./chatLabMarkdownChartFenceRepair.js");
  const { parseChartDsl } = await import("./chatLabChartDsl.js");

  const source = [
    "```chart",
    "type: bar",
    "x: [A, B]",
    "series:",
    "  - name: s1",
    "    data: [1, 2,3,text | more |",
    "| row | one |",
    "### Next section",
    "```typescript",
    "const x = 1",
    "```",
  ].join("\n");

  const out = repairChartCodeFences(source);
  assert.match(out, /\| row \| one \|/);
  assert.match(out, /### Next section[\s\S]*```typescript/);
  const chartMatch = out.match(/```chart\n([\s\S]*?)\n```/);
  assert.ok(chartMatch);
  assert.equal(parseChartDsl(chartMatch[1]).ok, true);
});
