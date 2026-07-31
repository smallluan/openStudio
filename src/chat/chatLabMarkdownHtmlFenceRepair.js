const HTML_FENCE_OPEN_RE = /^```html\b/i;
const FENCE_CLOSE_RE = /^```\s*$/;
const FENCE_OPEN_RE = /^```(\S+)/;

/**
 * Close unclosed ```html``` fences when the message is complete.
 * During streaming, leave fences open so partial HTML stays in the html block
 * instead of leaking into prose (rehype-raw would partially parse it).
 * Does not modify HTML body content.
 * @param {string} source
 * @param {{ streaming?: boolean }} [options]
 */
export function repairHtmlCodeFences(source, options = {}) {
  const streaming = Boolean(options.streaming);
  const lines = String(source ?? "").split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = String(lines[i] ?? "").trim();
    if (!HTML_FENCE_OPEN_RE.test(trimmed)) {
      out.push(lines[i]);
      i++;
      continue;
    }

    out.push(lines[i]);
    i++;
    let closed = false;

    while (i < lines.length) {
      const line = lines[i];
      const lineTrim = String(line ?? "").trim();
      if (FENCE_CLOSE_RE.test(lineTrim)) {
        closed = true;
        out.push(line);
        i++;
        break;
      }
      if (FENCE_OPEN_RE.test(lineTrim) && !FENCE_CLOSE_RE.test(lineTrim)) {
        break;
      }
      out.push(line);
      i++;
    }

    if (!closed && !streaming) {
      out.push("```");
    }
  }

  return out.join("\n");
}

/**
 * @param {string} source
 * @param {{ streaming?: boolean }} [options]
 */
export function repairHtmlMarkdownForRender(source, options = {}) {
  return repairHtmlCodeFences(source, options);
}
