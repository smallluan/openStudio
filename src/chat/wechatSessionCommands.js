/** WeChat channel command: start a fresh UI thread (no gateway auto-reply for the command itself). */
export const WECHAT_NEW_CHAT_COMMAND = "new_chat";

/** @param {unknown} text @returns {boolean} */
export function isWechatNewChatCommand(text) {
  return String(text ?? "").trim() === WECHAT_NEW_CHAT_COMMAND;
}
