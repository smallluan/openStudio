/** Keep in sync with lib/wechat-gateway-message.cjs */

const WECHAT_HISTORY_ASSISTANT_MAX = 480;

const WECHAT_HISTORY_ASSISTANT_OMITTED =
  "[Prior assistant reply omitted on WeChat — file was delivered as attachment. Do not resend file bodies.]";

/**
 * @param {string} content
 * @returns {string}
 */
export function sanitizeWechatAssistantHistoryContent(content) {
  const t = String(content ?? "").trim();
  if (!t) return "";
  if (t.length <= WECHAT_HISTORY_ASSISTANT_MAX) return t;
  return WECHAT_HISTORY_ASSISTANT_OMITTED;
}

/**
 * @param {import("./chatSessionsStore.js").PersistedChatMessage} message
 * @returns {string}
 */
export function wechatGatewayAssistantContent(message) {
  const content = String(message?.content ?? "").trim();
  if (Array.isArray(message?.fileRefs) && message.fileRefs.length > 0 && content.length > WECHAT_HISTORY_ASSISTANT_MAX) {
    return WECHAT_HISTORY_ASSISTANT_OMITTED;
  }
  return sanitizeWechatAssistantHistoryContent(content);
}
