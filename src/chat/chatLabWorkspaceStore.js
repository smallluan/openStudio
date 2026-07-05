const RECENTS_KEY = "openstudio_chat_workspace_recents";
const CONV_PREFIX = "openstudio_chat_workspace_conv:";
const MAX_RECENTS = 12;

/** @returns {string[]} */
export function readWorkspaceRecents() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === "string" && p.trim()).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** @param {string} root */
export function pushWorkspaceRecent(root) {
  const v = String(root ?? "").trim();
  if (!v) return;
  const prev = readWorkspaceRecents().filter((p) => p !== v);
  const next = [v, ...prev].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** @param {string} root */
export function workspaceLabelFromPath(root) {
  const s = String(root ?? "").replace(/[\\/]+$/, "");
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s || root;
}

/** @param {string} conversationId */
export function readConversationWorkspace(conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(`${CONV_PREFIX}${id}`);
    const v = String(raw ?? "").trim();
    return v || null;
  } catch {
    return null;
  }
}

/** @param {string} conversationId @param {string | null} root */
export function writeConversationWorkspace(conversationId, root) {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  try {
    const key = `${CONV_PREFIX}${id}`;
    const v = String(root ?? "").trim();
    if (v) sessionStorage.setItem(key, v);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
