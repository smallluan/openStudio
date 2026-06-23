/**
 * Lenient JSON parsing for LLM-generated ECharts option blocks.
 * Handles trailing commas, // and /* *\/ comments, single-quoted strings,
 * and unquoted object keys before falling back to strict JSON errors.
 */

/** @typedef {{ ok: true; value: Record<string, unknown> }} JsonParseOk */
/** @typedef {{ ok: false; error: string; pending?: boolean }} JsonParseErr */

/**
 * @param {string} source
 * @returns {JsonParseOk | JsonParseErr}
 */
export function parseLenientEchartsJson(source) {
  const text = String(source ?? "").trim().replace(/^\uFEFF/, "");
  if (!text) {
    return { ok: false, error: "Empty chart option", pending: true };
  }
  if (looksLikeIncompleteJson(text)) {
    return { ok: false, error: "Chart JSON is still loading…", pending: true };
  }

  /** @type {string[]} */
  const candidates = [text, sanitizeLlmJsonText(text)];
  /** @type {string | null} */
  let lastMessage = null;

  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      const value = JSON.parse(candidate);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "ECharts option must be a JSON object" };
      }
      return { ok: true, value: /** @type {Record<string, unknown>} */ (value) };
    } catch (err) {
      lastMessage = String(err?.message ?? err ?? "Invalid JSON");
      if (/unexpected end of json input|unterminated string/i.test(lastMessage)) {
        return { ok: false, error: "Chart JSON is incomplete or truncated", pending: true };
      }
    }
  }

  return {
    ok: false,
    error: humanizeJsonError(lastMessage ?? "Invalid JSON"),
  };
}

/** @typedef {{ ok: true; option: Record<string, unknown>; partial?: boolean }} StreamingJsonOk */
/** @typedef {{ ok: false; error: string; pending?: boolean }} StreamingJsonErr */

/**
 * Parse ECharts JSON during streaming: tolerate incomplete input, attempt partial
 * auto-close, and defer hard errors until generation finishes.
 * @param {string} source
 * @param {{ streaming?: boolean }} [opts]
 * @returns {StreamingJsonOk | StreamingJsonErr}
 */
export function parseStreamingEchartsJson(source, opts = {}) {
  const streaming = Boolean(opts.streaming);
  const strict = parseLenientEchartsJson(source);
  if (strict.ok) {
    return { ok: true, option: strict.value };
  }

  const partial = tryParsePartialClosedJson(source);
  if (partial.ok) {
    return { ok: true, option: partial.value, partial: true };
  }

  if (strict.pending || streaming) {
    return { ok: false, error: strict.error, pending: true };
  }

  return { ok: false, error: strict.error };
}

/**
 * @param {string} source
 * @returns {{ ok: true; value: Record<string, unknown> } | { ok: false }}
 */
function tryParsePartialClosedJson(source) {
  const text = String(source ?? "").trim().replace(/^\uFEFF/, "");
  if (!text.startsWith("{")) return { ok: false };

  const closed = closeIncompleteJson(text);
  /** @type {string[]} */
  const candidates = closed === text ? [sanitizeLlmJsonText(text)] : [closed, sanitizeLlmJsonText(closed)];

  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      const value = JSON.parse(candidate);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      return { ok: true, value: /** @type {Record<string, unknown>} */ (value) };
    } catch {
      /* try next */
    }
  }

  return { ok: false };
}

/**
 * @param {string} raw
 */
function closeIncompleteJson(raw) {
  let text = sanitizeLlmJsonText(String(raw ?? "").trim());
  if (!text.startsWith("{")) return text;

  text = text.replace(/,\s*$/, "");
  text = text.replace(/:\s*$/, "");
  text = text.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "");
  text = text.replace(/,\s*'[^'\\]*(?:\\.[^'\\]*)*'\s*:\s*$/, "");

  let { braces, brackets, inString } = countJsonDelimiters(text);
  if (inString) text += '"';
  while (brackets > 0) {
    text += "]";
    brackets--;
  }
  while (braces > 0) {
    text += "}";
    braces--;
  }
  return removeTrailingCommas(text);
}

/**
 * @param {string} text
 */
function countJsonDelimiters(text) {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let stringQuote = '"';
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === stringQuote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      continue;
    }
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }

  return { braces, brackets, inString };
}

/**
 * @param {string} text
 */
function looksLikeIncompleteJson(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (!t.startsWith("{") && !t.startsWith("[")) return false;

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (let idx = 0; idx < t.length; idx++) {
    const ch = t[idx];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }

  return inString || braces > 0 || brackets > 0;
}

/**
 * @param {string} raw
 */
function sanitizeLlmJsonText(raw) {
  let text = stripJsonComments(raw);
  text = normalizeSingleQuotedStrings(text);
  text = quoteUnquotedObjectKeys(text);
  text = removeTrailingCommas(text);
  text = text.replace(/\b(undefined)\b/g, "null");
  text = text.replace(/\bNaN\b/g, "null");
  text = text.replace(/\b-Infinity\b/g, "-1e308");
  text = text.replace(/\bInfinity\b/g, "1e308");
  return text.trim();
}

/**
 * @param {string} raw
 */
function stripJsonComments(raw) {
  let out = "";
  let inString = false;
  let stringQuote = '"';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === stringQuote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Convert JS-style single-quoted strings to JSON double-quoted strings.
 * @param {string} raw
 */
function normalizeSingleQuotedStrings(raw) {
  let out = "";
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inDouble) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    if (inSingle) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += "\\\\";
        escaped = true;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        out += '"';
        continue;
      }
      if (ch === '"') {
        out += '\\"';
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += '"';
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Quote bare object keys: { type: "bar" } -> { "type": "bar" }
 * @param {string} raw
 */
function quoteUnquotedObjectKeys(raw) {
  let out = "";
  let inString = false;
  let stringQuote = '"';
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === stringQuote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }

    if (ch === "{" || ch === ",") {
      out += ch;
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      const keyMatch = /^([A-Za-z_$][\w.-]*)\s*:/.exec(raw.slice(j));
      if (keyMatch) {
        out += raw.slice(i + 1, j);
        out += `"${keyMatch[1]}":`;
        i = j + keyMatch[0].length - 1;
        continue;
      }
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * @param {string} raw
 */
function removeTrailingCommas(raw) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      const next = raw[j];
      if (next === "}" || next === "]") continue;
    }

    out += ch;
  }

  return out;
}

/**
 * @param {string} message
 */
function humanizeJsonError(message) {
  const msg = String(message ?? "Invalid JSON");
  if (/property name or '}'/i.test(msg) || /after property value/i.test(msg)) {
    return `${msg} — 请检查是否有多余逗号、单引号或未加引号的键名；ECharts 块必须是合法 JSON。`;
  }
  if (/function/i.test(msg)) {
    return "ECharts 配置不能包含 JavaScript 函数，请改用纯 JSON。";
  }
  return msg;
}
