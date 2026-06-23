/**
 * Base + image-display rules sent to the gateway as the Chat Lab system row.
 * @param {(key: string) => string} t
 */
export function composeChatLabSystemPrompt(t) {
  const base = String(t("chatLab.systemPrompt") ?? "").trim();
  const image = String(t("chatLab.imageDisplayPrompt") ?? "").trim();
  if (!image) return base;
  if (!base) return image;
  return `${base}\n\n${image}`;
}
