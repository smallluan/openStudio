import { followUpPreviewText } from "./chatLabFollowUp.js";

/** Distance from top/bottom (px) before scroll jump buttons appear. */
export const CHAT_THREAD_SCROLL_EDGE_PX = 120;

/**
 * @param {HTMLElement} el
 * @param {number} targetTop
 * @param {number} [durationMs]
 */
export function animateScrollTop(el, targetTop, durationMs = 420) {
  const startTop = el.scrollTop;
  const delta = targetTop - startTop;
  if (!Number.isFinite(delta) || Math.abs(delta) < 2) {
    el.scrollTop = targetTop;
    return;
  }
  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = 1 - (1 - progress) ** 3;
    el.scrollTop = startTop + delta * eased;
    if (progress < 1) requestAnimationFrame(tick);
    else el.scrollTop = targetTop;
  };
  requestAnimationFrame(tick);
}

/** @typedef {{
 *   mode: "plain" | "virtual";
 *   messageCount: number;
 *   scrollToIndex: (
 *     index: number,
 *     opts?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior },
 *   ) => void;
 *   pinToBottom: () => void;
 *   scrollToBottom: (opts?: { animated?: boolean }) => void;
 *   getActiveUserMessageId: () => string | null;
 * }} ChatLabThreadScrollApi */

/**
 * @param {HTMLElement | null} el
 */
export function getThreadScrollMetrics(el) {
  if (!el) {
    return { atTop: true, atBottom: true, canScroll: false };
  }
  const scrollRange = el.scrollHeight - el.clientHeight;
  const canScroll = Number.isFinite(scrollRange) && scrollRange > 1;
  const atTop = el.scrollTop <= CHAT_THREAD_SCROLL_EDGE_PX;
  const atBottom = scrollRange - el.scrollTop <= CHAT_THREAD_SCROLL_EDGE_PX;
  return { atTop, atBottom, canScroll };
}

/**
 * @param {unknown[]} messages
 * @param {number} [previewLen]
 */
export function buildUserTurnAnchors(messages, previewLen = 28) {
  if (!Array.isArray(messages)) return [];
  /** @type {{ id: string; index: number; turn: number; preview: string }[]} */
  const anchors = [];
  let turn = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    turn += 1;
    const preview = followUpPreviewText(message.content, previewLen) || "…";
    anchors.push({
      id: String(message.id ?? ""),
      index,
      turn,
      preview,
    });
  }
  return anchors;
}

/**
 * @param {unknown[]} messages
 * @param {HTMLElement | null} scrollContainer
 * @param {number} [anchorOffsetPx]
 */
export function findActiveUserMessageId(messages, scrollContainer, anchorOffsetPx = 88) {
  if (!scrollContainer || !Array.isArray(messages) || messages.length === 0) return null;
  const anchorY = scrollContainer.getBoundingClientRect().top + anchorOffsetPx;
  /** @type {string | null} */
  let activeId = null;
  for (const message of messages) {
    if (!message || message.role !== "user") continue;
    const id = String(message.id ?? "");
    if (!id) continue;
    const el = scrollContainer.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    if (top <= anchorY) activeId = id;
    else break;
  }
  return activeId;
}

/**
 * @param {unknown[]} messages
 * @param {HTMLElement | null} scrollContainer
 * @param {import("@tanstack/react-virtual").Virtualizer<HTMLElement, Element>} virtualizer
 * @param {number} [anchorOffsetPx]
 */
export function findActiveUserMessageIdVirtual(
  messages,
  scrollContainer,
  virtualizer,
  anchorOffsetPx = 88,
) {
  if (!scrollContainer || !Array.isArray(messages) || messages.length === 0) return null;
  const anchorY = scrollContainer.getBoundingClientRect().top + anchorOffsetPx;
  /** @type {string | null} */
  let activeId = null;
  for (const item of virtualizer.getVirtualItems()) {
    const message = messages[item.index];
    if (!message || message.role !== "user") continue;
    const row = scrollContainer.querySelector(`[data-index="${item.index}"]`);
    if (!row) continue;
    const top = row.getBoundingClientRect().top;
    if (top <= anchorY) activeId = String(message.id ?? "");
  }
  return activeId;
}

/**
 * @param {{
 *   messageId: string;
 *   messageIndex: number;
 *   scrollContainer?: HTMLElement | null;
 *   scrollApi?: ChatLabThreadScrollApi | null;
 * }} args
 */
export function scrollThreadToMessage({ messageId, messageIndex, scrollContainer, scrollApi }) {
  if (scrollApi?.scrollToIndex && messageIndex >= 0) {
    scrollApi.scrollToIndex(messageIndex, { align: "start", behavior: "smooth" });
    return true;
  }
  const msgEl = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!msgEl || !scrollContainer) return false;
  const containerRect = scrollContainer.getBoundingClientRect();
  const msgRect = msgEl.getBoundingClientRect();
  const nextTop = scrollContainer.scrollTop + (msgRect.top - containerRect.top) - 72;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  return true;
}

/**
 * @param {HTMLElement | null} scrollContainer
 * @param {ChatLabThreadScrollApi | null | undefined} scrollApi
 * @param {import("react").MutableRefObject<boolean> | undefined} autoScrollRef
 */
export function scrollThreadToTop(scrollContainer, scrollApi) {
  if (scrollApi?.scrollToIndex) {
    scrollApi.scrollToIndex(0, { align: "start", behavior: "smooth" });
    return;
  }
  scrollContainer?.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * @param {HTMLElement | null} scrollContainer
 * @param {ChatLabThreadScrollApi | null | undefined} scrollApi
 * @param {import("react").MutableRefObject<boolean> | undefined} autoScrollRef
 */
export function scrollThreadToBottom(scrollContainer, scrollApi, autoScrollRef) {
  if (autoScrollRef) autoScrollRef.current = true;
  if (scrollApi?.scrollToBottom) {
    scrollApi.scrollToBottom({ animated: true });
    return;
  }
  if (scrollApi?.scrollToIndex && scrollApi.messageCount > 0) {
    scrollApi.scrollToIndex(scrollApi.messageCount - 1, {
      align: "end",
      behavior: "smooth",
    });
    return;
  }
  if (!scrollContainer) return;
  scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
}
