/**
 * One-shot title synthesis via the same provider stack as llm-chat-stream (direct API, not OpenClaw gateway).
 */

const { dispatchStream } = require("./llm-chat-stream.cjs");

/** @param {string} raw */
function sanitizeTitle(raw) {
  let s = String(raw ?? "").trim();
  s = s.replace(/^["'`「『]|["'`」』]$/g, "");
  const line = s.split(/\r?\n/)[0] ?? "";
  return line.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * @param {unknown} cfg raw user config (includes credentials.providerApiKey)
 * @param {string} userFirstMessage
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function generateConversationTitle(cfg, userFirstMessage, signal) {
  const snippet = String(userFirstMessage ?? "").trim().slice(0, 8000);
  if (!snippet) throw new Error("empty_user_message");

  const systemPrompt =
    "You write ultra-short chat thread titles. Reply with the title text ONLY: no quotes, no bullets, " +
    "no preamble or explanation. Prefer the same language as the user. Max ~40 characters or ~18 Chinese characters.";

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Suggest a concise conversation title for this first user message:\n\n${snippet}`,
    },
  ];

  let text = "";
  /** @type {{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null} */
  let usage = null;
  await dispatchStream(cfg, messages, signal, (evt) => {
    if (evt.type === "text" && typeof evt.delta === "string") text += evt.delta;
    if (evt.type === "usage" && evt.usage && typeof evt.usage === "object") usage = evt.usage;
  });

  const title = sanitizeTitle(text);
  if (!title) throw new Error("empty_title_model_output");
  return { title, usage };
}

module.exports = { generateConversationTitle, sanitizeTitle };
