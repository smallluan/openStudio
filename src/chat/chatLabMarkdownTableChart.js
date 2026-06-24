/** @typedef {{ title?: string; x: string[]; values: number[]; yLabel?: string }} TableChartSpec */

const CHART_FENCE_RE = /```(?:chart|echarts)\b/i;
const VISUALIZATION_INTENT_RE =
  /(?:柱状图|折线图|饼图|散点图|图表|可视化|趋势图|对比图|占比图|条形图|统计图|bar chart|line chart|pie chart|plot|graph|visuali[sz])/i;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

/**
 * @param {string} cell
 */
function parseNumericCell(cell) {
  const raw = String(cell ?? "").trim();
  if (!raw || raw === "—" || raw === "-" || raw === "–" || /^n\/?a$/i.test(raw)) return null;
  const cleaned = raw.replace(/[,，\s]/g, "");
  const m = /^([+-]?\d+(?:\.\d+)?)([%％万亿]?)/.exec(cleaned);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} rowLine
 * @returns {string[] | null}
 */
function parseTableCells(rowLine) {
  const m = TABLE_ROW_RE.exec(String(rowLine ?? ""));
  if (!m) return null;
  return m[1].split("|").map((cell) => cell.trim());
}

/**
 * @param {string[]} header
 * @param {string[][]} body
 * @returns {TableChartSpec | null}
 */
function chartSpecFromTableRows(header, body) {
  if (!Array.isArray(body) || body.length < 2) return null;
  const width = body[0]?.length ?? 0;
  if (width < 2) return null;

  /** @type {number[]} */
  const numericCounts = Array(width).fill(0);
  for (const row of body) {
    for (let col = 1; col < width; col++) {
      if (parseNumericCell(row[col]) != null) numericCounts[col]++;
    }
  }

  let valueCol = -1;
  for (let col = width - 1; col >= 1; col--) {
    if (numericCounts[col] >= Math.max(2, body.length - 1)) {
      valueCol = col;
      break;
    }
  }
  if (valueCol < 0) return null;

  /** @type {string[]} */
  const x = [];
  /** @type {number[]} */
  const values = [];
  for (const row of body) {
    const label = String(row[0] ?? "").trim();
    const num = parseNumericCell(row[valueCol]);
    if (!label || num == null) continue;
    x.push(label);
    values.push(num);
  }
  if (x.length < 2) return null;

  const yLabel = String(header?.[valueCol] ?? "").trim() || undefined;
  return {
    x,
    values,
    yLabel,
    title: yLabel || "数据概览",
  };
}

/**
 * @param {string} block
 * @returns {TableChartSpec | null}
 */
function chartSpecFromMarkdownTableBlock(block) {
  const lines = String(block ?? "").split(/\r?\n/);
  /** @type {string[][]} */
  const rows = [];
  let sawSep = false;

  for (const line of lines) {
    if (TABLE_SEP_RE.test(line)) {
      sawSep = true;
      continue;
    }
    const cells = parseTableCells(line);
    if (!cells) continue;
    if (!sawSep && rows.length === 0) {
      rows.push(cells);
      continue;
    }
    if (sawSep) rows.push(cells);
  }

  if (!sawSep || rows.length < 2) return null;
  const header = rows[0];
  const body = rows.slice(1);
  return chartSpecFromTableRows(header, body);
}

/**
 * Infer a bar chart from numeric markdown tables (fallback only).
 * @param {string} source
 * @returns {TableChartSpec | null}
 */
export function inferChartFromMarkdownTables(source) {
  const text = String(source ?? "");
  if (CHART_FENCE_RE.test(text)) return null;

  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let buf = [];
  let inTable = false;

  for (const line of text.split(/\r?\n/)) {
    const isTableLine = TABLE_ROW_RE.test(line) || TABLE_SEP_RE.test(line);
    if (isTableLine) {
      if (!inTable) {
        buf = [];
        inTable = true;
      }
      buf.push(line);
      continue;
    }
    if (inTable) {
      blocks.push(buf.join("\n"));
      buf = [];
      inTable = false;
    }
  }
  if (inTable && buf.length) blocks.push(buf.join("\n"));

  /** @type {TableChartSpec | null} */
  let best = null;
  for (const block of blocks) {
    const spec = chartSpecFromMarkdownTableBlock(block);
    if (!spec) continue;
    if (!best || spec.x.length > best.x.length) best = spec;
  }
  return best;
}

/**
 * Only infer a chart when the reply already signals visualization intent and no chart fence exists.
 * @param {string} source
 */
export function shouldInferChartFromMarkdownTables(source) {
  const text = String(source ?? "");
  if (CHART_FENCE_RE.test(text)) return false;
  if (!VISUALIZATION_INTENT_RE.test(text)) return false;
  return inferChartFromMarkdownTables(text) != null;
}

/**
 * @param {TableChartSpec} spec
 */
export function tableChartSpecToDsl(spec) {
  const title = String(spec.title ?? "数据柱状图").trim();
  const yLabel = String(spec.yLabel ?? "").trim();
  const lines = [
    "type: bar",
    `title: ${title}`,
    `x: [${spec.x.join(", ")}]`,
    "series:",
    "  - name: 数值",
    `    data: [${spec.values.join(", ")}]`,
  ];
  if (yLabel) lines.splice(2, 0, `y: ${yLabel}`);
  return lines.join("\n");
}
