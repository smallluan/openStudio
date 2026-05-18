/**
 * Heuristically detect multiple-choice lists in assistant Markdown so the UI can offer one-click replies.
 * Uses lightweight preprocessing (strip fenced code + GFM `|` table lines) so Markdown document
 * structure is less likely to be mistaken for tap targets — **not** a full Markdown AST.
 */

/** @param {string} src */
function stripFencedCodeBlocks(src) {
  return String(src ?? "").replace(/```[\s\S]*?```/g, "\n");
}

/**
 * GFM tables are `|` lines. Docs often mix `1.` / `2.` ordered lists with tables; strip table lines
 * before quick-reply peeling so pipes/rows are not merged into a fake “option”.
 *
 * @param {string} src
 */
function stripGFMPipeTableLines(src) {
  return String(src ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t.startsWith("|")) return false;
      return true;
    })
    .join("\n");
}

/**
 * Models often wrap choice markers in bold: `**A)** label`, which breaks line/inline parsers
 * that expect `[A-Za-z][.)]\s+` immediately before the label.
 * @param {string} src
 */
function normalizeBoldChoiceMarkers(src) {
  return String(src ?? "").replace(/\*\*([A-Z])\s*([：:.．）)])\*\*(\s*)/g, "$1$2$3");
}

/**
 * Peel outermost `** … **` / `__ … __` when the interior does not contain the same delimiter pair
 * (models wrap whole rows as `**A) …**`; strict “startsWith && endsWith” misses spaced/closing variants).
 *
 * @param {string} t trimmed
 */
function stripOuterDoubleEmphasis(t) {
  let s = String(t ?? "").trim();
  for (let i = 0; i < 8; i++) {
    let changed = false;
    if (s.startsWith("**")) {
      const last = s.lastIndexOf("**");
      if (last > 2) {
        const inner = s.slice(2, last).trim();
        const tail = s.slice(last + 2).trim();
        if (!/\*\*/.test(inner)) {
          s = tail ? `${inner} ${tail}`.trim() : inner;
          changed = true;
          continue;
        }
      }
    }
    if (s.startsWith("__")) {
      const last = s.lastIndexOf("__");
      if (last > 2) {
        const inner = s.slice(2, last).trim();
        const tail = s.slice(last + 2).trim();
        if (!/__/.test(inner)) {
          s = tail ? `${inner} ${tail}`.trim() : inner;
          changed = true;
          continue;
        }
      }
    }
    if (!changed) break;
  }
  return s;
}

/**
 * Only **uppercase Latin** markers in strict **A → B → C** order (see `strictUppercaseLetterSequence`).
 * Spaces allowed. Supports `A：` / `A:` plus `A.` `A)`. Dot/paren allow zero whitespace before body (`A.📄`).
 *
 * Capture groups: [1] letter, [2] body
 *
 * @type {RegExp}
 */
const OPTION_LINE =
  /^\s*([A-Z])\s*(?:[：:]\s*|[.．]\s*|[\)）]\s*)(.+)$/u;

/**
 * Models often bold whole rows (`**A. foo**`) or prefix Markdown bullets (`- A.` / `- **A.**`).
 * Applied before `OPTION_LINE`; not a full Markdown parser.
 *
 * @param {string} line
 */
function normalizeChoiceCandidateLine(line) {
  let t = String(line ?? "").trim();
  if (!t) return "";

  const MAX = 12;
  for (let guard = 0; guard < MAX; guard++) {
    const prev = t;

    t = t.replace(/^\s*[-*+]\s*\[[ xX]\]\s+/, "");
    /** `- option` only when an uppercase lettered marker (or bold wrapper of one) follows. */
    t = t.replace(/^\s*[-*+]\s+(?=(?:\*\*|__|[A-Z]))/, "").trimStart();

    /**
     * Strip Markdown ordered-list ordinals (`1.` / `12)` …) before the letter marker — not `A.` bullets.
     * Require whitespace after `.`/`)` so versions like `1.2.3` are untouched.
     */
    t = t.replace(/^\s*\d{1,2}\s*[.)]\s+(?=[A-Z*_])/u, "").trimStart();

    t = stripOuterDoubleEmphasis(t);

    if (t === prev) break;
  }

  return t;
}

/** @param {string} line */
function execOptionLine(line) {
  return OPTION_LINE.exec(normalizeChoiceCandidateLine(line));
}

/** @param {string} line */
function testOptionLine(line) {
  return !!execOptionLine(line);
}

/**
 * @param {RegExpExecArray | null} m
 */
function optionLineLetter(m) {
  return m?.[1] ?? "";
}

/**
 * @param {RegExpExecArray | null} m
 */
function optionLineBody(m) {
  return m?.[2] ?? "";
}

/**
 * Parsers reject peels unless every row is A, B, C, … in order.
 *
 * @param {string[]} optionLines
 */
function strictUppercaseLetterSequence(optionLines) {
  if (optionLines.length < 2 || optionLines.length > 26) return false;
  let expect = "A".charCodeAt(0);
  for (const line of optionLines) {
    const m = execOptionLine(line);
    if (!m) return false;
    const ch = optionLineLetter(m);
    if (ch.charCodeAt(0) !== expect) return false;
    expect += 1;
  }
  return true;
}

/** @param {string} line */
function isContinuationLine(line) {
  const t = line.trim();
  if (!t || testOptionLine(line)) return false;
  /** Never absorb Markdown block starts into a peeled "option" row. */
  if (/^\s*#{1,6}\s+/u.test(line)) return false;
  if (t.startsWith("|") || /^\|[^|\n]+\|[^|\n]+\|/.test(t)) return false;
  if (/^\s*[-_*]{3,}\s*$/.test(t) || /^[﹣－-]{3,}\s*$/.test(t)) return false;
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) return true;
  /** Streaming fragments only — do not use broad `\-` (would treat `---` HR as continuation). */
  if (t.length <= 28 && /^[0-9.~～％%\s]+$/.test(t)) return true;
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
      testOptionLine(out[out.length - 1]) &&
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
 * Content after `A.` / `1.` bullet lists ("另外…主题？", "你选一小句") sits below the bullets and
 * would otherwise block upward option scanning unless we peel it away first.
 *
 * @param {string} t trimmed
 */
function trailingSoftLineAfterChoices(t) {
  if (!t) return false;
  if (testOptionLine(t)) return false;

  /** Do not chew through long narrative paragraphs appended after selections. */

  if (t.length > 280) return false;

  /** Next structural block — belongs to markdown after the picker. */

  if (/^#{1,6}\s+\S/u.test(t)) return false;
  if (/^[-*]{3,}\s*$/.test(t) || /^_{3,}\s*$/.test(t)) return false;

  /** Do not truncate into code / tables accidentally. */

  if (t.startsWith("```")) return false;

  /** Continuation-ish numeric literals (streaming artifacts). */

  if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) return false;

  if (/^\|.+\|/.test(t)) return false;

  return true;
}

/**
 * Strip prose that chronologically sits *below* the last choice line (follow-up cues, “你选…”, tooling tags).
 *
 * Bounded loop so malformed messages cannot blow up trimming.
 *
 * @param {string[]} lines
 */
function stripTrailingEpilogueLines(lines) {
  const out = [...lines];
  const maxIterations = 96;
  let guard = 0;

  while (out.length > 0 && guard++ < maxIterations) {
    while (out.length > 0 && !out[out.length - 1]?.trim()) {
      out.pop();
    }
    if (!out.length) break;
    const last = /** @type {string} */ (out[out.length - 1]);
    if (testOptionLine(last)) break;
    const t = last.trim();
    if (!trailingSoftLineAfterChoices(t)) break;
    out.pop();
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

/**
 * Closing `*` from Markdown emphasis often hides a trailing clause colon on the same logical line (`**我需要明确：**`).
 * Strip only trailing stars here — not full inline parsing.
 * @param {string} line
 */
function stripTrailingMarkdownStars(line) {
  return String(line ?? "").trimEnd().replace(/\*+\s*$/, "").trimEnd();
}

/** @param {string} line */
function stripListBulletForBody(line) {
  const m = execOptionLine(String(line ?? ""));
  return m ? optionLineBody(m) : String(line ?? "");
}

/** @param {string} beforeText */
function looksLikeChoicePrompt(beforeText) {
  const t = String(beforeText ?? "").trim();
  if (!t) return false;
  const lines = t.split(/\r?\n/).filter((l) => l.trim());

  /** Colon/question cue on scaffold lines immediately above A/B/C (often wrapped in bold). */
  const tailWindow = lines.slice(-3).map(stripTrailingMarkdownStars);

  const tailCue = tailWindow.some((ln) => {
    if (!ln) return false;
    if (/[?？]\s*$/.test(ln)) return true;
    if (/[:：]\s*$/.test(ln)) {
      const head = stripInlineMd(ln)
        .replace(/[:：]\s*$/, "")
        .trim();
      const hasChoiceCue = /(?:选|哪[个项种样型一]|是否|还是|或者)/.test(head);
      if (head.length <= 18 && !hasChoiceCue) return false;
      return true;
    }
    return false;
  });
  if (tailCue) return true;

  return /(?:选项|具体(?:如下|说明)|选一个|下面这些|以下几(?:个|项|点|种)|以下(?:哪个|哪项|哪种|选择|选项|这些|几[种个])|如下(?:哪个|哪项|哪种)|任选|选择|选取|方案|哪种|哪一种|哪样|哪项|是否|建议|推荐|还是|或者|哪一个|单选题|多选题|选择题|会选哪个|选哪个|你想选|请(?:你|您)?(?:选择|选|从|确认|告知|补充)|which|choose|select|pick|prefer|option|would you|could you|either|multiple\s*choice|mcq)/i.test(
    t,
  );
}

/** @param {string} line */
function listMarkerBadge(line) {
  const m = execOptionLine(String(line ?? ""));
  return m ? optionLineLetter(m) : "·";
}

/**
 * Letter options in one paragraph: `A: foo B: bar` or `A. foo B. bar`
 *
 * @param {string} block
 * @returns {{ optionLines: string[]; beforeText: string } | null}
 */
function tryParseInlineLetterBlock(block) {
  const re = /(?:^|[^\dA-Za-z])([A-Z])\s*(?:[：:]\s*|[.．]\s*|[\)）]\s*)/g;
  /** @type {{ index: number; letter: string }[]} */
  const hits = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const letter = m[1];
    const idx = m.index + m[0].indexOf(letter ?? "");
    hits.push({ index: idx, letter: letter ?? "" });
  }
  if (hits.length < 2 || hits.length > 8) return null;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].letter !== String.fromCharCode(65 + i)) return null;
  }

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
 * Prose above a list: user must *fill in* several fields (not pick one mutually exclusive option).
 * @param {string} beforeText
 */
function looksLikeInformationGatheringPrompt(beforeText) {
  const t = String(beforeText ?? "").trim();
  if (!t) return false;
  return /(?:需要(?:你|您)?提供|请你?(?:提供|补充|填写)|请(?:把|将|帮忙).{0,16}(?:信息|资料|内容)|提供以下(?:信息|资料|几点|内容)|以下几(?:项|点)(?:信息|资料|内容|问题)|补充(?:一下)?(?:信息|资料|内容)|告知我|说一下(?:你的|一下)?(?:需求|想法)|请回答(?:以下|下列)|按照(?:以下|下面)(?:格式|要点)|麻烦(?:你|您)?(?:提供|补充|填写)|先.{0,6}(?:提供|补充|说明))/.test(
    t,
  );
}

/**
 * One row in a "fill these fields" list (not the same as a trivia MCQ option).
 * @param {string} text stripped label body
 */
function lineLooksLikeQuestionnaireField(text) {
  const s = String(text ?? "").trim();
  if (!s) return false;
  if (/[?？]\s*$/.test(s)) return true;
  if (
    /(什么|哪些|哪[个些种类型类]|谁|如何|怎么|为何|是否|有没有|能不能|要不要|行不行|多少|几[页张个条项遍]|是否要|需不需要|喜欢哪|给谁)/.test(
      s,
    )
  ) {
    return true;
  }
  // e.g. "内容要求 — 必须包含/不能出现的内容"
  if (
    /[—–]/.test(s) &&
    /(?:必须|需要|不能|包含|排除|说明|描述|限制|偏好)/.test(s)
  ) {
    return true;
  }
  return false;
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
    const m = execOptionLine(line);
    const rest = m ? optionLineBody(m) : line;
    const text = stripInlineMd(rest);
    if (!text) continue;
    if (lineLooksLikeQuestionnaireField(text)) questionLike++;
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
    const m = execOptionLine(line);
    const rest = m ? optionLineBody(m) : line;
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
 * Option text accidentally merged with doc blocks (headings / pipe tables) — reject whole peel.
 *
 * @param {string} rest body after `A:` / `A.` etc.
 */
function enumeratedRestLooksLikeStructuredMarkdown(rest) {
  const s = String(rest ?? "");
  if (/#{1,6}\s+\S/u.test(s)) return true;
  if (/\|[^|\r\n]+(?:\|[^|\r\n]+){2,}/.test(s)) return true;
  if (/\|[\s\-:|]{2,}\|/.test(s)) return true;
  return false;
}

/**
 * @param {string[]} optionLines
 * @param {string} beforeText prose chronologically above the list (disambiguate MCQ vs fill-in)
 * @returns {{ kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> } | { kind: "questionnaire"; items: Array<{ id: string; prompt: string; badge: string }> } | null}
 */
function interactiveFromOptionLines(optionLines, beforeText = "") {
  if (!strictUppercaseLetterSequence(optionLines)) return null;
  for (const line of optionLines) {
    const m = execOptionLine(line);
    const rest = m ? optionLineBody(m) : line;
    if (enumeratedRestLooksLikeStructuredMarkdown(rest)) return null;
  }
  if (looksLikeInformationGatheringPrompt(beforeText)) {
    const items = buildQuestionnaireItems(optionLines);
    return items.length >= 2 ? { kind: "questionnaire", items } : null;
  }
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
    const m = execOptionLine(line);
    const rest = m ? optionLineBody(m) : line;
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
 * Strip the assistant's bottom-most contiguous A→B→C list (`A:`/`A：`/`A.`/`A)` …).
 * Questionnaires peel as a terminal tier only (no layering with earlier choice tiers).
 * @param {string} cleaned
 * @returns {{
 *   precedingText: string;
 *   interactive:
 *     | { kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> }
 *     | { kind: "questionnaire"; items: Array<{ id: string; prompt: string; badge: string }> };
 * } | null}
 */
function peelTrailingMultilineInteractive(cleaned) {
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
    const normalizedLine = normalizeChoiceCandidateLine(line);
    if (!OPTION_LINE.exec(normalizedLine)) break;
    optionLines.unshift(normalizedLine);
    i--;
  }

  if (optionLines.length < 2 || optionLines.length > 8) return null;

  const beforeLines = lines.slice(0, i + 1);
  const beforeText = beforeLines.join("\n").trimEnd();
  if (!looksLikeChoicePrompt(beforeText)) return null;

  const interactive = interactiveFromOptionLines(optionLines, beforeText);
  if (!interactive) return null;

  return { precedingText: beforeText, interactive };
}

/**
 * @param {string} cleaned
 */
function parseFromMultilineList(cleaned) {
  /** @type {Array<{ kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> }>} */
  const choiceStages = [];
  let work = String(cleaned ?? "");
  let guard = 0;

  while (work.trim() && guard++ < 12) {
    const hit = peelTrailingMultilineInteractive(work);
    if (!hit) break;

    if (hit.interactive.kind !== "choice") {
      if (choiceStages.length === 0) return hit.interactive;
      break;
    }

    choiceStages.unshift(hit.interactive);
    const trimmedWork = work.trimEnd();
    const nextWork = hit.precedingText.trimEnd();
    if (nextWork.length >= trimmedWork.length) break;
    work = nextWork;
  }

  if (choiceStages.length === 0) return null;
  if (choiceStages.length === 1) return choiceStages[0];

  return {
    kind: "choice_sequence",
    stages: choiceStages.map((s, tierIdx) => ({
      id: `qrseq-tier${tierIdx}-${s.options.map((o) => o.id).join("\x1e")}`,
      options: s.options,
    })),
  };
}

/**
 * @param {string} markdownRemainder
 * @returns {{
 *   interactive:
 *     | { kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> }
 *     | { kind: "questionnaire"; items: Array<{ id: string; prompt: string; badge: string }> };
 *   leftover: string;
 * } | null}
 */
function peelTrailingInlineInteractive(markdownRemainder) {
  const trimmedBlock = String(markdownRemainder ?? "").trim();
  const paras = trimmedBlock
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return null;

  /** @type {(block: string, promptPrefix: string) => ReturnType<typeof interactiveFromOptionLines>} */
  const tryWithPrompt = (block, promptPrefix) => {
    const letter = tryParseInlineLetterBlock(block);
    if (letter) {
      const prompt = `${promptPrefix}\n${letter.beforeText}`.trim();
      if (looksLikeChoicePrompt(prompt)) return interactiveFromOptionLines(letter.optionLines, prompt);
    }
    return null;
  };

  const last = paras[paras.length - 1];
  const beforeLast = paras.length > 1 ? paras.slice(0, -1).join("\n\n") : "";
  let built = tryWithPrompt(last, beforeLast);
  let leftover = built ? beforeLast.trimEnd() : trimmedBlock;

  if (!built && paras.length >= 2) {
    const lastTwo = `${paras[paras.length - 2]}\n\n${paras[paras.length - 1]}`;
    const beforeLastTwo = paras.length > 2 ? paras.slice(0, -2).join("\n\n") : "";
    built = tryWithPrompt(lastTwo, beforeLastTwo);
    if (built) leftover = beforeLastTwo.trimEnd();
  }

  if (!built) {
    built = tryWithPrompt(trimmedBlock, "");
    if (built) leftover = "";
  }

  if (!built) return null;

  const trimmedRemainder = trimmedBlock.trimEnd();
  const trimmedLeftover = leftover.trimEnd();
  if (trimmedLeftover.length >= trimmedRemainder.length) return null;

  return { interactive: built, leftover: trimmedLeftover };
}

/**
 * @param {string} cleaned
 */
function parseSequentialInlineStacks(cleaned) {
  /** @type {Array<{ kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> }>} */
  const tiers = [];
  let work = String(cleaned ?? "").trimEnd();
  let guard = 0;

  while (work.trim() && guard++ < 12) {
    const hit = peelTrailingInlineInteractive(work);
    if (!hit?.interactive) break;

    if (hit.interactive.kind !== "choice") {
      if (tiers.length === 0) return hit.interactive;
      break;
    }

    tiers.unshift(hit.interactive);

    const trimmedWork = work.trimEnd();
    const nextWork = hit.leftover.trimEnd();
    if (nextWork.length >= trimmedWork.length) break;
    work = nextWork;
    if (!work.trim()) break;
  }

  if (tiers.length === 0) return null;
  if (tiers.length === 1) return tiers[0];

  return {
    kind: "choice_sequence",
    stages: tiers.map((s, tierIdx) => ({
      id: `qrseq-inline-tier${tierIdx}-${s.options.map((o) => o.id).join("\x1e")}`,
      options: s.options,
    })),
  };
}

/**
 * @param {string | undefined} markdown
 * @returns
 *   | { kind: "choice"; options: Array<{ id: string; label: string; sendText: string; badge: string }> }
 *   | { kind: "choice_sequence"; stages: Array<{ id: string; options: Array<{ id: string; label: string; sendText: string; badge: string }> }> }
 *   | { kind: "questionnaire"; items: Array<{ id: string; prompt: string; badge: string }> }
 *   | null
 */
export function parseAssistantQuickReplies(markdown) {
  const raw = String(markdown ?? "");
  let cleaned = normalizeBoldChoiceMarkers(stripFencedCodeBlocks(raw));
  cleaned = stripGFMPipeTableLines(cleaned);

  const multiline = parseFromMultilineList(cleaned);
  if (multiline) return multiline;

  return parseSequentialInlineStacks(cleaned);
}

/** @param {Array<string>} repliesInTierOrder one reply per tier, top-to-bottom chat order */
export function formatChoiceSequenceReply(repliesInTierOrder) {
  return repliesInTierOrder
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}
