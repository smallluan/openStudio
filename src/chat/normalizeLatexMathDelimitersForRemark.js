/**
 * remark-math only recognizes $ / $$; models often emit LaTeX \( \) and \[ \].
 * Rewrite those delimiters outside ``` fenced blocks so rehype-katex can render.
 */

/** @param {string} md @param {number} bodyStart @returns {number} */
function findClosingTripleBacktickFenceEnd(md, bodyStart) {
  let idx = bodyStart;
  while (idx < md.length) {
    const nextNl = md.indexOf("\n", idx);
    const lineEnd = nextNl === -1 ? md.length : nextNl;
    const line = md.slice(idx, lineEnd);
    if (/^[ \t]*```[ \t]*$/.test(line)) {
      return lineEnd === md.length ? md.length : lineEnd + 1;
    }
    if (nextNl === -1) break;
    idx = nextNl + 1;
  }
  return -1;
}

/** @returns {Array<{ fence: boolean, text: string }>} */
function splitLeavingTripleBacktickFences(md) {
  /** @type {Array<{ fence: boolean, text: string }>} */
  const chunks = [];
  let i = 0;
  while (i < md.length) {
    const openAt = md.indexOf("```", i);
    if (openAt === -1) {
      chunks.push({ fence: false, text: md.slice(i) });
      break;
    }
    if (openAt > i) chunks.push({ fence: false, text: md.slice(i, openAt) });
    const lineAfterOpen = md.indexOf("\n", openAt + 3);
    if (lineAfterOpen === -1) {
      chunks.push({ fence: true, text: md.slice(openAt) });
      break;
    }
    const bodyStart = lineAfterOpen + 1;
    const fenceEnd = findClosingTripleBacktickFenceEnd(md, bodyStart);
    if (fenceEnd === -1) {
      chunks.push({ fence: true, text: md.slice(openAt) });
      break;
    }
    chunks.push({ fence: true, text: md.slice(openAt, fenceEnd) });
    i = fenceEnd;
  }
  return chunks;
}

/**
 * \[ \] -> $$ ... $$ ; \( \) -> $ ... $ , but \( \) is not rewritten inside $$ ... $$
 * (avoid turning nested \( … \) in display math into nested $ tokens).
 *
 * @param {string} segment
 * @returns {string}
 */
function rewriteLatexDelimitersInText(segment) {
  let s = segment.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => {
    let t = String(inner).trim();
    if (!t) return "";
    // Inside display math, \( \) is unusual; unwrap to plain parens for KaTeX in $$.
    t = t.replace(/\\\(([\s\S]*?)\\\)/g, (_, x) => `(${String(x).trim()})`);
    return `\n$$\n${t}\n$$\n`;
  });

  const parts = s.split("$$");
  for (let j = 0; j < parts.length; j += 2) {
    parts[j] = parts[j].replace(/\\\(([\s\S]*?)\\\)/g, (_, inn) => {
      const t = String(inn).trim();
      if (!t) return "\\(\\)";
      return `$${t}$`;
    });
  }
  return parts.join("$$");
}

/** @param {string} md */
export function normalizeLatexMathDelimitersForRemark(md) {
  if (typeof md !== "string" || md.length === 0) return md;
  return splitLeavingTripleBacktickFences(md)
    .map((c) => (c.fence ? c.text : rewriteLatexDelimitersInText(c.text)))
    .join("");
}
