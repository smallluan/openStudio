/** Local persistence for chat conversations (sidebar history). */

const STORAGE_KEY = "openstudio_chat_sessions_v1";
const MAX_SESSIONS = 50;
export const CHAT_SESSION_CHANNEL_INTERNAL = "internal";
export const CHAT_SESSION_CHANNEL_WECHAT = "wechat";

/**
 * @typedef {import("./toolTraceMerge.js").ToolTraceRow} ToolTraceRow
 * @typedef {import("./toolTraceMerge.js").ActivityRow} ActivityRow
 */

/**
 * Serializable skill tag on a user message (UI + edit restore).
 * @typedef {object} MessageSkillMeta
 * @property {'openclaw'|'user'} kind
 * @property {string} [slug]
 * @property {string} [userSkillId]
 * @property {string} label
 * @property {string} emoji
 */

/**
 * Inline image on a user bubble (data URL). Keep payloads bounded by composer limits + storage quota.
 * @typedef {object} PersistedImageAttachment
 * @property {string} mime
 * @property {string} dataUrl
 */

/**
 * @typedef {object} PersistedChatMessage
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {string} content
 * @property {string} [thinking]
 * @property {ToolTraceRow[]} [toolTrace]
 * @property {ActivityRow[]} [activityLog]
 * @property {import("./streamTimelineMerge.js").AssistantTimelineSegment[]} [assistantTimeline]
 * @property {number} [createdAt]
 * @property {MessageSkillMeta} [skillMeta]
 * @property {PersistedImageAttachment[]} [imageAttachments]
 */

/**
 * @typedef {object} ChatSessionRecord
 * @property {string} id
 * @property {string} title
 * @property {boolean} [titleIsCustom]
 * @property {number} updatedAt
 * @property {'internal' | 'wechat'} [channel]
 * @property {string} [channelPeerId]
 * @property {string} [gatewayConversationId] UUID gateway thread for WeChat auto-reply (UI id stays `wechat:<peer>`)
 * @property {PersistedChatMessage[]} messages
 */

/** @returns {string} */
export function newGatewayConversationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `gwx_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * @param {unknown} raw
 * @returns {'internal' | 'wechat'}
 */
function normalizeSessionChannel(raw) {
  return raw === CHAT_SESSION_CHANNEL_WECHAT ? CHAT_SESSION_CHANNEL_WECHAT : CHAT_SESSION_CHANNEL_INTERNAL;
}

/** Parsed sessions mirrored from localStorage; refreshed whenever `writeAll` runs. */
/** @type {ChatSessionRecord[] | null} */
let sessionsLoadCache = null;

/** Drop parse cache (e.g. after external storage mutation). Next `loadAllSessions` reads disk again. */
export function invalidateChatSessionsCache() {
  sessionsLoadCache = null;
}

/** @returns {ChatSessionRecord[]} */
function parseSessionsFromStorage() {
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
        channel: normalizeSessionChannel(r.channel),
        channelPeerId: typeof r.channelPeerId === "string" ? r.channelPeerId.trim().slice(0, 180) : "",
        gatewayConversationId:
          typeof r.gatewayConversationId === "string" ? r.gatewayConversationId.trim().slice(0, 96) : "",
        messages: sanitizeMessages(r.messages),
      }));
  } catch {
    return [];
  }
}

/** @param {unknown} raw */
function sanitizeToolTrace(raw) {
  if (!Array.isArray(raw)) return undefined;
  /** @type {ToolTraceRow[]} */
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const id = typeof t.id === "string" ? t.id : "";
    if (!id) continue;
    /** @type {ToolTraceRow} */
    const row = {
      id,
      toolName: typeof t.toolName === "string" ? t.toolName : "",
      label: typeof t.label === "string" ? t.label : "",
      phase: typeof t.phase === "string" ? t.phase : "",
      status: typeof t.status === "string" ? t.status : "",
      summary: typeof t.summary === "string" ? t.summary : "",
      seq: typeof t.seq === "number" && Number.isFinite(t.seq) ? t.seq : 0,
      done: Boolean(t.done),
    };
    if (t.args && typeof t.args === "object") row.args = /** @type {Record<string, unknown>} */ ({ ...t.args });
    if (typeof t.result === "string") row.result = t.result;
    if (typeof t.partialResult === "string") row.partialResult = t.partialResult;
    if (typeof t.error === "string") row.error = t.error;
    out.push(row);
  }
  return out.length ? out : undefined;
}

/** @param {unknown} raw */
function sanitizeActivityLog(raw) {
  if (!Array.isArray(raw)) return undefined;
  /** @type {ActivityRow[]} */
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const id = typeof t.id === "string" ? t.id : "";
    const stream = typeof t.stream === "string" ? t.stream : "";
    if (!id || !stream) continue;
    out.push({
      id,
      stream,
      phase: typeof t.phase === "string" ? t.phase : "",
      title: typeof t.title === "string" ? t.title : "",
      text: typeof t.text === "string" ? t.text : "",
      seq: typeof t.seq === "number" && Number.isFinite(t.seq) ? t.seq : 0,
    });
  }
  return out.length ? out : undefined;
}

/** @param {unknown} raw */
function sanitizeAssistantTimeline(raw) {
  if (!Array.isArray(raw)) return undefined;
  /** @type {import("./streamTimelineMerge.js").AssistantTimelineSegment[]} */
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const kind = /** @type {unknown} */ (s).kind;
    if (kind === "text" || kind === "thinking") {
      const body = typeof /** @type {{ body?: unknown }} */ (s).body === "string" ? /** @type {{ body?: unknown }} */ (s).body : "";
      if (!body) continue;
      if (kind === "text") out.push({ kind: "text", body });
      else out.push({ kind: "thinking", body });
    } else if (kind === "tool" || kind === "activity") {
      const refId = typeof /** @type {{ refId?: unknown }} */ (s).refId === "string" ? /** @type {{ refId?: unknown }} */ (s).refId.trim() : "";
      if (!refId) continue;
      if (kind === "tool") out.push({ kind: "tool", refId });
      else out.push({ kind: "activity", refId });
    }
    if (out.length >= 240) break;
  }
  return out.length ? out : undefined;
}

/** @returns {ChatSessionRecord[]} */
export function loadAllSessions() {
  if (!sessionsLoadCache) sessionsLoadCache = parseSessionsFromStorage();
  return sessionsLoadCache;
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
    if (JSON.stringify(x.toolTrace ?? null) !== JSON.stringify(y.toolTrace ?? null)) return false;
    if (JSON.stringify(x.activityLog ?? null) !== JSON.stringify(y.activityLog ?? null)) return false;
    if (JSON.stringify(x.assistantTimeline ?? null) !== JSON.stringify(y.assistantTimeline ?? null)) return false;
    if (JSON.stringify(x.skillMeta ?? null) !== JSON.stringify(y.skillMeta ?? null)) return false;
    if (JSON.stringify(x.imageAttachments ?? null) !== JSON.stringify(y.imageAttachments ?? null)) return false;
    const xc = typeof x.createdAt === "number" && Number.isFinite(x.createdAt) ? x.createdAt : -1;
    const yc = typeof y.createdAt === "number" && Number.isFinite(y.createdAt) ? y.createdAt : -1;
    if (xc !== yc) return false;
  }
  return true;
}

/** @param {unknown} raw */
function sanitizeImageAttachments(raw) {
  if (!Array.isArray(raw)) return undefined;
  /** @type {{ mime: string; dataUrl: string }[]} */
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const mime = typeof a.mime === "string" ? a.mime.trim() : "";
    const dataUrl = typeof a.dataUrl === "string" ? a.dataUrl : "";
    if (!mime.startsWith("image/") || !dataUrl.startsWith("data:image/")) continue;
    out.push({ mime: mime.slice(0, 120), dataUrl });
    if (out.length >= 12) break;
  }
  return out.length ? out : undefined;
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
    if (Array.isArray(m.toolTrace) && m.toolTrace.length > 0) {
      const tt = sanitizeToolTrace(m.toolTrace);
      if (tt?.length) row.toolTrace = tt;
    }
    if (Array.isArray(m.activityLog) && m.activityLog.length > 0) {
      const al = sanitizeActivityLog(m.activityLog);
      if (al?.length) row.activityLog = al;
    }
    if (Array.isArray(m.assistantTimeline) && m.assistantTimeline.length > 0) {
      const tl = sanitizeAssistantTimeline(m.assistantTimeline);
      if (tl?.length) row.assistantTimeline = tl;
    }
    if (typeof m.createdAt === "number" && Number.isFinite(m.createdAt)) row.createdAt = m.createdAt;
    const sm = m.skillMeta;
    if (sm && typeof sm === "object") {
      const kind = sm.kind === "openclaw" || sm.kind === "user" ? sm.kind : null;
      const label = typeof sm.label === "string" ? sm.label.trim().slice(0, 120) : "";
      const emoji = typeof sm.emoji === "string" ? sm.emoji.slice(0, 8) : "";
      if (kind && label) {
        if (kind === "openclaw") {
          const slug = typeof sm.slug === "string" ? sm.slug.trim().slice(0, 80) : "";
          if (slug) row.skillMeta = { kind: "openclaw", slug, label, emoji };
        } else {
          const uid = typeof sm.userSkillId === "string" ? sm.userSkillId.trim().slice(0, 80) : "";
          if (uid) row.skillMeta = { kind: "user", userSkillId: uid, label, emoji };
        }
      }
    }
    if (role === "user" && Array.isArray(m.imageAttachments) && m.imageAttachments.length > 0) {
      const ia = sanitizeImageAttachments(m.imageAttachments);
      if (ia?.length) row.imageAttachments = ia;
    }
    out.push(row);
  }
  return out;
}

/** @param {ChatSessionRecord[]} rows */
function writeAll(rows) {
  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  sessionsLoadCache = sorted;
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
 * @param {{ channel?: 'internal' | 'wechat'; channelPeerId?: string; gatewayConversationId?: string }} [opts]
 */
export function upsertSession(id, title, messages, opts = {}) {
  if (!id) return;
  const existing = loadAllSessions();
  const prev = existing.find((s) => s.id === id);
  const all = existing.filter((s) => s.id !== id);
  const titleIsCustom = Boolean(prev?.titleIsCustom);
  const resolvedTitle =
    titleIsCustom && prev?.title ? prev.title : String(title ?? "").slice(0, 200);
  const contentChanged = !prev || !persistedMessagesEqual(prev.messages, messages);
  const updatedAt = contentChanged ? Date.now() : prev.updatedAt;
  const nextChannel = normalizeSessionChannel(opts.channel ?? prev?.channel);
  const nextPeer =
    typeof opts.channelPeerId === "string"
      ? opts.channelPeerId.trim().slice(0, 180)
      : typeof prev?.channelPeerId === "string"
        ? prev.channelPeerId
        : "";
  const nextGatewayConversationId =
    typeof opts.gatewayConversationId === "string" && opts.gatewayConversationId.trim()
      ? opts.gatewayConversationId.trim().slice(0, 96)
      : typeof prev?.gatewayConversationId === "string"
        ? prev.gatewayConversationId
        : "";
  all.push({
    id,
    title: resolvedTitle,
    titleIsCustom,
    updatedAt,
    channel: nextChannel,
    channelPeerId: nextPeer,
    ...(nextGatewayConversationId ? { gatewayConversationId: nextGatewayConversationId } : {}),
    messages,
  });
  writeAll(all);
}

/**
 * WeChat UI threads use `wechat:<peer>`; gateway uses a plain UUID studio suffix (same as Chat Lab).
 * @param {string} sessionId
 * @returns {string}
 */
export function ensureWechatGatewayConversationId(sessionId) {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return "";
  const rec = getSession(sid);
  if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) return "";
  const existing = String(rec.gatewayConversationId ?? "").trim();
  if (existing) return existing;
  const gatewayConversationId = newGatewayConversationId();
  upsertSession(sid, rec.title || "…", rec.messages, {
    channel: CHAT_SESSION_CHANNEL_WECHAT,
    channelPeerId: rec.channelPeerId,
    gatewayConversationId,
  });
  return gatewayConversationId;
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

/** @param {string[]} ids */
export function deleteSessionsByIds(ids) {
  const set = new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0));
  if (set.size === 0) return;
  writeAll(loadAllSessions().filter((s) => !set.has(s.id)));
}

/** @param {string} id @returns {ChatSessionRecord | null} */
export function getSession(id) {
  if (!id) return null;
  return loadAllSessions().find((s) => s.id === id) ?? null;
}

/**
 * @param {Array<{ id: string; role: string; content: string; thinking?: string; imageAttachments?: unknown[] }>} messages
 * @param {{ imageFallback?: string }} [opts]
 */
export function deriveTitleFromMessages(messages, opts = {}) {
  const imageFb =
    typeof opts.imageFallback === "string" && opts.imageFallback.trim()
      ? opts.imageFallback.trim()
      : "Image";
  const first = messages.find(
    (m) =>
      m.role === "user" &&
      (String(m.content ?? "").trim() ||
        (Array.isArray(m.imageAttachments) && m.imageAttachments.length > 0)),
  );
  let line = first ? String(first.content ?? "").trim().split(/\r?\n/)[0] : "";
  if (!line && first && Array.isArray(first.imageAttachments) && first.imageAttachments.length > 0) {
    line = imageFb;
  }
  if (!line) return "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
