/** Local persistence for chat conversations (sidebar history). */

import { sanitizeFollowUpRef } from "./chatLabFollowUp.js";
import { sanitizeWorkflowSessionState } from "../workflow/workflowRuntimeRegistry.js";

const LEGACY_STORAGE_KEY = "openstudio_chat_sessions_v1";
const PERSIST_DEBOUNCE_MS = 400;
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
 * Quote reference when the user follows up on prior chat text.
 * @typedef {object} MessageFollowUpRef
 * @property {string} sourceMessageId
 * @property {'user' | 'assistant'} sourceRole
 * @property {string} [sourceAgentId]
 * @property {string} agentName
 * @property {string} quoteText
 */

/**
 * Inline image on a user bubble (data URL). Keep payloads bounded by composer limits + storage quota.
 * @typedef {object} PersistedImageAttachment
 * @property {string} mime
 * @property {string} dataUrl
 */

/**
 * Local file / folder path attached in the composer (Electron).
 * @typedef {object} PersistedFileRef
 * @property {string} path
 * @property {string} name
 * @property {'file' | 'directory'} kind
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
 * @property {MessageFollowUpRef} [followUpRef]
 * @property {PersistedImageAttachment[]} [imageAttachments]
 * @property {PersistedFileRef[]} [fileRefs]
 * @property {string} [agentId] Studio agent id (assistant bubbles)
 * @property {string[]} [mentions] Studio agent ids @-mentioned on user or assistant turns
 * @property {boolean} [mentionDelegateReply] Auto-reply triggered by another agent's @mention
 * @property {string} [mentionDelegateFromAgentId] Studio agent id that @mentioned this reply
 * @property {'group_member_event' | 'automation_run'} [messageKind]
 * @property {string} [workflowId] Workflow document id when user turn was dispatched via workflow
 * @property {string} [workflowName] Display name for workflow badge on user turns
 * @property {string} [workflowNodeId] Active workflow graph node id for assistant turns
 * @property {string} [workflowNodeLabel] Display label for workflow reply tabs
 * @property {boolean} [workflowHandoffReply] Assistant turn started by workflow handoff (not shown as user bubble)
 */

/**
 * Per-agent gateway sync cursor — tracks what history was already delivered to that agent's session.
 * @typedef {object} AgentGatewaySyncState
 * @property {string} lastMessageId
 */

/**
 * Shared thread context for multi-agent gateway turns (summary + per-agent sync cursors).
 * @typedef {object} ThreadContextState
 * @property {string} [summary] Collapsed summary of older turns
 * @property {string} [summaryThroughMessageId]
 * @property {Record<string, AgentGatewaySyncState>} [agentSync]
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
 * @property {string[]} [participantIds] Studio agent ids in this thread (group chat)
 * @property {string} [automationCronJobId] Linked Open Studio automation task id
 * @property {boolean} [automationTaskSession] Read-only execution log for a scheduled task
 * @property {ThreadContextState} [threadContext]
 * @property {{ selectedWorkflowId?: string; runtime?: import("../workflow/workflowRuntimeRegistry.js").WorkflowSessionRuntimeState | null }} [workflowState]
 * @property {PreviewStateRecord} [previewState]
 * @property {PersistedChatMessage[]} messages
 */

/**
 * Persisted right-sidebar web page tab.
 * @typedef {object} PreviewTabRecord
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} [externalUrl]
 * @property {string} [sandbox]
 * @property {boolean} [useWebview]
 * @property {string} [frameKey]
 * @property {number} [lastVisitedAt]
 */

/**
 * Persisted right-sidebar preview state for one conversation.
 * @typedef {object} PreviewStateRecord
 * @property {PreviewTabRecord[]} tabs
 * @property {string} [activeTabId]
 */

/** @returns {string} */
export function newGatewayConversationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `gwx_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

/** Gateway session segment for Web Explore embed threads (`#studio:wexplore:…`). */
export const WEB_EXPLORE_CONVERSATION_PREFIX = "wexplore:";

/** @returns {string} */
export function newWebExploreConversationId() {
  return `${WEB_EXPLORE_CONVERSATION_PREFIX}${newGatewayConversationId()}`;
}

/** Independent WeChat channel sidebar session (`wechat:thread:<uuid>`). */
export function newWechatChannelSessionId() {
  return `wechat:thread:${newGatewayConversationId()}`;
}

/**
 * @param {unknown} raw
 * @returns {'internal' | 'wechat'}
 */
function normalizeSessionChannel(raw) {
  return raw === CHAT_SESSION_CHANNEL_WECHAT ? CHAT_SESSION_CHANNEL_WECHAT : CHAT_SESSION_CHANNEL_INTERNAL;
}

/** Parsed sessions mirrored from storage; refreshed whenever cache commits. */
/** @type {ChatSessionRecord[] | null} */
let sessionsLoadCache = null;
let diskPersistenceEnabled = false;
/** @type {Promise<void> | null} */
let initPromise = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let persistTimer = null;
/** @type {ChatSessionRecord | null} */
let pendingUpsert = null;
/** @type {Promise<void>} */
let flushChain = Promise.resolve();

function getBridge() {
  return typeof window !== "undefined" ? window.studioBridge : undefined;
}

/** @param {unknown} r @returns {ChatSessionRecord | null} */
function normalizeSessionRow(r) {
  if (!r || typeof r !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (r);
  if (typeof row.id !== "string" || !Array.isArray(row.messages)) return null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    titleIsCustom: Boolean(row.titleIsCustom),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
    channel: normalizeSessionChannel(row.channel),
    channelPeerId: typeof row.channelPeerId === "string" ? row.channelPeerId.trim().slice(0, 180) : "",
    gatewayConversationId:
      typeof row.gatewayConversationId === "string" ? row.gatewayConversationId.trim().slice(0, 96) : "",
    participantIds: sanitizeParticipantIds(row.participantIds),
    automationCronJobId:
      typeof row.automationCronJobId === "string" ? row.automationCronJobId.trim().slice(0, 120) : "",
    automationTaskSession: Boolean(row.automationTaskSession || row.automationCronJobId),
    threadContext: sanitizeThreadContext(row.threadContext),
    workflowState: sanitizeWorkflowSessionState(row.workflowState),
    previewState: sanitizePreviewState(row.previewState),
    messages: sanitizeMessages(row.messages),
  };
}

/** @param {unknown} raw @returns {PreviewStateRecord | undefined} */
function sanitizePreviewState(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(r.tabs)) return undefined;
  /** @type {PreviewTabRecord[]} */
  const tabs = [];
  const seen = new Set();
  for (const item of r.tabs) {
    if (!item || typeof item !== "object") continue;
    const tab = /** @type {Record<string, unknown>} */ (item);
    const id = typeof tab.id === "string" ? tab.id.trim().slice(0, 96) : "";
    const url = typeof tab.url === "string" ? tab.url.trim().slice(0, 4096) : "";
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    const title = typeof tab.title === "string" ? tab.title.trim().slice(0, 240) : "";
    /** @type {PreviewTabRecord} */
    const row = {
      id,
      url,
      title: title || url,
    };
    if (typeof tab.externalUrl === "string" && tab.externalUrl.trim()) {
      row.externalUrl = tab.externalUrl.trim().slice(0, 4096);
    }
    if (typeof tab.sandbox === "string" && tab.sandbox.trim()) {
      row.sandbox = tab.sandbox.trim().slice(0, 240);
    }
    if (typeof tab.useWebview === "boolean") {
      row.useWebview = tab.useWebview;
    }
    if (typeof tab.lastVisitedAt === "number" && Number.isFinite(tab.lastVisitedAt)) {
      row.lastVisitedAt = tab.lastVisitedAt;
    }
    if (typeof tab.frameKey === "string" && tab.frameKey.trim()) {
      row.frameKey = tab.frameKey.trim().slice(0, 96);
    }
    tabs.push(row);
    if (tabs.length >= 24) break;
  }
  if (!tabs.length) return undefined;
  const activeTabId = typeof r.activeTabId === "string" ? r.activeTabId.trim().slice(0, 96) : "";
  return {
    tabs,
    ...(activeTabId && tabs.some((t) => t.id === activeTabId) ? { activeTabId } : {}),
  };
}

/** @returns {ChatSessionRecord[]} */
function readLegacyLocalStorage() {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSessionRow).filter(Boolean);
  } catch {
    return [];
  }
}

function clearLegacyLocalStorage() {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function notifySessionsChanged() {
  try {
    window.dispatchEvent(new CustomEvent("openstudio-chat-sessions-changed"));
  } catch {
    /* ignore */
  }
}

/** @param {ChatSessionRecord[]} rows */
function applyCacheSorted(rows) {
  sessionsLoadCache = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** @param {ChatSessionRecord[]} rows */
function commitCache(rows) {
  applyCacheSorted(rows);
  notifySessionsChanged();
}

/** @param {ChatSessionRecord} session */
function scheduleDiskUpsert(session) {
  pendingUpsert = session;
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const snap = pendingUpsert;
    pendingUpsert = null;
    if (!snap) return;
    flushChain = flushChain.then(() => flushDiskUpsert(snap));
  }, PERSIST_DEBOUNCE_MS);
}

/** @param {ChatSessionRecord} session */
function flushDiskUpsertNow(session) {
  pendingUpsert = null;
  if (persistTimer) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  flushChain = flushChain.then(() => flushDiskUpsert(session));
}

/** @param {ChatSessionRecord} session */
async function flushDiskUpsert(session) {
  const bridge = getBridge();
  if (!bridge?.chatSessionsUpsert) return;
  try {
    await bridge.chatSessionsUpsert(session);
  } catch {
    /* ignore disk errors */
  }
}

/** Flush debounced chat session writes (e.g. before navigation). */
export async function flushChatSessionsPersist() {
  if (!diskPersistenceEnabled) return;
  if (persistTimer) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  const snap = pendingUpsert;
  pendingUpsert = null;
  if (snap) {
    flushChain = flushChain.then(() => flushDiskUpsert(snap));
  }
  await flushChain;
}

/** Load chat sessions from JSONL (Electron) or legacy localStorage. */
export async function initChatSessionsStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const bridge = getBridge();
    if (bridge?.chatSessionsLoadAll && bridge?.chatSessionsUpsert) {
      diskPersistenceEnabled = true;
      const res = await bridge.chatSessionsLoadAll();
      let fromDisk =
        res?.ok && Array.isArray(res.sessions)
          ? res.sessions.map(normalizeSessionRow).filter(Boolean)
          : [];

      const legacy = readLegacyLocalStorage();
      if (legacy.length > 0 && fromDisk.length === 0 && bridge.chatSessionsImportLegacy) {
        await bridge.chatSessionsImportLegacy(legacy);
        clearLegacyLocalStorage();
        const migrated = await bridge.chatSessionsLoadAll();
        fromDisk =
          migrated?.ok && Array.isArray(migrated.sessions)
            ? migrated.sessions.map(normalizeSessionRow).filter(Boolean)
            : legacy;
      } else if (legacy.length > 0) {
        clearLegacyLocalStorage();
      }

      sessionsLoadCache = fromDisk;
    } else {
      sessionsLoadCache = readLegacyLocalStorage();
    }
    notifySessionsChanged();
  })();
  return initPromise;
}

/** Drop parse cache (e.g. after external storage mutation). Next `loadAllSessions` reads disk again. */
export function invalidateChatSessionsCache() {
  sessionsLoadCache = null;
}

/** Reload sidebar sessions from Electron disk store (e.g. after main-process writes). */
export async function reloadChatSessionsFromDisk() {
  const bridge = getBridge();
  if (!bridge?.chatSessionsLoadAll) {
    invalidateChatSessionsCache();
    notifySessionsChanged();
    return;
  }
  try {
    const res = await bridge.chatSessionsLoadAll();
    const rows =
      res?.ok && Array.isArray(res.sessions)
        ? res.sessions.map(normalizeSessionRow).filter(Boolean)
        : [];
    applyCacheSorted(rows);
  } catch {
    invalidateChatSessionsCache();
  }
  notifySessionsChanged();
}

/** @returns {ChatSessionRecord[]} */
function parseSessionsFromStorage() {
  return readLegacyLocalStorage();
}

/** @param {unknown} raw @returns {ThreadContextState | undefined} */
function sanitizeThreadContext(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  /** @type {ThreadContextState} */
  const out = {};
  if (typeof r.summary === "string" && r.summary.trim()) {
    out.summary = r.summary.trim().slice(0, 4000);
  }
  if (typeof r.summaryThroughMessageId === "string" && r.summaryThroughMessageId.trim()) {
    out.summaryThroughMessageId = r.summaryThroughMessageId.trim().slice(0, 96);
  }
  if (r.agentSync && typeof r.agentSync === "object" && !Array.isArray(r.agentSync)) {
    /** @type {Record<string, AgentGatewaySyncState>} */
    const agentSync = {};
    for (const [agentId, state] of Object.entries(/** @type {Record<string, unknown>} */ (r.agentSync))) {
      if (!agentId || typeof state !== "object" || !state) continue;
      const lastMessageId = typeof /** @type {{ lastMessageId?: unknown }} */ (state).lastMessageId === "string"
        ? /** @type {{ lastMessageId?: unknown }} */ (state).lastMessageId.trim().slice(0, 96)
        : "";
      if (!lastMessageId) continue;
      agentSync[agentId.slice(0, 96)] = { lastMessageId };
    }
    if (Object.keys(agentSync).length) out.agentSync = agentSync;
  }
  return Object.keys(out).length ? out : undefined;
}

/** @param {unknown} raw @returns {string[]} */
function sanitizeParticipantIds(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const t = id.trim().slice(0, 96);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 24) break;
  }
  return out;
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
    if (JSON.stringify(x.followUpRef ?? null) !== JSON.stringify(y.followUpRef ?? null)) return false;
    if (JSON.stringify(x.imageAttachments ?? null) !== JSON.stringify(y.imageAttachments ?? null)) return false;
    if (JSON.stringify(x.fileRefs ?? null) !== JSON.stringify(y.fileRefs ?? null)) return false;
    if ((x.agentId ?? "") !== (y.agentId ?? "")) return false;
    if (JSON.stringify(x.mentions ?? null) !== JSON.stringify(y.mentions ?? null)) return false;
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

/** @param {unknown} raw */
function sanitizeFileRefs(raw) {
  if (!Array.isArray(raw)) return undefined;
  /** @type {PersistedFileRef[]} */
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const path = typeof r.path === "string" ? r.path.trim().slice(0, 2048) : "";
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 260) : "";
    const kind = r.kind === "directory" ? "directory" : r.kind === "file" ? "file" : null;
    if (!path || !name || !kind) continue;
    out.push({ path, name, kind });
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
    const fu = sanitizeFollowUpRef(m.followUpRef);
    if (fu) row.followUpRef = fu;
    if (role === "user" && Array.isArray(m.imageAttachments) && m.imageAttachments.length > 0) {
      const ia = sanitizeImageAttachments(m.imageAttachments);
      if (ia?.length) row.imageAttachments = ia;
    }
    if (Array.isArray(m.fileRefs) && m.fileRefs.length > 0) {
      const fr = sanitizeFileRefs(m.fileRefs);
      if (fr?.length) row.fileRefs = fr;
    }
    if (typeof m.agentId === "string" && m.agentId.trim()) row.agentId = m.agentId.trim().slice(0, 96);
    if (Array.isArray(m.mentions) && m.mentions.length > 0) {
      const ms = sanitizeParticipantIds(m.mentions);
      if (ms.length) row.mentions = ms;
    }
    if (m.mentionDelegateReply === true) row.mentionDelegateReply = true;
    if (typeof m.mentionDelegateFromAgentId === "string" && m.mentionDelegateFromAgentId.trim()) {
      row.mentionDelegateFromAgentId = m.mentionDelegateFromAgentId.trim().slice(0, 96);
    }
    const mk = m.messageKind;
    if (mk === "group_member_event" || mk === "automation_run") {
      row.messageKind = mk;
    }
    if (typeof m.workflowId === "string" && m.workflowId.trim()) {
      row.workflowId = m.workflowId.trim().slice(0, 96);
    }
    if (typeof m.workflowName === "string" && m.workflowName.trim()) {
      row.workflowName = m.workflowName.trim().slice(0, 120);
    }
    if (typeof m.workflowNodeId === "string" && m.workflowNodeId.trim()) {
      row.workflowNodeId = m.workflowNodeId.trim().slice(0, 96);
    }
    if (typeof m.workflowNodeLabel === "string" && m.workflowNodeLabel.trim()) {
      row.workflowNodeLabel = m.workflowNodeLabel.trim().slice(0, 120);
    }
    if (m.workflowHandoffReply === true) row.workflowHandoffReply = true;
    out.push(row);
  }
  return out;
}

/** @param {ChatSessionRecord[]} rows @param {ChatSessionRecord} [persistSession] */
function writeAll(rows, persistSession) {
  commitCache(rows);
  if (diskPersistenceEnabled) {
    if (persistSession) scheduleDiskUpsert(persistSession);
    return;
  }
  try {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(sessionsLoadCache));
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {string} id
 * @param {string} title
 * @param {PersistedChatMessage[]} messages
 * @param {{
 *   channel?: 'internal' | 'wechat';
 *   channelPeerId?: string;
 *   gatewayConversationId?: string;
 *   participantIds?: string[];
 *   automationCronJobId?: string;
 *   automationTaskSession?: boolean;
 *   threadContext?: ThreadContextState | null;
 *   workflowState?: { selectedWorkflowId?: string | null; runtime?: import("../workflow/workflowRuntimeRegistry.js").WorkflowSessionRuntimeState | null } | null;
 *   previewState?: PreviewStateRecord | null;
 * }} [opts]
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
  const nextParticipants =
    opts.participantIds !== undefined
      ? sanitizeParticipantIds(opts.participantIds)
      : sanitizeParticipantIds(prev?.participantIds);
  const nextThreadContext =
    opts.threadContext !== undefined
      ? sanitizeThreadContext(opts.threadContext)
      : sanitizeThreadContext(prev?.threadContext);
  const nextWorkflowState =
    opts.workflowState !== undefined
      ? sanitizeWorkflowSessionState(opts.workflowState)
      : sanitizeWorkflowSessionState(prev?.workflowState);
  const nextPreviewState =
    opts.previewState !== undefined
      ? sanitizePreviewState(opts.previewState)
      : sanitizePreviewState(prev?.previewState);
  const nextAutomationCronJobId =
    typeof opts.automationCronJobId === "string"
      ? opts.automationCronJobId.trim().slice(0, 120)
      : typeof prev?.automationCronJobId === "string"
        ? prev.automationCronJobId
        : "";
  const nextAutomationTaskSession =
    opts.automationTaskSession !== undefined
      ? Boolean(opts.automationTaskSession)
      : Boolean(prev?.automationTaskSession || nextAutomationCronJobId);
  const sessionRecord = {
    id,
    title: resolvedTitle,
    titleIsCustom,
    updatedAt,
    channel: nextChannel,
    channelPeerId: nextPeer,
    ...(nextGatewayConversationId ? { gatewayConversationId: nextGatewayConversationId } : {}),
    ...(nextParticipants.length ? { participantIds: nextParticipants } : {}),
    ...(nextAutomationCronJobId ? { automationCronJobId: nextAutomationCronJobId } : {}),
    ...(nextAutomationTaskSession ? { automationTaskSession: true } : {}),
    ...(nextThreadContext ? { threadContext: nextThreadContext } : {}),
    ...(nextWorkflowState ? { workflowState: nextWorkflowState } : {}),
    ...(nextPreviewState ? { previewState: nextPreviewState } : {}),
    messages,
  };
  all.push(sessionRecord);
  writeAll(all, sessionRecord);
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
  const target = all.find((s) => s.id === id);
  if (!target) return;
  const next = all.map((s) => (s.id === id ? { ...s, title: t, titleIsCustom: true, updatedAt: Date.now() } : s));
  const updated = next.find((s) => s.id === id);
  if (!updated) return;
  commitCache(next);
  if (diskPersistenceEnabled) {
    flushDiskUpsertNow(updated);
    return;
  }
  try {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(sessionsLoadCache));
  } catch {
    /* ignore quota */
  }
}

/** @param {string} id */
export function deleteSession(id) {
  if (!id) return;
  const next = loadAllSessions().filter((s) => s.id !== id);
  commitCache(next);
  if (diskPersistenceEnabled) {
    void flushChatSessionsPersist().then(() => getBridge()?.chatSessionsDelete?.(id));
    return;
  }
  try {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(sessionsLoadCache));
  } catch {
    /* ignore quota */
  }
}

/** @param {string[]} ids */
export function deleteSessionsByIds(ids) {
  const set = new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0));
  if (set.size === 0) return;
  const next = loadAllSessions().filter((s) => !set.has(s.id));
  commitCache(next);
  if (diskPersistenceEnabled) {
    void flushChatSessionsPersist().then(() => getBridge()?.chatSessionsDeleteMany?.([...set]));
    return;
  }
  try {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(sessionsLoadCache));
  } catch {
    /* ignore quota */
  }
}

/** @param {string} id @returns {ChatSessionRecord | null} */
export function getSession(id) {
  if (!id) return null;
  return loadAllSessions().find((s) => s.id === id) ?? null;
}

/** @param {ChatSessionRecord | null | undefined} rec */
export function isAutomationTaskSessionRecord(rec) {
  return Boolean(rec?.automationTaskSession || rec?.automationCronJobId);
}

/** @param {string} cronJobId */
export function findSessionByAutomationCronJobId(cronJobId) {
  const id = String(cronJobId ?? "").trim();
  if (!id) return null;
  return loadAllSessions().find((s) => s.automationCronJobId === id) ?? null;
}

/**
 * @param {string} id
 * @param {string[]} participantIds
 * @param {PersistedChatMessage[]} [appendMessages]
 */
export function updateSessionParticipants(id, participantIds, appendMessages = []) {
  if (!id) return;
  const rec = getSession(id);
  if (!rec) return;
  const extra = appendMessages.length ? sanitizeMessages(appendMessages) : [];
  const messages = extra.length ? [...rec.messages, ...extra] : rec.messages;
  upsertSession(id, rec.title, messages, {
    channel: rec.channel,
    channelPeerId: rec.channelPeerId,
    gatewayConversationId: rec.gatewayConversationId,
    participantIds,
    threadContext: rec.threadContext,
  });
}

/**
 * @param {string} id
 * @param {ThreadContextState} threadContext
 */
export function updateSessionThreadContext(id, threadContext) {
  if (!id) return;
  const rec = getSession(id);
  if (!rec) return;
  upsertSession(id, rec.title, rec.messages, {
    channel: rec.channel,
    channelPeerId: rec.channelPeerId,
    gatewayConversationId: rec.gatewayConversationId,
    participantIds: rec.participantIds,
    threadContext,
  });
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
