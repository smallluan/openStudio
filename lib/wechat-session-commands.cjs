/** WeChat channel command: arm a fresh UI thread on the next inbound message. */
const WECHAT_NEW_CHAT_COMMAND = "new_chat";
/** Auto-reply when `new_chat` is received (not stored or sent to the model). */
const WECHAT_NEW_CHAT_ACK_TEXT = "收到，接下来的对话将在新的会话中进行。";

/**
 * @param {unknown} text
 * @returns {boolean}
 */
function isWechatNewChatCommand(text) {
  return String(text ?? "").trim() === WECHAT_NEW_CHAT_COMMAND;
}

/**
 * @param {unknown} peerId
 * @returns {string}
 */
function sanitizeWechatPeerSegment(peerId) {
  return String(peerId ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 96);
}

/**
 * Default WeChat thread id for a peer (first conversation).
 * @param {unknown} peerId
 * @returns {string}
 */
function toWechatConversationId(peerId) {
  const safe = sanitizeWechatPeerSegment(peerId);
  return safe ? `wechat:${safe}` : `wechat:unknown`;
}

/**
 * Independent WeChat channel sidebar session (not the default `wechat:<peer>` thread).
 * @returns {string}
 */
function newWechatChannelSessionId() {
  let suffix;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    suffix = crypto.randomUUID();
  } else {
    suffix = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
  }
  return `wechat:thread:${suffix}`;
}

module.exports = {
  WECHAT_NEW_CHAT_COMMAND,
  WECHAT_NEW_CHAT_ACK_TEXT,
  isWechatNewChatCommand,
  sanitizeWechatPeerSegment,
  toWechatConversationId,
  newWechatChannelSessionId,
};
