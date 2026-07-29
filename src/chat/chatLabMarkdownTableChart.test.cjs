const test = require("node:test");
const assert = require("node:assert/strict");

test("markdown table repair detects table blocks", async () => {
  const { repairGfmMarkdownTables } = await import("./chatLabMarkdownTableRepair.js");
  const { looksLikeMarkdownTableBlock } = await import("./chatLabMarkdownTableChart.js");
  const { resolveChartFenceOption } = await import("./chatLabChartDsl.js");

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
  const tableInChartFence = resolveChartFenceOption(timeline, "echarts", "light");
  assert.equal(tableInChartFence.ok, false);
  assert.equal(tableInChartFence.markdownTable, true);
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

test("reject chart shorthand DSL", async () => {
  const { resolveChartFenceOption } = await import("./chatLabChartDsl.js");

  const dsl = [
    "type: bar",
    "x: [A, B]",
    "series:",
    "  - name: s1",
    "    data: [1, 2]",
  ].join("\n");
  const parsed = resolveChartFenceOption(dsl, "chart", "light");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /简写/);
});

test("parse full echarts JSON option", async () => {
  const { resolveChartFenceOption } = await import("./chatLabChartDsl.js");

  const json = JSON.stringify({
    xAxis: { type: "category", data: ["A", "B"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [1, 2] }],
  });
  const parsed = resolveChartFenceOption(json, "echarts", "light");
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.option.series));
});

test("parse typical LLM radar chart with unquoted keys and single quotes", async () => {
  const { parseLenientEchartsJson } = await import("./chatLabEchartsJson.js");
  const { resolveChartFenceOption } = await import("./chatLabChartDsl.js");

  const source = [
    "{",
    "  title: { text: '能力评估雷达图', left: 'center' },",
    "  legend: { data: ['当前能力', '目标能力'], bottom: 0 },",
    "  radar: {",
    "    indicator: [",
    "      { name: '编程', max: 100 },",
    "      { name: '逻辑', max: 100 },",
    "      { name: '沟通', max: 100 },",
    "      { name: '协作', max: 100 },",
    "      { name: '学习', max: 100 },",
    "      { name: '创造', max: 100 },",
    "    ],",
    "  },",
    "  series: [{",
    "    type: 'radar',",
    "    name: '当前能力',",
    "    data: [{ value: [80, 90, 70, 85, 75, 65] }],",
    "    lineStyle: { width: 2 },",
    "  }, {",
    "    type: 'radar',",
    "    name: '目标能力',",
    "    data: [{ value: [95, 95, 90, 90, 95, 85] }],",
    "    lineStyle: { type: 'dashed', width: 2 },",
    "  }],",
    "}",
  ].join("\n");

  const parsed = parseLenientEchartsJson(source);
  assert.equal(parsed.ok, true);
  const resolved = resolveChartFenceOption(source, "echarts", "light");
  assert.equal(resolved.ok, true);
  assert.ok(Array.isArray(resolved.option.series));
});

test("parse echarts option with single-quoted format braces", async () => {
  const { parseLenientEchartsJson } = await import("./chatLabEchartsJson.js");

  const source = [
    "{",
    "  tooltip: { trigger: 'item', formatter: '{b}: {c}' },",
    "  series: [{ type: 'pie', data: [{ name: 'A', value: 1 }] }]",
    "}",
  ].join("\n");

  const parsed = parseLenientEchartsJson(source);
  assert.equal(parsed.ok, true);
});

test("finalized parse never returns pending", async () => {
  const { parseEchartsJson } = await import("./chatLabChartDsl.js");

  const parsed = parseEchartsJson("{");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.pending, undefined);
  assert.ok(parsed.error);
});

test("parse echarts option with JavaScript formatter callbacks", async () => {
  const { parseLenientEchartsJson } = await import("./chatLabEchartsJson.js");

  const source = [
    "{",
    "  tooltip: {",
    "    trigger: 'item',",
    "    formatter: function(params) { return params.name + ': ' + params.value; }",
    "  },",
    "  series: [{ type: 'pie', data: [{ name: 'A', value: 1 }] }]",
    "}",
  ].join("\n");

  const parsed = parseLenientEchartsJson(source);
  assert.equal(parsed.ok, true);
  const tooltip = /** @type {{ formatter?: (...args: unknown[]) => unknown }} */ (parsed.value.tooltip);
  assert.equal(typeof tooltip.formatter, "function");
  assert.equal(tooltip.formatter({ name: "A", value: 42 }), "A: 42");
});

test("sanitize broken chart fence structurally", async () => {
  const { repairChartCodeFences } = await import("./chatLabMarkdownChartFenceRepair.js");
  const { resolveChartFenceOption } = await import("./chatLabChartDsl.js");

  const source = [
    "```echarts",
    "{",
    '  "xAxis": { "type": "category", "data": ["A", "B"] },',
    '  "yAxis": { "type": "value" },',
    '  "series": [{ "type": "bar", "data": [1, 2,3,text | more |',
    "| row | one |",
    "### Next section",
    "```typescript",
    "const x = 1",
    "```",
  ].join("\n");

  const out = repairChartCodeFences(source);
  assert.match(out, /\| row \| one \|/);
  assert.match(out, /### Next section[\s\S]*```typescript/);
  const chartMatch = out.match(/```echarts\n([\s\S]*?)\n```/);
  assert.ok(chartMatch);
  const parsed = resolveChartFenceOption(chartMatch[1], "echarts", "light");
  assert.equal(parsed.ok, false);
});
