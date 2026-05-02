/**
 * @param {(k: string, v?: Record<string, string | number>) => string} t
 * @param {number} updatedAt epoch ms
 */
export function formatSessionRelativeTime(t, updatedAt) {
  const sec = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (sec < 45) return t("nav.chatHistoryTimeJustNow");
  if (sec < 3600) return t("nav.chatHistoryTimeMinutes", { n: Math.max(1, Math.floor(sec / 60)) });
  if (sec < 86400) return t("nav.chatHistoryTimeHours", { n: Math.max(1, Math.floor(sec / 3600)) });
  if (sec < 172800) return t("nav.chatHistoryTimeYesterday");
  return t("nav.chatHistoryTimeDays", { n: Math.floor(sec / 86400) });
}
