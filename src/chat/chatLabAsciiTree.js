/** @typedef {{ name: string; comment: string | null; children: AsciiTreeNode[] }} AsciiTreeNode */

const TREE_BRANCH_RE = /^(.*?)(├──|└──)\s+(.*)$/;
const TREE_MARKER_RE = /(?:├──|└──|│)/;

/**
 * @param {string} line
 */
export function stripMarkdownBlockquotePrefix(line) {
  return String(line ?? "").replace(/^>\s?/, "");
}

/**
 * @param {string} line
 */
export function normalizeAsciiTreeLine(line) {
  return stripMarkdownBlockquotePrefix(String(line ?? "")).trimEnd();
}

/**
 * @param {string} line
 */
export function isMarkdownBlockquoteLine(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed === ">" || /^>\s/.test(String(line ?? ""));
}

/**
 * @param {string} line
 */
export function isBlankOrBlockquoteSeparator(line) {
  const trimmed = String(line ?? "").trim();
  return !trimmed || trimmed === ">";
}

/**
 * @param {string} line
 */
export function isMarkdownTableLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return false;
  if (/^\|/.test(trimmed)) return true;
  return /^\|?[\s\-:|]+\|/.test(trimmed);
}

/**
 * @param {string} line
 */
function splitNameComment(line) {
  const raw = String(line ?? "").trim();
  const hashIdx = raw.indexOf("#");
  if (hashIdx >= 0) {
    const name = raw.slice(0, hashIdx).trim();
    const comment = raw.slice(hashIdx + 1).trim();
    return { name, comment: comment || null };
  }
  const dashMatch = raw.match(/\s+[—–-]\s+/);
  if (dashMatch && dashMatch.index != null) {
    return {
      name: raw.slice(0, dashMatch.index).trim(),
      comment: raw.slice(dashMatch.index + dashMatch[0].length).trim() || null,
    };
  }
  return { name: raw, comment: null };
}

/**
 * @param {string} line
 */
export function isAsciiTreeBranchLine(line) {
  return TREE_BRANCH_RE.test(normalizeAsciiTreeLine(line));
}

/**
 * @param {string} line
 */
export function isAsciiTreeRootLine(line) {
  const trimmed = normalizeAsciiTreeLine(line).trim();
  if (!trimmed) return false;
  if (isAsciiTreeBranchLine(trimmed)) return false;
  if (TREE_MARKER_RE.test(trimmed)) return false;
  if (isMarkdownTableLine(trimmed)) return false;
  if (/^[-*+]\s/.test(trimmed)) return false;
  if (/^[A-Za-z]:[/\\]/.test(trimmed)) return true;
  if (trimmed.includes("|")) return false;
  return /[/\\]\s*(?:#.*)?$/.test(trimmed);
}

/**
 * @param {string} line
 */
export function isAsciiTreeLine(line) {
  const normalized = normalizeAsciiTreeLine(line);
  if (!normalized.trim()) return false;
  if (isMarkdownTableLine(normalized)) return false;
  return isAsciiTreeBranchLine(normalized) || isAsciiTreeRootLine(normalized);
}

/**
 * @param {string[]} lines
 */
function isStrictAsciiTreeBlock(lines) {
  const nonEmpty = lines
    .map((l) => normalizeAsciiTreeLine(l))
    .filter((l) => l.trim());
  if (nonEmpty.length < 2) return false;

  let branchCount = 0;
  for (const line of nonEmpty) {
    if (isMarkdownTableLine(line)) return false;
    if (isAsciiTreeBranchLine(line)) {
      branchCount += 1;
      continue;
    }
    if (isAsciiTreeRootLine(line)) continue;
    return false;
  }

  return branchCount >= 2;
}

/**
 * @param {string} text
 */
export function looksLikeAsciiTreeText(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  return isStrictAsciiTreeBlock(lines);
}

/**
 * @param {string} prefix
 */
function depthFromTreePrefix(prefix) {
  return Math.max(0, Math.floor(String(prefix ?? "").length / 4));
}

/**
 * Parse ASCII directory tree text into nested nodes.
 * @param {string} text
 * @returns {AsciiTreeNode | null}
 */
export function parseAsciiTree(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => normalizeAsciiTreeLine(l))
    .filter((l) => l.trim());

  if (!isStrictAsciiTreeBlock(lines)) return null;

  /** @type {AsciiTreeNode} */
  const root = { name: "", comment: null, children: [] };
  /** @type {Array<{ depth: number; node: AsciiTreeNode }>} */
  const stack = [{ depth: -1, node: root }];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (i === 0 && isAsciiTreeRootLine(line) && !isAsciiTreeBranchLine(line)) {
      const parsed = splitNameComment(line.trim());
      root.name = parsed.name;
      root.comment = parsed.comment;
      continue;
    }

    const branch = TREE_BRANCH_RE.exec(line);
    if (!branch) continue;

    const depth = depthFromTreePrefix(branch[1]);
    const parsed = splitNameComment(branch[3]);
    /** @type {AsciiTreeNode} */
    const node = {
      name: parsed.name,
      comment: parsed.comment,
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }

  if (!root.name && root.children.length === 1) {
    const only = root.children[0];
    return {
      name: only.name,
      comment: only.comment,
      children: only.children,
    };
  }

  if (!root.name && !root.children.length) return null;
  return root;
}

/**
 * @param {AsciiTreeNode} node
 */
export function isAsciiTreeDir(node) {
  const name = String(node?.name ?? "");
  if (/[/\\]$/.test(name)) return true;
  return Array.isArray(node?.children) && node.children.length > 0;
}
