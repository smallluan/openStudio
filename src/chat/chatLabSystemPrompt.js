/**
 * Image + chart display rules appended to agent system rows (Open Studio UI rendering).
 * @param {(key: string) => string} t
 */
export function composeChatLabStudioSuffix(t) {
  const parts = [
    String(t("chatLab.imageDisplayPrompt") ?? "").trim(),
    String(t("chatLab.chartDisplayPrompt") ?? "").trim(),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Base + image/chart display rules sent to the gateway as the Chat Lab system row.
 * @param {(key: string) => string} t
 */
export function composeChatLabSystemPrompt(t) {
  const parts = [
    String(t("chatLab.systemPrompt") ?? "").trim(),
    composeChatLabStudioSuffix(t),
  ].filter(Boolean);
  return parts.join("\n\n");
}
