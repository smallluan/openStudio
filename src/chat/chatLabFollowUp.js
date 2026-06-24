/** Follow-up quote reference utilities and navigation. */

const SELECTABLE_SELECTOR =
  ".chat-lab__bubble, .chat-lab__md, .chat-lab__assistant-timeline, .trace-disclosure__trigger, .chat-lab__tool-chain-body, .chat-lab__tool-nested-body";

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
export function followUpPreviewText(text, maxLen = 48) {
  const oneLine = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!oneLine) return "";
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * @param {unknown} raw
 * @returns {MessageFollowUpRef | undefined}
 */
export function sanitizeFollowUpRef(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const sourceMessageId =
    typeof raw.sourceMessageId === "string" ? raw.sourceMessageId.trim().slice(0, 96) : "";
  const quoteText = typeof raw.quoteText === "string" ? raw.quoteText.trim().slice(0, 2000) : "";
  const agentName = typeof raw.agentName === "string" ? raw.agentName.trim().slice(0, 80) : "";
  const sourceRole = raw.sourceRole === "user" || raw.sourceRole === "assistant" ? raw.sourceRole : null;
  if (!sourceMessageId || !quoteText || !agentName || !sourceRole) return undefined;
  const sourceAgentId =
    typeof raw.sourceAgentId === "string" && raw.sourceAgentId.trim()
      ? raw.sourceAgentId.trim().slice(0, 96)
      : undefined;
  return {
    sourceMessageId,
    sourceRole,
    ...(sourceAgentId ? { sourceAgentId } : {}),
    agentName,
    quoteText,
  };
}

/**
 * @param {Node | null} node
 * @param {number} offset
 * @returns {DOMRect | null}
 */
function getCaretClientRect(node, offset) {
  if (!node) return null;
  try {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return null;
    return DOMRect.fromRect({
      x: rect.left,
      y: rect.top,
      width: Math.max(rect.width, 2),
      height: Math.max(rect.height, 18),
    });
  } catch {
    return null;
  }
}

/**
 * @param {DOMRectReadOnly} caretRect
 * @returns {DOMRect}
 */
function caretAnchorRect(caretRect) {
  return DOMRect.fromRect({
    x: caretRect.x,
    y: caretRect.y,
    width: Math.max(caretRect.width, 2),
    height: Math.max(caretRect.height, 18),
  });
}

/**
 * Pick popup side/alignment from selection direction (focus = where the user ended).
 *
 * @param {DOMRectReadOnly} anchorCaret
 * @param {DOMRectReadOnly} focusCaret
 * @returns {import("@floating-ui/react").Placement}
 */
export function resolveSelectionToolbarPlacement(anchorCaret, focusCaret) {
  const dy = focusCaret.top - anchorCaret.top;
  const dx = focusCaret.left - anchorCaret.left;
  const vertical = dy > 1 ? "bottom" : dy < -1 ? "top" : "bottom";
  const horizontal = dx >= 0 ? "end" : "start";
  return /** @type {import("@floating-ui/react").Placement} */ (`${vertical}-${horizontal}`);
}

/**
 * @param {import("@floating-ui/react").Placement} placement
 * @returns {import("@floating-ui/react").Placement[]}
 */
export function selectionToolbarFlipFallbacks(placement) {
  const [side, align] = /** @type {[string, string]} */ (placement.split("-"));
  const opposite = side === "bottom" ? "top" : "bottom";
  const oppositeAlign = align === "end" ? "start" : "end";
  return /** @type {import("@floating-ui/react").Placement[]} */ ([
    `${opposite}-${align}`,
    `${side}-${oppositeAlign}`,
    `${opposite}-${oppositeAlign}`,
  ]);
}

/**
 * @returns {{
 *   text: string;
 *   rect: DOMRect;
 *   popupAnchorRect: DOMRect;
 *   placement: import("@floating-ui/react").Placement;
 * } | null}
 */
export function readChatTextSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;

  const anchorNode = sel.anchorNode;
  const focusNode = sel.focusNode;
  if (!anchorNode || !focusNode) return null;

  /** @param {Node} node */
  const asElement = (node) =>
    node.nodeType === Node.TEXT_NODE ? node.parentElement : /** @type {Element} */ (node);

  const anchorEl = asElement(anchorNode);
  const focusEl = asElement(focusNode);
  if (!anchorEl?.closest(SELECTABLE_SELECTOR) || !focusEl?.closest(SELECTABLE_SELECTOR)) return null;

  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return null;

  const anchorCaret = getCaretClientRect(anchorNode, sel.anchorOffset);
  const focusCaret = getCaretClientRect(focusNode, sel.focusOffset);
  const placement =
    anchorCaret && focusCaret
      ? resolveSelectionToolbarPlacement(anchorCaret, focusCaret)
      : /** @type {const} */ ("bottom-end");
  const popupAnchorRect = focusCaret ? caretAnchorRect(focusCaret) : rect;

  return { text, rect, popupAnchorRect, placement };
}

/**
 * @returns {({
 *   quoteText: string;
 *   sourceMessageId: string;
 *   sourceRole: "user" | "assistant";
 *   sourceAgentId?: string | null;
 * } | null)}
 */
export function resolveFollowUpFromSelection() {
  const hit = readChatTextSelection();
  if (!hit) return null;

  const sel = window.getSelection();
  const anchorNode = sel?.anchorNode;
  if (!anchorNode) return null;

  /** @param {Node} node */
  const asElement = (node) =>
    node.nodeType === Node.TEXT_NODE ? node.parentElement : /** @type {Element} */ (node);

  const msgEl = asElement(anchorNode)?.closest("[data-message-id]");
  if (!msgEl) return null;

  const sourceMessageId = msgEl.getAttribute("data-message-id") ?? "";
  const sourceRole = msgEl.getAttribute("data-message-role");
  if (!sourceMessageId || (sourceRole !== "user" && sourceRole !== "assistant")) return null;

  const sourceAgentId = msgEl.getAttribute("data-message-agent-id");

  return {
    quoteText: hit.text,
    sourceMessageId,
    sourceRole,
    ...(sourceAgentId ? { sourceAgentId } : {}),
  };
}

/**
 * @param {string} body
 * @param {MessageFollowUpRef | null | undefined} followUpRef
 */
export function appendFollowUpToGatewayBody(body, followUpRef) {
  const base = String(body ?? "").trim();
  if (!followUpRef?.quoteText) return base;
  const block = `【追问引用 · ${followUpRef.agentName}】\n「${followUpRef.quoteText}」`;
  return base ? `${block}\n\n${base}` : block;
}

/**
 * @param {HTMLElement} root
 */
function clearFollowUpHighlights(root) {
  root.querySelectorAll("mark.chat-lab__follow-up-highlight").forEach((node) => {
    const mark = /** @type {HTMLElement} */ (node);
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * @param {string} full
 * @param {string} needle
 * @returns {{ start: number; end: number } | null}
 */
function findQuoteSpan(full, needle) {
  const direct = full.indexOf(needle);
  if (direct >= 0) return { start: direct, end: direct + needle.length };

  const compactNeedle = needle.replace(/\s+/g, "");
  const compactFull = full.replace(/\s+/g, "");
  if (compactNeedle.length >= 8) {
    const compactIdx = compactFull.indexOf(compactNeedle);
    if (compactIdx >= 0) {
      return mapCompactSpanToFull(full, compactIdx, compactNeedle.length);
    }
  }

  const words = needle.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  let searchFrom = 0;
  let startPos = -1;
  let endPos = -1;
  for (let wi = 0; wi < words.length; wi++) {
    const found = full.indexOf(words[wi], searchFrom);
    if (found < 0) return null;
    if (wi === 0) startPos = found;
    endPos = found + words[wi].length;
    searchFrom = endPos;
  }
  return startPos >= 0 ? { start: startPos, end: endPos } : null;
}

/**
 * Map a span in whitespace-stripped text back to indices in the original string.
 * @param {string} full
 * @param {number} compactStart
 * @param {number} compactLen
 */
function mapCompactSpanToFull(full, compactStart, compactLen) {
  let compactPos = 0;
  let fullStart = -1;
  let fullEnd = -1;
  for (let i = 0; i < full.length && compactPos < compactStart + compactLen; i++) {
    if (/\s/.test(full[i])) continue;
    if (compactPos === compactStart) fullStart = i;
    compactPos++;
    if (compactPos === compactStart + compactLen) {
      fullEnd = i + 1;
      break;
    }
  }
  if (fullStart < 0 || fullEnd < 0) return null;
  return { start: fullStart, end: fullEnd };
}

/**
 * @param {HTMLElement} root
 * @param {string} quoteText
 * @returns {HTMLElement | null}
 */
function wrapFirstQuoteMatch(root, quoteText) {
  const needle = String(quoteText ?? "").trim();
  if (!needle) return null;

  /** @type {Text[]} */
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent?.closest("mark.chat-lab__follow-up-highlight")) return NodeFilter.FILTER_REJECT;
      if (parent?.closest("textarea,input,select,code,pre,svg,[aria-hidden='true']")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let node = /** @type {Text | null} */ (walker.nextNode());
  while (node) {
    textNodes.push(node);
    node = /** @type {Text | null} */ (walker.nextNode());
  }

  let full = "";
  /** @type {{ node: Text; start: number; end: number }[]} */
  const spans = [];
  for (const tn of textNodes) {
    const chunk = tn.textContent ?? "";
    const start = full.length;
    full += chunk;
    spans.push({ node: tn, start, end: start + chunk.length });
  }

  const match = findQuoteSpan(full, needle);
  if (!match) return null;
  const { start: idx, end: endIdx } = match;

  const startSpan = spans.find((s) => idx >= s.start && idx < s.end);
  const endSpan = spans.find((s) => endIdx > s.start && endIdx <= s.end);
  if (!startSpan || !endSpan) return null;

  const range = document.createRange();
  range.setStart(startSpan.node, idx - startSpan.start);
  range.setEnd(endSpan.node, endIdx - endSpan.start);

  const mark = document.createElement("mark");
  mark.className = "chat-lab__follow-up-highlight";
  try {
    range.surroundContents(mark);
    return mark;
  } catch {
    try {
      const fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
      return mark;
    } catch {
      return null;
    }
  }
}

/**
 * @param {{
 *   sourceMessageId: string;
 *   quoteText: string;
 *   scrollContainer?: HTMLElement | null;
 * }} args
 */
export function navigateToFollowUpQuote({ sourceMessageId, quoteText, scrollContainer }) {
  const msgEl = document.querySelector(`[data-message-id="${CSS.escape(sourceMessageId)}"]`);
  if (!msgEl) return false;

  const bubble = msgEl.querySelector(".chat-lab__bubble");
  if (!bubble) return false;

  const scrollToMessage = () => {
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const msgRect = msgEl.getBoundingClientRect();
      const nextTop =
        scrollContainer.scrollTop + (msgRect.top - containerRect.top) - containerRect.height * 0.32;
      scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    } else {
      msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  scrollToMessage();

  window.setTimeout(() => {
    clearFollowUpHighlights(bubble);
    const mark = wrapFirstQuoteMatch(/** @type {HTMLElement} */ (bubble), quoteText);
    if (!mark) return;
    mark.scrollIntoView({ behavior: "smooth", block: "nearest" });
    window.setTimeout(() => {
      clearFollowUpHighlights(bubble);
    }, 2600);
  }, scrollContainer ? 320 : 180);

  return true;
}
