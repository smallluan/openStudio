/** Local persistence for chat conversations (sidebar history). */

const STORAGE_KEY = "openstudio_chat_sessions_v1";
const MAX_SESSIONS = 50;

/**
 * @typedef {object} PersistedChatMessage
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {string} content
 * @property {string} [thinking]
 */

/**
 * @typedef {object} ChatSessionRecord
 * @property {string} id
 * @property {string} title
 * @property {boolean} [titleIsCustom]
 * @property {number} updatedAt
 * @property {PersistedChatMessage[]} messages
 */

/** @returns {ChatSessionRecord[]} */
export function loadAllSessions() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r) =>
          r &&
          typeof r === "object" &&
          typeof r.id === "string" &&
          Array.isArray(r.messages),
      )
      .map((r) => ({
        id: r.id,
        title: typeof r.title === "string" ? r.title : "",
        titleIsCustom: Boolean(r.titleIsCustom),
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
        messages: sanitizeMessages(r.messages),
      }));
  } catch {
    return [];
  }
}

/** @param {PersistedChatMessage[]} a @param {PersistedChatMessage[]} b */
function persistedMessagesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.role !== y.role || x.content !== y.content) return false;
    const xt = x.thinking ?? "";
    const yt = y.thinking ?? "";
    if (xt !== yt) return false;
  }
  return true;
}

/** @param {unknown[]} raw */
function sanitizeMessages(raw) {
  /** @type {PersistedChatMessage[]} */
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const id = typeof m.id === "string" ? m.id : "";
    const role = m.role === "user" || m.role === "assistant" ? m.role : null;
    const content = typeof m.content === "string" ? m.content : "";
    if (!id || !role) continue;
    /** @type {PersistedChatMessage} */
    const row = { id, role, content };
    if (typeof m.thinking === "string" && m.thinking) row.thinking = m.thinking;
    out.push(row);
  }
  return out;
}

/** @param {ChatSessionRecord[]} rows */
function writeAll(rows) {
  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    /* ignore quota */
  }
  try {
    window.dispatchEvent(new CustomEvent("openstudio-chat-sessions-changed"));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} id
 * @param {string} title
 * @param {PersistedChatMessage[]} messages
 */
export function upsertSession(id, title, messages) {
  if (!id) return;
  const existing = loadAllSessions();
  const prev = existing.find((s) => s.id === id);
  const all = existing.filter((s) => s.id !== id);
  const titleIsCustom = Boolean(prev?.titleIsCustom);
  const resolvedTitle =
    titleIsCustom && prev?.title ? prev.title : String(title ?? "").slice(0, 200);
  const contentChanged = !prev || !persistedMessagesEqual(prev.messages, messages);
  const updatedAt = contentChanged ? Date.now() : prev.updatedAt;
  all.push({
    id,
    title: resolvedTitle,
    titleIsCustom,
    updatedAt,
    messages,
  });
  writeAll(all);
}

/**
 * @param {string} id
 * @param {string} nextTitle
 */
export function renameSession(id, nextTitle) {
  const t = String(nextTitle ?? "").trim().slice(0, 200);
  if (!id || !t) return;
  const all = loadAllSessions();
  if (!all.some((s) => s.id === id)) return;
  writeAll(
    all.map((s) => (s.id === id ? { ...s, title: t, titleIsCustom: true, updatedAt: Date.now() } : s)),
  );
}

/** @param {string} id */
export function deleteSession(id) {
  if (!id) return;
  writeAll(loadAllSessions().filter((s) => s.id !== id));
}

/** @param {string} id @returns {ChatSessionRecord | null} */
export function getSession(id) {
  if (!id) return null;
  return loadAllSessions().find((s) => s.id === id) ?? null;
}

/** @param {Array<{ id: string; role: string; content: string; thinking?: string }>} messages */
export function deriveTitleFromMessages(messages) {
  const first = messages.find((m) => m.role === "user" && String(m.content ?? "").trim());
  const line = first ? String(first.content).trim().split(/\r?\n/)[0] : "";
  if (!line) return "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
