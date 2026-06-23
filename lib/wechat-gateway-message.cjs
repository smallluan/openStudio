/** Max assistant prose re-sent in WeChat `chat.send` history embed. */
const WECHAT_HISTORY_ASSISTANT_MAX = 480;

/** Shown to the model instead of prior long assistant dumps on WeChat threads. */
const WECHAT_HISTORY_ASSISTANT_OMITTED =
  "[Prior assistant reply omitted on WeChat — file was delivered as attachment. Do not resend file bodies.]";

/** Hard stop generating assistant prose on WeChat after this many chars (saves output tokens). */
const WECHAT_ASSISTANT_OUTPUT_ABORT_AT = 1200;

/** Prefix injected into every WeChat `chat.send` user payload. */
const WECHAT_CHAT_SEND_PREFIX = `[WeChat channel rules]
- Deliver files by copying/moving them into the workspace (cp, mv, Copy-Item). Open Studio sends the file to the user's WeChat automatically.
- FORBIDDEN: read_file / cat / Get-Content / type on whole documents the user wants sent; never paste file bodies, paths-only replies, or "I cannot attach files".
- FORBIDDEN: markdown/HTML image syntax such as ![alt](url) or bare image URLs in replies — Open Studio extracts and sends each photo to WeChat separately.
- Reply in at most 2 short sentences. No summaries of file contents unless the user explicitly asks to analyze (not "send me the file").`;

/**
 * @param {string} content
 * @returns {string}
 */
function sanitizeWechatAssistantHistoryContent(content) {
  const t = String(content ?? "").trim();
  if (!t) return "";
  if (t.length <= WECHAT_HISTORY_ASSISTANT_MAX) return t;
  return WECHAT_HISTORY_ASSISTANT_OMITTED;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function shouldAbortWechatAssistantOutput(text) {
  return String(text ?? "").length >= WECHAT_ASSISTANT_OUTPUT_ABORT_AT;
}

module.exports = {
  WECHAT_HISTORY_ASSISTANT_MAX,
  WECHAT_HISTORY_ASSISTANT_OMITTED,
  WECHAT_ASSISTANT_OUTPUT_ABORT_AT,
  WECHAT_CHAT_SEND_PREFIX,
  sanitizeWechatAssistantHistoryContent,
  shouldAbortWechatAssistantOutput,
};
