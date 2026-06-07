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
 * Base64 payload for OpenClaw `chat.send` attachments (no `data:` prefix).
 * @param {string} dataUrl
 */
export function base64FromImageDataUrl(dataUrl) {
  const s = typeof dataUrl === "string" ? dataUrl : "";
  const m = /^data:[^;]+;base64,([\s\S]*)$/.exec(s);
  return m ? m[1].replace(/\s+/g, "") : "";
}

/**
 * OpenClaw-compatible attachment rows (`parseMessageWithAttachments` / RPC normalize).
 * @param {Array<{ mime: string; name?: string; dataUrl: string }> | undefined} attachments
 * @returns {Array<{ mimeType: string; fileName: string; content: string }> | undefined}
 */
export function openClawAttachmentsFromComposer(attachments) {
  const imgs = Array.isArray(attachments) ? attachments : [];
  const out = [];
  for (let i = 0; i < imgs.length; i++) {
    const a = imgs[i];
    const dataUrl = typeof a?.dataUrl === "string" ? a.dataUrl : "";
    if (!dataUrl.startsWith("data:image/")) continue;
    const content = base64FromImageDataUrl(dataUrl);
    if (!content) continue;
    const mime = typeof a.mime === "string" && a.mime.startsWith("image/") ? a.mime : "image/png";
    const name =
      typeof a.name === "string" && a.name.trim()
        ? a.name.trim()
        : imgs.length === 1
          ? "image.png"
          : `image-${i + 1}.png`;
    out.push({ mimeType: mime, fileName: name, content });
  }
  return out.length ? out : undefined;
}

/**
 * Plain-text user line for gateway history / `chat.send` (never inline base64).
 * Images are sent via `attachments` on the pending user row only — see {@link openClawAttachmentsFromComposer}.
 * @param {unknown} text
 * @param {Array<{ dataUrl?: string }> | undefined} attachments
 */
export function gatewayUserMessageBody(text, attachments) {
  const t = String(text ?? "").trim();
  const imgs = Array.isArray(attachments) ? attachments : [];
  let n = 0;
  for (const a of imgs) {
    const url = typeof a?.dataUrl === "string" ? a.dataUrl : "";
    if (url.startsWith("data:image/")) n++;
  }
  if (n === 0) return t;
  const note = n === 1 ? "[1 image attached]" : `[${n} images attached]`;
  if (!t) return note;
  return `${t}\n\n${note}`;
}

/** @param {number} chars */
export function approxTokensFromChars(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * Rough char budget for images in context meter.
 * History turns only resend a short "[N images attached]" note — not base64 again.
 * @param {Array<{ dataUrl?: string }> | undefined} attachments
 * @param {{ includePayload?: boolean }} [opts]
 */
export function imageAttachmentsContextChars(attachments, opts = {}) {
  const includePayload = opts.includePayload === true;
  const imgs = Array.isArray(attachments) ? attachments : [];
  let count = 0;
  let payloadChars = 0;
  for (const a of imgs) {
    const url = typeof a?.dataUrl === "string" ? a.dataUrl : "";
    if (!url.startsWith("data:image/")) continue;
    count++;
    if (includePayload) payloadChars += url.length;
  }
  if (count === 0) return 0;
  if (includePayload) return payloadChars;
  return count === 1 ? "[1 image attached]".length : `[${count} images attached]`.length;
}

/**
 * @param {Array<{ role?: string; content?: string; thinking?: string; error?: unknown; imageAttachments?: unknown }>} threadMessages
 * @param {{ systemPromptLen: number; inputLen: number; pendingImagePayloadChars?: number }} extra
 */
export function estimateThreadCharBudget(threadMessages, extra) {
  let n = Math.max(0, extra.systemPromptLen) + Math.max(0, extra.inputLen);
  n += Math.max(0, extra.pendingImagePayloadChars ?? 0);
  for (const m of threadMessages) {
    if (!m || typeof m !== "object") continue;
    if (m.error) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    n += String(m.content ?? "").length;
    n += String(m.thinking ?? "").length;
    n += imageAttachmentsContextChars(m.imageAttachments);
  }
  return n;
}
