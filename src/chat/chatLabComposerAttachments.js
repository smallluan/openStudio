/** Composer / gateway helpers for Chat Lab image attachments. */

export const MAX_CHAT_COMPOSER_IMAGES = 8;
export const MAX_IMAGE_FILE_BYTES = 2 * 1024 * 1024;

/** Rough OpenAI-style token estimate from raw characters (incl. base64). */
export const CONTEXT_WINDOW_APPROX_TOKENS = 128000;

/** @returns {string} */
export function newComposerAttachmentId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `img_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * @param {File} file
 * @returns {Promise<{ id: string; name: string; mime: string; dataUrl: string }>}
 */
export function readImageFileAsComposerAttachment(file) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    return Promise.reject(new Error("invalid_image_type"));
  }
  if (typeof file.size === "number" && file.size > MAX_IMAGE_FILE_BYTES) {
    return Promise.reject(new Error("image_too_large"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) {
        reject(new Error("invalid_image_data"));
        return;
      }
      resolve({
        id: newComposerAttachmentId(),
        name: typeof file.name === "string" ? file.name : "image",
        mime: file.type,
        dataUrl,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {unknown} text
 * @param {Array<{ dataUrl: string }> | undefined} attachments
 */
export function gatewayContentFromUserParts(text, attachments) {
  const t = String(text ?? "").trim();
  const imgs = Array.isArray(attachments) ? attachments : [];
  if (imgs.length === 0) return t;
  const md = imgs
    .map((a, i) => {
      const url = typeof a?.dataUrl === "string" ? a.dataUrl : "";
      if (!url.startsWith("data:image/")) return "";
      return `![Attached image ${i + 1}](${url})`;
    })
    .filter(Boolean)
    .join("\n");
  if (!md) return t;
  return t ? `${t}\n\n${md}` : md;
}

/** @param {number} chars */
export function approxTokensFromChars(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * @param {Array<{ role?: string; content?: string; thinking?: string; error?: unknown; imageAttachments?: unknown }>} threadMessages
 * @param {{ systemPromptLen: number; inputLen: number }} extra
 */
export function estimateThreadCharBudget(threadMessages, extra) {
  let n = Math.max(0, extra.systemPromptLen) + Math.max(0, extra.inputLen);
  for (const m of threadMessages) {
    if (!m || typeof m !== "object") continue;
    if (m.error) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    n += String(m.content ?? "").length;
    n += String(m.thinking ?? "").length;
    const imgs = m.imageAttachments;
    if (Array.isArray(imgs)) {
      for (const a of imgs) {
        if (a && typeof a === "object" && typeof a.dataUrl === "string") n += a.dataUrl.length;
      }
    }
  }
  return n;
}
