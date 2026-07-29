/** @typedef {{ title?: string; x: string[]; values: number[]; yLabel?: string }} TableChartSpec */

import {
  isMarkdownTableRowLine,
  isMarkdownTableSeparatorLine,
  repairGfmMarkdownTables,
  repairTableBlockLines,
} from "./chatLabMarkdownTableRepair.js";

export { repairGfmMarkdownTables } from "./chatLabMarkdownTableRepair.js";

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
export function chartSpecFromMarkdownTableBlock(block) {
  const lines = repairTableBlockLines(String(block ?? "").split(/\r?\n/));
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
 * True when the block is only markdown table lines (with or without a separator row).
 * @param {string} block
 */
export function looksLikeMarkdownTableBlock(block) {
  const lines = repairTableBlockLines(String(block ?? "").split(/\r?\n/));
  let pipeRows = 0;
  let sawSep = false;
  let nonTableLines = 0;

  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (isMarkdownTableSeparatorLine(line)) {
      sawSep = true;
      continue;
    }
    if (isMarkdownTableRowLine(line)) {
      pipeRows++;
      continue;
    }
    nonTableLines++;
  }

  if (pipeRows < 2 || nonTableLines > 0) return false;
  return sawSep || pipeRows >= 2;
}
