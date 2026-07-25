import {
  isMarkdownTableRowLine,
  isMarkdownTableSeparatorLine,
  normalizePipeTableLine,
} from "./chatLabMarkdownTableRepair.js";

const CHART_FENCE_OPEN_RE = /^```(chart|echarts)\b/i;
const FENCE_CLOSE_RE = /^```\s*$/;
const FENCE_OPEN_RE = /^```(\w+)/;

/**
 * @param {string} line
 * @param {string[]} body
 */
function shouldCloseChartFence(line, body) {
  const trimmed = String(line ?? "").trim();
  if (!body.length) return false;
  if (FENCE_OPEN_RE.test(trimmed) && !FENCE_CLOSE_RE.test(trimmed)) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^---+\s*$/.test(trimmed)) return true;
  return false;
}

/**
 * Truncate corrupted `data: [1, 2, 3,中文|` arrays inside chart DSL lines.
 * @param {string} line
 * @returns {{ line: string; tail: string[] }}
 */
function repairCorruptedChartDataLine(line) {
  const raw = String(line ?? "");
  const dataMatch = /^(?<indent>\s*data:\s*)\[(?<inner>[^\]]*)$/i.exec(raw);
  if (!dataMatch?.groups) return { line: raw, tail: [] };

  const inner = String(dataMatch.groups.inner ?? "");
  if (!/[^\d\s,.-]/.test(inner) && !inner.includes("|")) {
    return { line: raw, tail: [] };
  }

  const numericPrefix = inner.match(/^[\d\s,.-]+/)?.[0]?.replace(/,\s*$/, "") ?? "";
  const fixed = `${dataMatch.groups.indent}[${numericPrefix}]`;
  const remainder = inner.slice(numericPrefix.length).replace(/^,\s*/, "").trim();
  /** @type {string[]} */
  const tail = [];
  if (remainder.includes("|")) {
    tail.push(normalizePipeTableLine(remainder));
  }
  return { line: fixed, tail };
}

/**
 * @param {string[]} body
 */
function partitionChartFenceBody(body) {
  /** @type {string[]} */
  const chartLines = [];
  /** @type {string[]} */
  const tail = [];
  let inTail = false;

  for (const line of body) {
    const trimmed = String(line ?? "").trim();
    if (!inTail) {
      const repaired = repairCorruptedChartDataLine(line);
      if (repaired.tail.length) {
        chartLines.push(repaired.line);
        tail.push(...repaired.tail);
        inTail = true;
        continue;
      }
      if (
        isMarkdownTableRowLine(normalizePipeTableLine(trimmed))
        || (trimmed.startsWith("|") && trimmed.includes("|", 1))
      ) {
        inTail = true;
        tail.push(normalizePipeTableLine(trimmed));
        continue;
      }
      chartLines.push(line);
      continue;
    }
    if (isMarkdownTableRowLine(normalizePipeTableLine(trimmed)) || trimmed.startsWith("|")) {
      tail.push(normalizePipeTableLine(trimmed));
      continue;
    }
    if (!trimmed) continue;
    tail.push(trimmed);
  }

  return { chartLines, tail };
}

/**
 * Close unclosed ```chart``` / ```echarts``` fences and move leaked markdown tables out.
 * @param {string} source
 */
export function repairChartCodeFences(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = String(lines[i] ?? "").trim();
    const openMatch = CHART_FENCE_OPEN_RE.exec(trimmed);
    if (!openMatch) {
      out.push(lines[i]);
      i++;
      continue;
    }

    out.push(lines[i]);
    i++;
    /** @type {string[]} */
    const body = [];
    let closed = false;

    while (i < lines.length) {
      const line = lines[i];
      if (FENCE_CLOSE_RE.test(String(line ?? "").trim())) {
        closed = true;
        i++;
        break;
      }
      if (shouldCloseChartFence(line, body)) {
        break;
      }
      body.push(line);
      i++;
    }

    const { chartLines, tail } = partitionChartFenceBody(body);
    out.push(...chartLines);
    out.push("```");
    if (tail.length) {
      out.push("", ...tail);
    }
    if (closed && i > 0) {
      // consumed closing fence already
    }
    if (!closed) {
      // current line (heading / next fence) will be processed in outer loop
      continue;
    }
  }

  return out.join("\n");
}

/**
 * @param {string} code
 */
export function sanitizeChartFenceCode(code) {
  const { chartLines, tail } = partitionChartFenceBody(String(code ?? "").split(/\r?\n/));
  if (!tail.length) return chartLines.join("\n").trim();
  return chartLines.join("\n").trim();
}

/**
 * @param {string} code
 * @returns {string}
 */
export function chartFenceTailMarkdown(code) {
  const { tail } = partitionChartFenceBody(String(code ?? "").split(/\r?\n/));
  return tail.join("\n").trim();
}
