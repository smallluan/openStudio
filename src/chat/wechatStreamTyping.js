/** Best-effort WeChat "typing" (对方正在输入) — failures are ignored. */

/**
 * @param {string} peerId
 * @param {1 | 2} [status] 1 = typing, 2 = stop
 */
export function sendWechatTypingStatus(peerId, status = 1) {
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const pid = String(peerId ?? "").trim();
  if (!pid || !bridge?.wechatSendTyping) return;
  void bridge.wechatSendTyping({ peerId: pid, status }).catch(() => {
    /* non-blocking */
  });
}

/**
 * @param {string} peerId
 * @returns {() => void} stop + clear interval
 */
export function startWechatTypingPulse(peerId) {
  sendWechatTypingStatus(peerId, 1);
  const tid = window.setInterval(() => sendWechatTypingStatus(peerId, 1), 4_000);
  return () => {
    window.clearInterval(tid);
    sendWechatTypingStatus(peerId, 2);
  };
}
