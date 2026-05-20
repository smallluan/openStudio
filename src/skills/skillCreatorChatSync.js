import { preferLongerAssistantText } from "../chat/streamTimelineMerge.js";
import { BUILTIN_CATEGORY_IDS } from "./skillsCatalog.js";
import { extractSkillPathFromText, pathBasename } from "./skillDisplay.js";
import { loadSkillLibrary, saveSkillLibrary } from "./skillsLocalStore.js";

/**
 * Mirrors ChatLabPage `mergeTerminalAssistantPayload` for a single assistant row.
 * @param {*} m
 * @param {{ content?: string; thinking?: string; error?: string; toolTrace?: unknown[]; activityLog?: unknown[]; assistantTimeline?: unknown[] }} extra
 */
function mergeAssistantTerminal(m, extra) {
  /** @type {*} */
  const next = { ...m, streaming: false };
  if (typeof extra?.content === "string") {
    next.content = preferLongerAssistantText(String(m.content ?? ""), extra.content);
  }
  if (typeof extra?.thinking === "string") {
    next.thinking = preferLongerAssistantText(String(m.thinking ?? ""), extra.thinking);
  }
  if (extra?.error) next.error = extra.error;
  if (Array.isArray(extra?.toolTrace)) {
    if (extra.toolTrace.length > 0) next.toolTrace = /** @type {typeof m.toolTrace} */ (extra.toolTrace);
    else delete next.toolTrace;
  }
  if (Array.isArray(extra?.activityLog)) {
    if (extra.activityLog.length > 0) next.activityLog = /** @type {typeof m.activityLog} */ (extra.activityLog);
    else delete next.activityLog;
  }
  if (Array.isArray(extra?.assistantTimeline)) {
    if (extra.assistantTimeline.length > 0) {
      next.assistantTimeline = /** @type {typeof m.assistantTimeline} */ (extra.assistantTimeline);
    } else delete next.assistantTimeline;
  }
  return next;
}

/**
 * @param {Array<{ id: string; role: string }>} messages
 * @param {string} assistantMessageId
 * @param {{ content?: string; thinking?: string; error?: string; toolTrace?: unknown[]; activityLog?: unknown[]; assistantTimeline?: unknown[] }} extra
 */
export function messagesWithTerminalAssistantPayload(messages, assistantMessageId, extra) {
  return messages.map((m) =>
    m.id === assistantMessageId && m.role === "assistant" ? mergeAssistantTerminal(m, extra ?? {}) : m,
  );
}

const DEDUPE_STORAGE_KEY = "openstudio_skill_creator_turn_dedupe_v1";
const MAX_DEDUPE = 200;

/** @param {string} key */
function syncAlreadyRecorded(key) {
  try {
    const raw = localStorage.getItem(DEDUPE_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) && arr.includes(key);
  } catch {
    return false;
  }
}

/** @param {string} key */
function recordSync(key) {
  try {
    const raw = localStorage.getItem(DEDUPE_STORAGE_KEY);
    let arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) arr = [];
    arr.push(key);
    while (arr.length > MAX_DEDUPE) arr.shift();
    localStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} userContent
 * @param {string} assistantContent
 */
function extractSkillTitle(userContent, assistantContent) {
  const assistant = String(assistantContent ?? "");
  const h = assistant.match(/^#\s+(.+)$/m) || assistant.match(/\n#{1,3}\s+(.+)$/m);
  if (h) return h[1].trim().slice(0, 120);
  const labeled = assistant.match(/(?:技能名称|技能名|Skill\s*name)[:：]\s*([^\n]+)/i);
  if (labeled) return labeled[1].trim().slice(0, 120);
  const line = String(userContent ?? "")
    .split("\n")[0]
    .trim()
    .replace(/^["「『]|["」』]$/g, "");
  if (line) return line.slice(0, 120);
  return "Skill Creator";
}

/**
 * @param {string} assistant
 * @param {string} conversationId
 */
function buildDescription(assistant, conversationId) {
  const body = String(assistant ?? "").trim().slice(0, 4000);
  return `${body}\n\n——\n${conversationId}`.trim();
}

/**
 * After a Skill Creator turn finishes, add a local library row so "My skills" reflects the run.
 * @param {Array<{ id: string; role: string; content?: string; thinking?: string; error?: string; skillMeta?: unknown }>} messages
 * @param {string} conversationId
 * @param {string} assistantMessageId
 */
export function syncSkillCreatorResultToLibrary(messages, conversationId, assistantMessageId) {
  if (typeof window === "undefined") return;
  const idx = messages.findIndex((m) => m.id === assistantMessageId && m.role === "assistant");
  if (idx < 1) return;
  const assistant = messages[idx];
  const user = messages[idx - 1];
  if (user?.role !== "user") return;
  const sm = user.skillMeta;
  if (!sm || typeof sm !== "object" || sm.kind !== "openclaw" || sm.slug !== "skill-creator") return;
  if (assistant.error) return;
  const content = String(assistant.content ?? "").trim();
  if (content.length < 50) return;
  const dedupeKey = `${conversationId}:${user.id}`;
  if (syncAlreadyRecorded(dedupeKey)) return;

  const localPath = extractSkillPathFromText(content);
  const title = localPath
    ? pathBasename(localPath)
    : extractSkillTitle(String(user.content ?? ""), content);
  const description = buildDescription(content, conversationId);
  const row = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `skill-${Date.now()}`,
    title,
    description,
    categoryId: BUILTIN_CATEGORY_IDS.GENERAL,
    fromNl: true,
    ...(localPath ? { localPath } : {}),
    createdAt: Date.now(),
  };
  const lib = loadSkillLibrary();
  lib.userSkills = [...lib.userSkills, row];
  saveSkillLibrary(lib);
  recordSync(dedupeKey);
  window.dispatchEvent(new Event("openstudio-skill-library-changed"));
}
