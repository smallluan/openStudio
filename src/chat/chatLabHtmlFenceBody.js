const TAG_TOKEN_RE = /<\/?([a-zA-Z][\w:-]*)\b[^>]*\/?>/g;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * @typedef {{
 *   ok: boolean;
 *   empty?: boolean;
 *   warnings: string[];
 *   body: string;
 * }} HtmlFenceBodyAnalysis
 */

/**
 * Best-effort structural check for ```html``` fence bodies (unbalanced tags, etc.).
 * Does not mutate HTML — only reports warnings for the embed error UI.
 * @param {string} html
 * @returns {HtmlFenceBodyAnalysis}
 */
export function analyzeHtmlFenceBody(html) {
  const body = String(html ?? "").trim();
  if (!body) return { ok: false, empty: true, warnings: [], body: "" };

  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const stack = [];

  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");

  TAG_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TAG_TOKEN_RE.exec(stripped)) !== null) {
    const token = match[0];
    const name = match[1].toLowerCase();
    const selfClosing = /\/>\s*$/.test(token) || VOID_TAGS.has(name);

    if (token.startsWith("</")) {
      const expected = stack[stack.length - 1];
      if (!expected) {
        warnings.push(`Unexpected closing </${name}>`);
        continue;
      }
      if (expected !== name) {
        warnings.push(`Mismatched tag: expected </${expected}>, found </${name}>`);
        continue;
      }
      stack.pop();
      continue;
    }

    if (!selfClosing) stack.push(name);
  }

  if (stack.length) {
    const unclosed = stack.slice(-3).map((tag) => `<${tag}>`).join(", ");
    const suffix = stack.length > 3 ? ` (+${stack.length - 3} more)` : "";
    warnings.push(`Unclosed tags: ${unclosed}${suffix}`);
  }

  return { ok: warnings.length === 0, warnings, body };
}
