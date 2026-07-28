/** Max conversations shown per channel in the primary rail before "show more". */
export const CHAT_HISTORY_SIDEBAR_VISIBLE_LIMIT = 5;

/** Page size when loading overflow conversations in the more dialog. */
export const CHAT_HISTORY_MORE_PAGE_SIZE = 20;

/**
 * @param {Array<{ id: string }>} rows
 * @param {string | null | undefined} activeSessionId
 * @param {number} [limit]
 */
export function getSidebarVisibleSessionRows(rows, activeSessionId, limit = CHAT_HISTORY_SIDEBAR_VISIBLE_LIMIT) {
  if (rows.length <= limit) return rows;
  const top = rows.slice(0, limit);
  if (!activeSessionId) return top;
  if (top.some((row) => row.id === activeSessionId)) return top;
  const active = rows.find((row) => row.id === activeSessionId);
  if (!active) return top;
  return [...top.slice(0, limit - 1), active];
}

/**
 * @param {Array<{ id: string }>} rows
 * @param {Array<{ id: string }>} visibleRows
 */
export function getOverflowSessionRows(rows, visibleRows) {
  const visibleIds = new Set(visibleRows.map((row) => row.id));
  return rows.filter((row) => !visibleIds.has(row.id));
}
