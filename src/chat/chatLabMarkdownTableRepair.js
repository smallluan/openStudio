const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const DASH_ONLY_CELL_RE = /^[-:\s|]+$/;

/**
 * @param {string} line
 */
export function isMarkdownTableRowLine(line) {
  return TABLE_ROW_RE.test(String(line ?? ""));
}

/**
 * @param {string} line
 */
export function isMarkdownTableSeparatorLine(line) {
  return TABLE_SEP_RE.test(String(line ?? ""));
}

/**
 * @param {string} line
 * @returns {string[] | null}
 */
export function parseTableCells(line) {
  const raw = String(line ?? "").trim();
  if (!raw.includes("|")) return null;
  const body = raw.startsWith("|") ? raw.slice(1) : raw;
  const trimmedBody = body.endsWith("|") ? body.slice(0, -1) : body;
  const cells = trimmedBody.split("|").map((cell) => cell.trim());
  return cells.length ? cells : null;
}

/**
 * @param {string[]} cells
 */
function formatTableRow(cells) {
  return `| ${cells.map((cell) => String(cell ?? "").trim()).join(" | ")} |`;
}

/**
 * @param {string} cell
 */
function isDashOnlyCell(cell) {
  return DASH_ONLY_CELL_RE.test(String(cell ?? "").trim());
}

/**
 * Drop dash-only placeholder cells models sometimes emit inside a row.
 * @param {string[]} cells
 */
function stripDashOnlyCells(cells) {
  return cells.filter((cell) => !isDashOnlyCell(cell));
}

/**
 * @param {string} line
 */
function countTableColumns(line) {
  return parseTableCells(line)?.length ?? 0;
}

/**
 * @param {string} line
 */
function makeTableSeparatorLine(lineOrCount) {
  const colCount = typeof lineOrCount === "number"
    ? lineOrCount
    : countTableColumns(lineOrCount);
  if (colCount < 1) return "| --- |";
  return formatTableRow(Array(colCount).fill("---"));
}

/**
 * Normalize loose `a | b | c` lines into GFM pipe rows.
 * @param {string} line
 */
export function normalizePipeTableLine(line) {
  const raw = String(line ?? "");
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.includes("|")) return raw;

  let s = trimmed;
  if (!s.startsWith("|")) s = `| ${s}`;
  if (!s.endsWith("|")) s = `${s} |`;

  const cells = parseTableCells(s);
  if (!cells) return s;
  const cleaned = stripDashOnlyCells(cells);
  if (cleaned.length >= 2 && cleaned.length < cells.length) {
    return formatTableRow(cleaned);
  }
  return s;
}

/**
 * Fix rows where a separator dash-run was merged into the last cell.
 * @param {string} line
 */
export function repairCorruptedTableLine(line) {
  const normalized = normalizePipeTableLine(line);
  if (!isMarkdownTableRowLine(normalized)) return line;

  const cells = parseTableCells(normalized);
  if (!cells) return line;

  const cleaned = stripDashOnlyCells(cells);
  if (cleaned.length >= 2 && cleaned.length !== cells.length) {
    return formatTableRow(cleaned);
  }

  const last = cells[cells.length - 1] ?? "";
  const merged = /^(.+?)\|[-\s]{3,}$/.exec(last);
  if (merged) {
    const fixed = [...cells.slice(0, -1), merged[1].trim()];
    if (fixed.length >= 2) return formatTableRow(fixed);
  }

  return normalized;
}

/**
 * Split markdown heading text from a loose pipe-row on the same line.
 * @param {string} line
 * @returns {string[] | null}
 */
function splitHeadingLooseTable(line) {
  const trimmed = String(line ?? "").trim();
  const m = /^(#{1,6}\s+[^\n|]+?)\s+((?:[^|\n]+\|){1,}[^|\n]+\|?\s*)$/.exec(trimmed);
  if (!m) return null;
  return [m[1].trim(), normalizePipeTableLine(m[2].trim())];
}

/**
 * @param {string[]} cells
 * @param {number} colCount
 * @returns {string[][]}
 */
function splitMergedDataCells(cells, colCount) {
  if (colCount < 1 || cells.length <= colCount) return [cells];
  if (cells.length % colCount !== 0) return [cells];

  /** @type {string[][]} */
  const rows = [];
  for (let i = 0; i < cells.length; i += colCount) {
    rows.push(cells.slice(i, i + colCount));
  }
  return rows;
}

/**
 * @param {string[]} lines
 */
function inferTableColumnCount(lines) {
  /** @type {number[]} */
  const counts = [];
  for (const line of lines) {
    if (isMarkdownTableSeparatorLine(line)) continue;
    const cells = stripDashOnlyCells(parseTableCells(line) ?? []);
    if (cells.length > 0) counts.push(cells.length);
  }
  if (!counts.length) return 2;

  /** @type {Map<number, number>} */
  const freq = new Map();
  for (const count of counts) {
    freq.set(count, (freq.get(count) ?? 0) + 1);
  }
  let best = counts[0];
  let bestHits = 0;
  for (const [count, hits] of freq) {
    if (hits > bestHits) {
      best = count;
      bestHits = hits;
    }
  }
  return best;
}

/**
 * @param {string[]} lines
 */
function splitOverwideTableRows(lines) {
  const colCount = inferTableColumnCount(lines);
  /** @type {string[]} */
  const out = [];

  for (const line of lines) {
    if (isMarkdownTableSeparatorLine(line)) {
      out.push(line);
      continue;
    }
    const cells = stripDashOnlyCells(parseTableCells(line) ?? []);
    if (!cells.length) {
      out.push(line);
      continue;
    }
    const rowGroups = splitMergedDataCells(cells, colCount);
    for (const group of rowGroups) {
      out.push(formatTableRow(group));
    }
  }
  return out;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
export function expandSectionHeadingInlineTable(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed.startsWith("|")) return [line];

  const headingSplit = splitHeadingLooseTable(trimmed);
  if (headingSplit) return headingSplit;

  const pipeCount = (trimmed.match(/\|/g) ?? []).length;
  if (pipeCount < 2) return [line];

  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx > 0) {
    const prefix = trimmed.slice(0, pipeIdx).trim();
    const tablePart = normalizePipeTableLine(trimmed.slice(pipeIdx));
    const cellCount = countTableColumns(tablePart);
    if (cellCount >= 2 && /[：:]/.test(prefix) && !prefix.includes("|")) {
      return [prefix, tablePart];
    }
    if (cellCount >= 2 && /^#{1,6}\s/.test(prefix)) {
      return [prefix, tablePart];
    }
  }

  if (!trimmed.startsWith("|") && pipeCount >= 2) {
    return [normalizePipeTableLine(trimmed)];
  }

  return [line];
}

/**
 * @param {string[]} lines
 */
function dedupeBodySeparators(lines) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 1 && isMarkdownTableSeparatorLine(line)) continue;
    out.push(line);
  }
  return out;
}

/**
 * Repair a contiguous markdown table block (structure only — never invent cell text).
 * @param {string[]} lines
 */
export function repairTableBlockLines(lines) {
  /** @type {string[]} */
  let block = [];
  for (const line of lines) {
    if (isMarkdownTableSeparatorLine(line)) {
      block.push(makeTableSeparatorLine(line));
      continue;
    }
    const normalized = normalizePipeTableLine(line);
    if (isMarkdownTableRowLine(normalized)) block.push(normalized);
  }

  if (block.length < 2) return block;

  let sepIdx = block.findIndex((line) => isMarkdownTableSeparatorLine(line));

  if (sepIdx > 1) {
    const separator = block[sepIdx];
    const body = block
      .slice(1, sepIdx)
      .concat(block.slice(sepIdx + 1))
      .filter((line) => !isMarkdownTableSeparatorLine(line));
    block = [block[0], separator, ...body];
    sepIdx = 1;
  }

  if (sepIdx === -1) {
    const colCount = inferTableColumnCount(block);
    block.splice(1, 0, makeTableSeparatorLine(colCount));
  } else if (sepIdx === 0 && block.length > 1) {
    block = [block[1], block[0], ...block.slice(2)];
  }

  return dedupeBodySeparators(block);
}

/**
 * Repair markdown tables in prose (outside fenced code blocks).
 * @param {string} source
 */
export function repairGfmMarkdownTables(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  /** @type {string[]} */
  const expanded = [];
  /** @type {string | null} */
  let fenceDelim = null;

  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);

    if (fenceMatch) {
      const delim = fenceMatch[1];
      const info = (fenceMatch[2] ?? "").trim();
      if (!fenceDelim) {
        fenceDelim = delim;
      } else if (delim[0] === fenceDelim[0] && delim.length >= fenceDelim.length && info === "") {
        fenceDelim = null;
      }
      expanded.push(line);
      continue;
    }

    if (fenceDelim) {
      expanded.push(line);
      continue;
    }

    for (const part of expandSectionHeadingInlineTable(line)) {
      expanded.push(repairCorruptedTableLine(part));
    }
  }

  /** @type {string[]} */
  const out = [];
  let i = 0;

  while (i < expanded.length) {
    const line = expanded[i];
    const normalized = normalizePipeTableLine(line);
    const isTableLine =
      isMarkdownTableRowLine(normalized) || isMarkdownTableSeparatorLine(line);

    if (!isTableLine) {
      out.push(line);
      i++;
      continue;
    }

    /** @type {string[]} */
    const block = [];
    while (i < expanded.length) {
      const row = expanded[i];
      const rowNormalized = normalizePipeTableLine(row);
      if (!isMarkdownTableRowLine(rowNormalized) && !isMarkdownTableSeparatorLine(row)) break;
      block.push(row);
      i++;
    }
    out.push(...repairTableBlockLines(splitOverwideTableRows(block)));
  }

  return out.join("\n");
}
