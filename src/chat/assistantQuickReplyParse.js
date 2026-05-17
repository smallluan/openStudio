/**
 * Heuristically detect multiple-choice lists in assistant Markdown so the UI can offer one-click replies.
 * Supports: one option per line, or several letter/number options packed in the same paragraph.
 */

/** @param {string} src */
function stripFencedCodeBlocks(src) {
  return String(src ?? "").replace(/```[\s\S]*?```/g, "\n");
}

/**
 * Option line: `- x`, `* x`, `• x`, `1. x`, `1) x`, `1、x`, `A. x`, `A) x`
 * @type {RegExp}
 */
const OPTION_LINE =
  /^\s*(?:(?:[-*•]\s+)|(?:\d{1,2}[.)）、]\s+)|(?:[A-Za-z][.)]\s+))(.+)$/;

/** @param {string} line */
function isContinuationLine(line) {
  const t = line.trim();
  if (!t || OPTION_LINE.test(line)) return false;
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) return true;
  if (t.length <= 28 && /^[0-9.~～％%\s\-–]+$/.test(t)) return true;
  return false;
}

/**
 * Join "0.55"-style lines that follow an option line (streaming / layout can split values).
 * @param {string[]} lines
 */
function mergeOptionContinuations(lines) {
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (
      out.length > 0 &&
      OPTION_LINE.test(out[out.length - 1]) &&
      isContinuationLine(line)
    ) {
      out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Strip short chatty lines after the list ("选一个吧 👀", "请回复 A/B", …).
 * @param {string[]} lines
 */
function stripTrailingEpilogueLines(lines) {
  const out = [...lines];
  let removed = 0;
  while (out.length > 0 && removed < 5) {
    const last = out[out.length - 1];
    if (!last.trim()) {
      out.pop();
      continue;
    }
    if (OPTION_LINE.test(last)) break;
    const t = last.trim();
    if (t.length > 140) break;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) break;
    if (/[?？]\s*$/.test(t) && t.length > 14) break;
    out.pop();
    removed++;
  }
  return out;
}

/** @param {string} s */
function stripInlineMd(s) {
  return String(s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** @param {string} beforeText */
function looksLikeChoicePrompt(beforeText) {
  const t = String(beforeText ?? "").trim();
  if (!t) return false;
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const lastLine = lines.length ? lines[lines.length - 1] : "";
  if (/[?？]\s*$/.test(lastLine)) return true;
  if (/[:：]\s*$/.test(lastLine)) return true;
  return /(以下|如下|任选|选择|选取|方案|哪种|哪样|哪项|是否|请|建议|推荐|还是|或者|哪一个|单选题|多选题|选择题|会选哪个|选哪个|你想选|which|choose|select|pick|prefer|option|would you|could you|either|multiple\s*choice|mcq)/i.test(
    t,
  );
}

/** @param {string} line */
function listMarkerBadge(line) {
  const m =
    /^\s*((?:\d{1,2}[.)）、])|(?:[A-Za-z][.)])|(?:[-*•]))\s+/.exec(String(line ?? ""));
  if (!m) return "·";
  const raw = m[1].trim();
  if (raw === "*" || raw === "-" || raw === "•") return "·";
  return raw.replace(/[.)、]/g, "").trim() || raw;
}

/**
 * Letter options jammed in one paragraph: `A. foo B. bar C. baz`
 * @param {string} block
 * @returns {{ optionLines: string[]; beforeText: string } | null}
 */
function tryParseInlineLetterBlock(block) {
  const re = /\b([A-Za-z])[.)]\s+/g;
  /** @type {{ index: number }[]} */
  const hits = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    hits.push({ index: m.index });
  }
  if (hits.length < 2 || hits.length > 8) return null;

  /** @type {string[]} */
  const optionLines = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : block.length;
    optionLines.push(block.slice(start, end).trim());
  }

  const beforeText = block.slice(0, hits[0].index).trim();
  return { optionLines, beforeText };
}

/**
 * Number options in one paragraph: `1. foo 2. bar`
 * @param {string} block
 * @returns {{ optionLines: string[]; beforeText: string } | null}
 */
function tryParseInlineNumberBlock(block) {
  const re = /(?:^|[\s\u00a0\u3000])(\d{1,2})([.)、])\s+/g;
  /** @type {{ index: number }[]} */
  const hits = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    hits.push({ index: m.index });
  }
  if (hits.length < 2 || hits.length > 8) return null;

  /** @type {string[]} */
  const optionLines = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : block.length;
    optionLines.push(block.slice(start, end).trim());
  }

  const beforeText = block.slice(0, hits[0].index).trim();
  return { optionLines, beforeText };
}

/**
 * Numbered/bulleted blocks used for "please answer these questions" are not mutually exclusive choices.
 * If every line reads as a standalone question, skip quick-reply parsing (avoid fake "single choice" UI).
 * @param {string[]} optionLines
 */
function looksLikeIndependentQuestionList(optionLines) {
  if (optionLines.length < 2) return false;
  let questionLike = 0;
  for (const line of optionLines) {
    const m = OPTION_LINE.exec(line);
    const rest = m ? m[1] : line;
    const text = stripInlineMd(rest);
    if (!text) continue;
    if (/[?？]\s*$/.test(text)) {
      questionLike++;
      continue;
    }
    // Chinese rhetorical question patterns often omit the final "?" in lists
    if (
      /(什么|哪些|哪[个些]|如何|怎么|为何|是否|有没有|能不能|要不要|行不行|多少|几页|几个)/.test(
        text,
      )
    ) {
      questionLike++;
    }
  }
  return questionLike === optionLines.length;
}

/**
 * @param {string[]} optionLines
 * @returns {Array<{ id: string; prompt: string; badge: string }>}
 */
function buildQuestionnaireItems(optionLines) {
  /** @type {Array<{ id: string; prompt: string; badge: string }>} */
  const items = [];
  for (let idx = 0; idx < optionLines.length; idx++) {
    const line = optionLines[idx];
    const m = OPTION_LINE.exec(line);
    const rest = m ? m[1] : line;
    const prompt = stripInlineMd(rest);
    if (!prompt) continue;
    items.push({
      id: `qq-${idx}-${prompt.slice(0, 24)}`,
      prompt,
      badge: listMarkerBadge(line),
    });
  }
  return items;
}

/**
 * @param {string[]} optionLines
 * @returns {{ kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> } | { kind: "questionnaire"; items: Array<{ id: string; prompt: string; badge: string }> } | null}
 */
function interactiveFromOptionLines(optionLines) {
  if (looksLikeIndependentQuestionList(optionLines)) {
    const items = buildQuestionnaireItems(optionLines);
    return items.length >= 2 ? { kind: "questionnaire", items } : null;
  }
  const built = buildOptionsFromLines(optionLines);
  if (!built) return null;
  return { kind: "choice", options: built.options };
}

/**
 * Plain-text bundle for one user turn (one line per answer under each prompt).
 * @param {Array<{ id: string; prompt: string; badge: string }>} items
 * @param {Record<string, string>} answersById
 * @param {string} emptyLabel shown when a field is left blank
 */
export function formatQuestionnaireReplyMessage(items, answersById, emptyLabel) {
  const label = String(emptyLabel ?? "").trim() || "—";
  const parts = [];
  for (const it of items) {
    const v = String(answersById[it.id] ?? "").trim();
    parts.push(`${it.prompt}\n${v || label}`);
  }
  return parts.join("\n\n");
}

/**
 * @param {string[]} optionLines
 */
function buildOptionsFromLines(optionLines) {
  /** @type {Array<{ id: string; label: string; sendText: string; badge: string }>} */
  const options = [];
  for (let idx = 0; idx < optionLines.length; idx++) {
    const line = optionLines[idx];
    const m = OPTION_LINE.exec(line);
    const rest = m ? m[1] : line;
    const label = stripInlineMd(rest);
    const sendText = label || stripInlineMd(line);
    if (!sendText) continue;
    options.push({
      id: `qr-${idx}-${sendText.slice(0, 32)}`,
      label: label || sendText,
      sendText,
      badge: listMarkerBadge(line),
    });
  }
  return options.length >= 2 ? { options } : null;
}

/**
 * @param {string} cleaned
 */
function parseFromMultilineList(cleaned) {
  let lines = cleaned.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  lines = mergeOptionContinuations(lines);
  lines = stripTrailingEpilogueLines(lines);

  /** @type {string[]} */
  const optionLines = [];
  let i = lines.length - 1;
  while (i >= 0) {
    const line = lines[i];
    if (!line.trim()) {
      i--;
      continue;
    }
    if (!OPTION_LINE.test(line)) break;
    optionLines.unshift(line);
    i--;
  }

  if (optionLines.length < 2 || optionLines.length > 8) return null;

  const beforeLines = lines.slice(0, i + 1);
  const beforeText = beforeLines.join("\n");
  if (!looksLikeChoicePrompt(beforeText)) return null;

  return interactiveFromOptionLines(optionLines);
}

/**
 * Fallback: model puts A. B. C. in one paragraph (often one visual block, no newlines between options).
 * @param {string} cleaned
 */
function parseFromInlineParagraphs(cleaned) {
  const paras = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return null;

  /**
   * @param {string} block
   * @param {string} promptPrefix text before `block` in the same message (earlier paragraphs)
   */
  const tryWithPrompt = (block, promptPrefix) => {
    const letter = tryParseInlineLetterBlock(block);
    if (letter) {
      const prompt = `${promptPrefix}\n${letter.beforeText}`.trim();
      if (looksLikeChoicePrompt(prompt)) {
        const built = interactiveFromOptionLines(letter.optionLines);
        if (built) return built;
      }
    }
    const num = tryParseInlineNumberBlock(block);
    if (num) {
      const prompt = `${promptPrefix}\n${num.beforeText}`.trim();
      if (looksLikeChoicePrompt(prompt)) {
        const built = interactiveFromOptionLines(num.optionLines);
        if (built) return built;
      }
    }
    return null;
  };

  const last = paras[paras.length - 1];
  const beforeLast = paras.length > 1 ? paras.slice(0, -1).join("\n\n") : "";
  let hit = tryWithPrompt(last, beforeLast);
  if (hit) return hit;

  if (paras.length >= 2) {
    const lastTwo = `${paras[paras.length - 2]}\n\n${paras[paras.length - 1]}`;
    const beforeLastTwo = paras.length > 2 ? paras.slice(0, -2).join("\n\n") : "";
    hit = tryWithPrompt(lastTwo, beforeLastTwo);
    if (hit) return hit;
  }

  return tryWithPrompt(cleaned.trim(), "");
}

/**
 * @param {string | undefined} markdown
 * @returns {{ kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> } | { kind: "questionnaire"; items: Array<{ id: string; prompt: string; badge: string }> } | null}
 */
export function parseAssistantQuickReplies(markdown) {
  const raw = String(markdown ?? "");
  const cleaned = stripFencedCodeBlocks(raw);

  const multiline = parseFromMultilineList(cleaned);
  if (multiline) return multiline;

  const inline = parseFromInlineParagraphs(cleaned);
  if (inline) return inline;

  return null;
}
