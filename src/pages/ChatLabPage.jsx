import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import {
  CONTEXT_WINDOW_APPROX_TOKENS,
  approxTokensFromChars,
  estimateThreadCharBudget,
  gatewayUserMessageBody,
  openClawAttachmentsFromComposer,
  MAX_CHAT_COMPOSER_IMAGES,
  readImageFileAsComposerAttachment,
} from "../chat/chatLabComposerAttachments.js";
import {
  formatChoiceSequenceReply,
  formatQuestionnaireReplyMessage,
  parseAssistantQuickReplies,
} from "../chat/assistantQuickReplyParse.js";
import { preferLongerAssistantText, reconcileTimelineWithCanonicalText } from "../chat/streamTimelineMerge.js";
import { normalizeLatexMathDelimitersForRemark } from "../chat/normalizeLatexMathDelimitersForRemark.js";
import {
  CHAT_SESSION_CHANNEL_WECHAT,
  deriveTitleFromMessages,
  getSession,
  loadAllSessions,
  renameSession,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import { startWechatTypingPulse } from "../chat/wechatStreamTyping.js";
import { isWechatPendingAssistantId } from "../chat/useWechatSessionSync.js";
import ChatLabHero from "../components/chat-lab/ChatLabHero.jsx";
import { useBootstrapHeroRelease } from "../components/chat-lab/useBootstrapHeroRelease.js";
import { useBootstrapGate } from "../context/BootstrapGateContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import {
  useChatLabStreaming,
  useGatewayStreamSlice,
} from "../context/ChatLabStreamingContext.jsx";
import { useRafThrottledValue } from "../hooks/useRafThrottle.js";
import { createChatLabMarkdownComponents, chatMarkdownPlainText } from "../components/chat-lab/chatLabMarkdown.jsx";
import ChatLabPreviewDock from "../components/chat-lab/ChatLabPreviewDock.jsx";
import {
  ChatLabPreviewContext,
  ChatLabPreviewProvider,
  useChatLabPreview,
} from "../context/ChatLabPreviewContext.jsx";
import { lastHtmlFenceAsSrcDocDocument, previewKindFromHref } from "../chat/chatLabDocumentPreview.js";
import { collectSessionArtifacts } from "../chat/chatLabSessionArtifacts.js";
import ChatLabArtifactsBar from "../components/chat-lab/ChatLabArtifactsBar.jsx";
import { TraceDisclosure, TraceRowChevron, TraceStepGlyph } from "../components/chat-lab/TraceDisclosure.jsx";
import {
  ComposerSkillChip,
  ComposerSkillSlashPopover,
  ComposerSkillToolbarPicker,
  isSlashOnlyComposerDraft,
  stripSlashPickerPrefix,
} from "../components/chat-lab/ChatLabComposerSkills.jsx";
import { ChatLabContextMeter } from "../components/chat-lab/ChatLabContextMeter.jsx";
import {
  listSkillsForPicker,
  pickRowFromSkillMeta,
  skillMetaFromPickRow,
  skillPickRowToPayload,
} from "../skills/skillRegistry.js";
import { useSkillEnvironment } from "../skills/useSkillEnvironment.js";
import { isSkillCreationNlIntent } from "../skills/skillCreationNlIntent.js";
import {
  messagesWithTerminalAssistantPayload,
  syncSkillCreatorResultToLibrary,
} from "../skills/skillCreatorChatSync.js";
import { cn } from "../ui/cn.js";
import Select from "../ui/Select.jsx";
import { CHAT_MD_REHYPE_PLUGINS } from "../chat/chatLabRehypePlugins.js";

/** Markdown pipelines for chat bubbles (GFM + LaTeX via KaTeX). */
const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

/** Min height of the chat composer textarea in px (~5.5rem at default root font size). */
const CHAT_LAB_COMPOSER_TEXT_MIN_PX = 88;
/** Hard cap for composer textarea max height before viewport ratio is applied. */
const CHAT_LAB_COMPOSER_TEXT_MAX_CAP_PX = 400;

const ERROR_CODE_KEY_MAP = {
  missing_gateway_url: "chatLab.gatewayUrlMissing",
  http_401: "chatLab.gatewayAuthFailed",
  http_404: "chatLab.gatewayHttp404",
};

/** @returns {string} */
function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/** @typedef {import("../i18n/messages.js").LocaleId} LocaleId */

/** @param {number} ts @param {LocaleId} locale */
function formatMessageTimestamp(ts, locale) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const tag =
    locale === "zh-TW" ? "zh-TW" : locale === "zh-CN" ? "zh-CN" : locale === "ja" ? "ja-JP" : "en-US";
  try {
    return new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/**
 * History rows posted to OpenClaw (system + tail user line are appended by the caller).
 * Put OpenClaw `attachments` only when `includeImageAttachments` is true (latest user turn);
 * earlier turns use short "[N images attached]" text so we do not resend base64 every request.
 * @param {Array<{role: string; content?: string; thinking?: string; error?: string; imageAttachments?: unknown}>} msgs
 * @param {{ includeImageAttachments?: boolean }} [opts]
 */
function buildGatewayPayloadRows(msgs, opts = {}) {
  const includeImageAttachments = opts.includeImageAttachments === true;
  return msgs
    .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
    .map((m) => {
      if (m.role !== "assistant") {
        const row = {
          role: m.role,
          content: gatewayUserMessageBody(m.content, m.imageAttachments),
        };
        if (includeImageAttachments) {
          const att = openClawAttachmentsFromComposer(m.imageAttachments);
          if (att) Object.assign(row, { attachments: att });
        }
        return row;
      }
      const c = String(m.content ?? "").trim();
      const th = String(m.thinking ?? "").trim();
      return { role: m.role, content: c || th || "" };
    });
}

/**
 * Legacy sessions may omit `createdAt`; derive monotonic times so UI can show hover timestamps.
 * @template {{ createdAt?: number }} T
 * @param {T[]} rows
 * @param {number} sessionUpdatedAt
 * @returns {T[]}
 */
function withBackfilledCreatedAt(rows, sessionUpdatedAt) {
  const base =
    typeof sessionUpdatedAt === "number" && Number.isFinite(sessionUpdatedAt) && sessionUpdatedAt > 0
      ? sessionUpdatedAt
      : Date.now();
  const n = rows.length;
  const step = 900;
  return rows.map((row, i) => {
    if (typeof row.createdAt === "number" && Number.isFinite(row.createdAt)) return row;
    return { ...row, createdAt: base - (n - 1 - i) * step };
  });
}

/**
 * @param {import("../chat/chatSessionsStore.js").PersistedChatMessage} m
 * @param {{ streaming?: boolean }} [opts]
 */
function mapSessionMessageRow(m, opts = {}) {
  const streaming = Boolean(opts.streaming);
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(m.thinking ? { thinking: m.thinking } : {}),
    ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
    ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
    ...(Array.isArray(m.assistantTimeline) && m.assistantTimeline.length
      ? { assistantTimeline: m.assistantTimeline }
      : {}),
    ...(typeof m.createdAt === "number" && Number.isFinite(m.createdAt) ? { createdAt: m.createdAt } : {}),
    ...(m.skillMeta ? { skillMeta: m.skillMeta } : {}),
    ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
      ? { imageAttachments: m.imageAttachments }
      : {}),
    streaming,
  };
}

/**
 * @param {import("../chat/chatSessionsStore.js").ChatSessionRecord} rec
 * @param {{
 *   active?: boolean;
 *   conversationId?: string;
 *   assistantMessageId?: string;
 *   content?: string;
 *   thinking?: string;
 *   toolTrace?: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *   activityLog?: import("../chat/toolTraceMerge.js").ActivityRow[];
 *   assistantTimeline?: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 * } | null | undefined} gatewaySlice
 */
/** @param {string} assistantMessageId */
function wechatAssistantSourceKey(assistantMessageId) {
  const id = String(assistantMessageId ?? "");
  if (id.startsWith("wechat-replying-")) return id.slice("wechat-replying-".length);
  if (id.startsWith("wechat-assistant-")) return id.slice("wechat-assistant-".length);
  return "";
}

function dedupeWechatAssistantStoreRows(messages) {
  const finals = new Set(
    messages
      .filter((m) => m.role === "assistant" && String(m.id ?? "").startsWith("wechat-assistant-"))
      .map((m) => wechatAssistantSourceKey(m.id))
      .filter(Boolean),
  );
  return messages.filter((m) => {
    if (!isWechatPendingAssistantId(m.id)) return true;
    const src = wechatAssistantSourceKey(m.id);
    return !src || !finals.has(src);
  });
}

function mapSessionRecordToUiMessages(rec, gatewaySlice) {
  let activeAssistantId =
    gatewaySlice?.active && gatewaySlice.conversationId === rec.id
      ? String(gatewaySlice.assistantMessageId ?? "").trim()
      : "";
  /** @type {typeof rec.messages} */
  let storeRows = Array.isArray(rec.messages) ? rec.messages : [];
  if (rec.channel === CHAT_SESSION_CHANNEL_WECHAT) {
    storeRows = dedupeWechatAssistantStoreRows(storeRows);
    if (activeAssistantId && isWechatPendingAssistantId(activeAssistantId)) {
      const src = wechatAssistantSourceKey(activeAssistantId);
      const finalId = src ? `wechat-assistant-${src}` : "";
      if (finalId && storeRows.some((m) => m.id === finalId)) {
        activeAssistantId = finalId;
      }
    }
  }
  if (activeAssistantId && !storeRows.some((m) => m.id === activeAssistantId)) {
    storeRows = [
      ...storeRows,
      {
        id: activeAssistantId,
        role: /** @type {const} */ ("assistant"),
        content: "",
        createdAt: Date.now(),
      },
    ];
  }
  let rows = storeRows.map((m) =>
    mapSessionMessageRow(m, { streaming: Boolean(activeAssistantId && m.id === activeAssistantId) }),
  );
  if (activeAssistantId && gatewaySlice) {
    rows = rows.map((m) => {
      if (m.id !== activeAssistantId) return m;
      return {
        ...m,
        streaming: true,
        content: gatewaySlice.content ?? m.content,
        ...(gatewaySlice.thinking || m.thinking
          ? { thinking: gatewaySlice.thinking ?? m.thinking }
          : {}),
        ...(gatewaySlice.toolTrace?.length ? { toolTrace: gatewaySlice.toolTrace } : {}),
        ...(gatewaySlice.activityLog?.length ? { activityLog: gatewaySlice.activityLog } : {}),
        ...(gatewaySlice.assistantTimeline?.length
          ? { assistantTimeline: gatewaySlice.assistantTimeline }
          : {}),
      };
    });
  }
  return withBackfilledCreatedAt(rows, rec.updatedAt);
}

/** @param {string} conversationId @returns {() => void} */
function maybeStartWechatTypingPulse(conversationId) {
  const rec = getSession(conversationId);
  const peerId =
    rec?.channel === CHAT_SESSION_CHANNEL_WECHAT ? String(rec.channelPeerId ?? "").trim() : "";
  return peerId ? startWechatTypingPulse(peerId) : () => {};
}

/**
 * Compute whether the stored config is enough to make a chat call.
 * Returns a short locale key describing the first problem, or null when OK.
 * @param {*} cfg
 */
function deriveConfigIssueKey(cfg) {
  if (!cfg) return "chatLab.gatewayUrlMissing";
  const url = String(cfg.openclaw?.gatewayBaseUrl ?? "").trim();
  if (!url) return "chatLab.gatewayUrlMissing";
  const profiles = Array.isArray(cfg.modelProfiles) ? cfg.modelProfiles : [];
  const activeId = typeof cfg.activeModelProfileId === "string" ? cfg.activeModelProfileId.trim() : "";
  const enabledIds = Array.isArray(cfg.enabledModelProfileIds)
    ? cfg.enabledModelProfileIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)
    : (activeId ? [activeId] : []);
  const enabled = enabledIds
    .map((id) => profiles.find((p) => p && p.id === id))
    .filter(Boolean);
  if (enabled.length === 0) return "chatLab.modelNeedConfig";
  const selected = activeId ? enabled.find((p) => p.id === activeId) : enabled[0];
  const provider = String(selected?.provider ?? "").trim();
  const modelId = String(selected?.modelId ?? "").trim();
  if (!provider) return "chatLab.providerMissing";
  if (!modelId) return "chatLab.modelIdMissing";
  return null;
}

/** @param {(key: string, vars?: Record<string, string | number>) => string} t */
function providerLabelFromId(t, providerId) {
  if (!providerId) return "";
  return t(`userConfig.providerOptions.${providerId}`);
}

/**
 * Map a raw backend error (often `http_401`) to a localized string.
 * @param {string} raw
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
function formatStreamError(raw, t) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return t("chatLab.unknownError");
  if (trimmed.startsWith("missing_gateway_url")) return t(ERROR_CODE_KEY_MAP.missing_gateway_url);
  if (trimmed.startsWith("gateway_unreachable")) {
    const detail = trimmed.replace(/^gateway_unreachable\s*[—:]\s*/i, "").trim();
    return detail ? t("chatLab.gatewayUnreachableDetail", { detail }) : t("chatLab.gatewayUnreachable");
  }
  if (trimmed.startsWith("gateway_missing_operator_scope")) return t("chatLab.gatewayMissingOperatorScope");
  const httpMatch = trimmed.match(/^http_(\d{3})\b/);
  if (httpMatch) {
    const code = `http_${httpMatch[1]}`;
    if (ERROR_CODE_KEY_MAP[code]) return t(ERROR_CODE_KEY_MAP[code]);
  }
  return trimmed;
}

/** @param {unknown} raw */
function isChatHttp404(raw) {
  return /^http_404\b/.test(String(raw ?? "").trim());
}

/**
 * Terminal IPC snapshots can briefly race ahead of the last `content_sync`; never clobber
 * non-empty assistant text/thinking with an empty terminal payload.
 * @param {*} m
 * @param {{
 *   content?: string;
 *   thinking?: string;
 *   error?: string;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }} extra
 */
function mergeTerminalAssistantPayload(m, extra) {
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
      const tl = /** @type {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */ (
        extra.assistantTimeline
      );
      const canon = typeof next.content === "string" ? next.content : "";
      next.assistantTimeline =
        canon.trim().length > 0 ? reconcileTimelineWithCanonicalText(tl, canon) : tl;
    } else delete next.assistantTimeline;
  }
  return next;
}

/** Active thread first, then most-recent locals — matches main-process prewarm cap. */
function buildStudioGatewayPrewarmIds(currentConversationId, max) {
  const cap = Math.min(Math.max(max, 1), 24);
  const sorted = [...loadAllSessions()].sort((a, b) => b.updatedAt - a.updatedAt);
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const push = (id) => {
    const t = typeof id === "string" ? id.trim() : "";
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  push(currentConversationId);
  for (const r of sorted) push(r.id);
  return out.slice(0, cap);
}


export default function ChatLabPage() {
  const { theme } = useTheme();
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramC = searchParams.get("c");

  const draftIdRef = useRef(/** @type {string | null} */ (null));
  if (paramC) {
    draftIdRef.current = null;
  } else if (!draftIdRef.current) {
    draftIdRef.current = newId();
  }
  const conversationId = paramC || draftIdRef.current;

  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.startChatStream);
  const skillEnv = useSkillEnvironment();
  const skillPickEnv = useMemo(
    () => (skillEnv.loading ? { platform: skillEnv.platform, loading: true } : skillEnv),
    [skillEnv],
  );

  const [config, setConfig] = useState(/** @type {* | null} */ (null));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [messages, setMessages] = useState(
    /** @type {Array<{id: string; role: "user" | "assistant"; content: string; thinking?: string; streaming?: boolean; error?: string; toolTrace?: import("../chat/toolTraceMerge.js").ToolTraceRow[]; activityLog?: import("../chat/toolTraceMerge.js").ActivityRow[]; assistantTimeline?: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]; createdAt?: number}>} */
    ([]),
  );
  /** Only the freshly sent user bubble plays the enter animation. */
  const [userBubbleEnterMessageId, setUserBubbleEnterMessageId] = useState(
    /** @type {string | null} */ (null),
  );
  const [input, setInput] = useState("");
  /** Pending image files in the composer (drag / paste); sent as user message attachments. */
  const [composerAttachments, setComposerAttachments] = useState(
    /** @type {Array<{ id: string; name: string; mime: string; dataUrl: string }>} */
    ([]),
  );
  const [composerDragActive, setComposerDragActive] = useState(false);
  /** Locale key last shown for attachment errors (translated at render). */
  const [composerAttachErrKey, setComposerAttachErrKey] = useState(/** @type {string | null} */ (null));
  const composerDragDepthRef = useRef(0);
  /** OpenClaw / user skill row for the composer — prefixed to gateway message only (not stored in bubble). */
  const [composerSkillRow, setComposerSkillRow] = useState(
    /** @type {import("../skills/skillRegistry.js").SkillPickRow | null} */ (null),
  );
  const [composerSkillRowLeaving, setComposerSkillRowLeaving] = useState(false);
  const [composerAttachmentsLeaving, setComposerAttachmentsLeaving] = useState(false);
  const textareaRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const composerResizeDragRef = useRef(
    /** @type {{ startY: number; startH: number }} */ ({ startY: 0, startH: CHAT_LAB_COMPOSER_TEXT_MIN_PX }),
  );
  const composerResizeDraggingRef = useRef(false);
  const [composerMaxPx, setComposerMaxPx] = useState(() =>
    typeof window === "undefined"
      ? CHAT_LAB_COMPOSER_TEXT_MAX_CAP_PX
      : Math.min(CHAT_LAB_COMPOSER_TEXT_MAX_CAP_PX, Math.round(window.innerHeight * 0.48)),
  );
  const [composerTextareaPx, setComposerTextareaPx] = useState(CHAT_LAB_COMPOSER_TEXT_MIN_PX);
  const [composerLongTextMode, setComposerLongTextMode] = useState(false);
  const [composerResizeDragging, setComposerResizeDragging] = useState(false);
  const [composerResizeStripHover, setComposerResizeStripHover] = useState(false);
  const [composerResizeGripX, setComposerResizeGripX] = useState(0);
  /** When set, the next send replaces this user message and truncates the thread below it (unless the tag is dismissed). */
  const [pendingEditMessageId, setPendingEditMessageId] = useState(/** @type {string | null} */ (null));
  const pendingEditMessageIdRef = useRef(/** @type {string | null} */ (null));
  useEffect(() => {
    pendingEditMessageIdRef.current = pendingEditMessageId;
  }, [pendingEditMessageId]);
  const [gatewayPhase, setGatewayPhase] = useState(
    /** @type {"loading" | "checking" | "online" | "offline"} */ ("loading"),
  );
  /** When true, chat returned HTTP 404 — keep composer locked until a full probe succeeds again. */
  const [chatApiBlocked, setChatApiBlocked] = useState(false);
  const [probeRestartKey, setProbeRestartKey] = useState(0);
  const [toolbarModelId, setToolbarModelId] = useState("");

  /** The id of the assistant bubble currently being filled (if any). */
  const activeAssistantIdRef = useRef(/** @type {string | null} */ (null));
  /** The streamId tracked by main process for abort. */
  const activeStreamIdRef = useRef(/** @type {string | null} */ (null));
  const messagesRef = useRef(messages);
  const messagesScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const autoScrollRef = useRef(true);

  const { beginGatewayStream, resetGatewayStream } = useChatLabStreaming();
  const gatewaySliceForConv = useGatewayStreamSlice(conversationId);
  const gatewaySliceRef = useRef(gatewaySliceForConv);
  gatewaySliceRef.current = gatewaySliceForConv;
  const throttledStreamContent = useRafThrottledValue(gatewaySliceForConv?.content ?? "");
  const throttledStreamThinking = useRafThrottledValue(gatewaySliceForConv?.thinking ?? "");
  const gatewayStreaming = Boolean(gatewaySliceForConv?.active);

  /** Switching threads clears send guards; finalize skips terminal events when conversationId mismatch left refs stuck. */
  useEffect(() => {
    activeAssistantIdRef.current = null;
    activeStreamIdRef.current = null;
    setPendingEditMessageId(null);
    setComposerSkillRow(null);
    setComposerAttachments([]);
    setComposerDragActive(false);
    composerDragDepthRef.current = 0;
    setComposerLongTextMode(false);
    setComposerTextareaPx(CHAT_LAB_COMPOSER_TEXT_MIN_PX);
    setComposerResizeDragging(false);
    composerResizeDraggingRef.current = false;
    setComposerResizeStripHover(false);
  }, [conversationId]);

  const composerSnapPx = useMemo(() => Math.round(composerMaxPx * 0.72), [composerMaxPx]);

  useEffect(() => {
    const upd = () => {
      setComposerMaxPx(
        Math.min(CHAT_LAB_COMPOSER_TEXT_MAX_CAP_PX, Math.round(window.innerHeight * 0.48)),
      );
    };
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  useEffect(() => {
    setComposerTextareaPx((h) => {
      if (composerLongTextMode) return composerMaxPx;
      return Math.min(Math.max(h, CHAT_LAB_COMPOSER_TEXT_MIN_PX), composerMaxPx);
    });
  }, [composerMaxPx, composerLongTextMode]);

  const composerLongTextEnteredRef = useRef(false);
  useEffect(() => {
    if (composerLongTextMode && !composerLongTextEnteredRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    composerLongTextEnteredRef.current = composerLongTextMode;
  }, [composerLongTextMode]);

  const skillPickList = useMemo(() => listSkillsForPicker(skillPickEnv), [skillPickEnv]);

  const clearComposerSkillRow = useCallback(() => {
    setComposerSkillRowLeaving(true);
    setTimeout(() => {
      setComposerSkillRow(null);
      setComposerSkillRowLeaving(false);
    }, 180);
  }, []);

  const clearComposerAttachments = useCallback(() => {
    setComposerAttachmentsLeaving(true);
    setTimeout(() => {
      setComposerAttachments([]);
      setComposerAttachmentsLeaving(false);
    }, 180);
  }, []);

  const firstComposerLine = (input.split("\n")[0] ?? "");
  const slashSkillMenuActive = !composerSkillRow && firstComposerLine.startsWith("/");
  const slashFilterQuery = slashSkillMenuActive ? firstComposerLine.slice(1) : "";

  /** Background `#studio:` prewarm (non-blocking); `urgentFirst` keeps the visible thread ahead of historical sessions on the hydrate queue. */
  useEffect(() => {
    if (!isElectron || !bridge?.prewarmStudioGatewaySessions || !conversationId) return undefined;
    const ids = buildStudioGatewayPrewarmIds(conversationId, 12);
    if (ids.length === 0) return undefined;
    void bridge
      .prewarmStudioGatewaySessions({ conversationIds: ids, max: 12, urgentFirst: true })
      .catch(() => {});
    return undefined;
  }, [isElectron, conversationId]);

  const [sessionTitleBump, setSessionTitleBump] = useState(0);
  useEffect(() => {
    const bump = () => setSessionTitleBump((x) => x + 1);
    window.addEventListener("openstudio-chat-sessions-changed", bump);
    return () => window.removeEventListener("openstudio-chat-sessions-changed", bump);
  }, []);

  const headerTitle = useMemo(() => {
    void sessionTitleBump;
    const id = conversationId;
    if (!id) return "";
    const rec = getSession(id);
    if (rec?.title) return rec.title;
    return deriveTitleFromMessages(messages, { imageFallback: t("chatLab.chatUntitledImage") });
  }, [conversationId, messages, sessionTitleBump, t]);

  const sessionArtifacts = useMemo(() => collectSessionArtifacts(messages), [messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const prevParamCRef = useRef(/** @type {string | null} */ (null));

  useEffect(() => {
    const prev = prevParamCRef.current;
    prevParamCRef.current = paramC;

    if (!paramC) {
      if (prev != null) {
        setMessages([]);
        setChatApiBlocked(false);
      } else if (messagesRef.current.length === 0) {
        setChatApiBlocked(false);
      }
      return;
    }

    const rec = getSession(paramC);
    if (rec) {
      setMessages(mapSessionRecordToUiMessages(rec, null));
      setChatApiBlocked(false);
      return;
    }
    if (messagesRef.current.length > 0) return;
    navigate("/chat", { replace: true });
  }, [navigate, paramC]);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [paramC]);

  /** WeChat inbound / store updates: keep the open thread aligned with sidebar persistence (avoids race with auto-reply). */
  useEffect(() => {
    if (!paramC) return undefined;

    const mergeWechatThreadFromStore = () => {
      const rec = getSession(paramC);
      if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) return;
      const liveSlice = gatewaySliceRef.current;
      if (liveSlice?.active && liveSlice.conversationId === paramC) {
        return;
      }
      let slice = liveSlice?.conversationId === paramC ? liveSlice : null;
      if (
        slice?.active &&
        isWechatPendingAssistantId(slice.assistantMessageId) &&
        Array.isArray(rec.messages)
      ) {
        const src = wechatAssistantSourceKey(slice.assistantMessageId);
        const finalId = src ? `wechat-assistant-${src}` : "";
        if (finalId && rec.messages.some((m) => m.id === finalId)) {
          slice = null;
        }
      }
      setMessages(mapSessionRecordToUiMessages(rec, slice));
    };

    /** @param {Event} ev */
    const onWechatInbound = (ev) => {
      const cid = String(/** @type {CustomEvent} */ (ev).detail?.conversationId ?? "").trim();
      if (cid && cid === paramC) mergeWechatThreadFromStore();
    };

    window.addEventListener("openstudio-chat-sessions-changed", mergeWechatThreadFromStore);
    window.addEventListener("openstudio-wechat-session-inbound", onWechatInbound);
    return () => {
      window.removeEventListener("openstudio-chat-sessions-changed", mergeWechatThreadFromStore);
      window.removeEventListener("openstudio-wechat-session-inbound", onWechatInbound);
    };
  }, [paramC]);

  /** Gateway stream may start before the pending WeChat assistant row is in React state. */
  useEffect(() => {
    if (!paramC || !gatewaySliceForConv?.active) return;
    if (gatewaySliceForConv.conversationId !== paramC) return;
    const assistantMessageId = gatewaySliceForConv.assistantMessageId;
    setMessages((prev) => {
      if (prev.some((m) => m.id === assistantMessageId)) return prev;
      const rec = getSession(paramC);
      if (!rec) return prev;
      return mapSessionRecordToUiMessages(rec, gatewaySliceForConv);
    });
  }, [
    gatewaySliceForConv,
    gatewaySliceForConv?.active,
    gatewaySliceForConv?.assistantMessageId,
    gatewaySliceForConv?.conversationId,
    paramC,
  ]);

  /** Deep-link from Skills: open chat with OpenClaw skill slug pre-selected (e.g. skill-creator). */
  useEffect(() => {
    if (paramC) return;
    const slug = searchParams.get("composeSkill")?.trim();
    if (!slug) return;
    const row = skillPickList.find((r) => r.kind === "openclaw" && r.slug === slug);
    if (row) setComposerSkillRow(row);
    const prefillEnc = searchParams.get("prefill");
    if (prefillEnc) {
      try {
        setInput(decodeURIComponent(prefillEnc));
      } catch {
        /* ignore malformed prefill */
      }
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("composeSkill");
        next.delete("prefill");
        return next;
      },
      { replace: true },
    );
  }, [paramC, searchParams, setSearchParams, skillPickList]);

  useEffect(() => {
    if (!conversationId) return;
    if (messages.length === 0) return;
    if (gatewayStreaming) return;

    const h = window.setTimeout(() => {
      const toSave = messages
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            !m.error &&
            !isWechatPendingAssistantId(m.id),
        )
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking && String(m.thinking).trim() ? { thinking: m.thinking } : {}),
          ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
          ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
          ...(Array.isArray(m.assistantTimeline) && m.assistantTimeline.length
            ? { assistantTimeline: m.assistantTimeline }
            : {}),
          ...(typeof m.createdAt === "number" ? { createdAt: m.createdAt } : {}),
          ...(m.skillMeta ? { skillMeta: m.skillMeta } : {}),
          ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
            ? { imageAttachments: m.imageAttachments }
            : {}),
        }));
      if (toSave.length === 0) return;
      const title = deriveTitleFromMessages(messages, { imageFallback: t("chatLab.chatUntitledImage") });
      upsertSession(conversationId, title || "…", toSave);
    }, 380);

    return () => window.clearTimeout(h);
  }, [messages, conversationId, gatewayStreaming, t]);

  const reloadConfig = useCallback(async () => {
    if (!bridge?.getUserConfig) {
      setConfigLoaded(true);
      return;
    }
    try {
      const c = await bridge.getUserConfig();
      setConfig(c ?? null);
    } catch {
      setConfig(null);
    } finally {
      setConfigLoaded(true);
    }
  }, [bridge]);

  useEffect(() => {
    reloadConfig();
  }, [reloadConfig]);

  useEffect(() => {
    const onFocus = () => {
      void reloadConfig();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadConfig]);

  useEffect(() => {
    void reloadConfig();
  }, [location.key, reloadConfig]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => {
      if (document.visibilityState === "visible") reloadConfig();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reloadConfig]);

  const configIssueKey = useMemo(() => deriveConfigIssueKey(config), [config]);
  const enabledModelOptions = useMemo(() => {
    const profiles = Array.isArray(config?.modelProfiles) ? config.modelProfiles : [];
    const activeId = typeof config?.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
    const enabledIds = Array.isArray(config?.enabledModelProfileIds)
      ? config.enabledModelProfileIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)
      : (activeId ? [activeId] : []);
    return enabledIds
      .map((id) => profiles.find((p) => p && p.id === id))
      .filter(Boolean)
      .map((p) => {
        const provider = providerLabelFromId(t, String(p.provider ?? ""));
        const modelId = String(p.modelId ?? "").trim();
        const labelCore = modelId || t("chatLab.modelNeedConfig");
        const label = provider ? `${provider} · ${labelCore}` : labelCore;
        return { value: p.id, label };
      });
  }, [config?.enabledModelProfileIds, config?.modelProfiles, t]);

  useEffect(() => {
    const activeId = typeof config?.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
    const next = enabledModelOptions.some((o) => o.value === activeId)
      ? activeId
      : (enabledModelOptions[0]?.value ?? "");
    setToolbarModelId(next);
  }, [config?.activeModelProfileId, enabledModelOptions]);

  const applyToolbarModelId = useCallback(
    async (pid) => {
      const nextId = String(pid ?? "").trim();
      if (!nextId || !bridge?.setUserConfig) return;
      if (!enabledModelOptions.some((o) => o.value === nextId)) return;
      try {
        const c = await bridge.setUserConfig({ activeModelProfileId: nextId });
        setConfig(c ?? null);
      } catch {
        /* ignore */
      }
    },
    [bridge, enabledModelOptions],
  );

  useEffect(() => {
    if (!isElectron || !bridge?.warmGatewayChatPrep) return;
    if (!configLoaded || configIssueKey) return;
    void bridge.warmGatewayChatPrep();
  }, [bridge, configIssueKey, configLoaded, isElectron]);

  useEffect(() => {
    if (!isElectron || !bridge?.probeGateway) {
      setGatewayPhase("online");
      return undefined;
    }
    if (!configLoaded) {
      setGatewayPhase("loading");
      return undefined;
    }
    if (configIssueKey) {
      setGatewayPhase("online");
      return undefined;
    }

    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let retryTimer;

    const scheduleRetry = () => {
      retryTimer = setTimeout(() => {
        runProbe();
      }, 3000);
    };

    async function runProbe() {
      if (cancelled) return;
      setGatewayPhase("checking");
      try {
        const r = await bridge.probeGateway();
        if (cancelled) return;
        if (r?.ok) {
          setGatewayPhase("online");
          setChatApiBlocked(false);
        } else {
          setGatewayPhase("offline");
          scheduleRetry();
        }
      } catch {
        if (cancelled) return;
        setGatewayPhase("offline");
        scheduleRetry();
      }
    }

    runProbe();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    /** Avoid re-probing on every route change — redundant WS handshake load on the gateway. */
  }, [bridge, configIssueKey, configLoaded, isElectron, probeRestartKey]);

  useEffect(() => {
    if (!gatewaySliceForConv) return;
    const { assistantMessageId, active, toolTrace, activityLog, assistantTimeline } = gatewaySliceForConv;
    const content = throttledStreamContent;
    const thinking = throttledStreamThinking;
    setMessages((prev) => {
      let idx = prev.findIndex((m) => m.id === assistantMessageId);
      let rowId = assistantMessageId;
      if (idx === -1 && isWechatPendingAssistantId(assistantMessageId)) {
        const finalId = assistantMessageId.replace(/^wechat-replying-/, "wechat-assistant-");
        idx = prev.findIndex((m) => m.id === finalId);
        if (idx !== -1) rowId = finalId;
      }
      if (idx === -1) return prev;
      return prev.map((m) => {
        if (m.id !== rowId) return m;
        const next = { ...m, content, thinking, streaming: active };
        if (toolTrace && toolTrace.length > 0) next.toolTrace = toolTrace;
        if (activityLog && activityLog.length > 0) next.activityLog = activityLog;
        if (Array.isArray(assistantTimeline)) {
          if (assistantTimeline.length > 0) next.assistantTimeline = assistantTimeline;
          else delete next.assistantTimeline;
        }
        return next;
      });
    });
  }, [gatewaySliceForConv, paramC, throttledStreamContent, throttledStreamThinking]);

  const prevSliceForConvRef = useRef(/** @type {typeof gatewaySliceForConv} */ (null));
  useEffect(() => {
    const prev = prevSliceForConvRef.current;
    prevSliceForConvRef.current = gatewaySliceForConv;
    if (prev && !gatewaySliceForConv && prev.conversationId === conversationId) {
      setMessages((pm) =>
        pm.some((m) => m.streaming)
          ? pm.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          : pm,
      );
    }
  }, [conversationId, gatewaySliceForConv]);

  const finalizeAssistantById = useCallback(
    (assistantId, extra) => {
      if (!assistantId) return;
      activeAssistantIdRef.current = null;
      activeStreamIdRef.current = null;
      const finalId = isWechatPendingAssistantId(assistantId)
        ? assistantId.replace(/^wechat-replying-/, "wechat-assistant-")
        : assistantId;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === assistantId || m.id === finalId);
        if (idx !== -1) {
          return prev.map((m) => {
            if (m.id !== assistantId && m.id !== finalId) return m;
            const merged = mergeTerminalAssistantPayload(m, extra ?? {});
            if (finalId !== assistantId) merged.id = finalId;
            return merged;
          });
        }
        const rec = conversationId ? getSession(conversationId) : null;
        if (!rec) return prev;
        return mapSessionRecordToUiMessages(rec, null).map((m) => {
          if (m.id !== assistantId && m.id !== finalId) return m;
          const merged = mergeTerminalAssistantPayload(m, extra ?? {});
          if (finalId !== assistantId) merged.id = finalId;
          return merged;
        });
      });
    },
    [conversationId],
  );

  useEffect(() => {
    /** @param {Event} e */
    const fn = (e) => {
      const ce = /** @type {CustomEvent} */ (e);
      const d = ce.detail;
      if (!d || d.conversationId !== conversationId) return;
      const sessionRec = getSession(conversationId);
      if (sessionRec?.channel === CHAT_SESSION_CHANNEL_WECHAT) {
        if (d.kind === "done" || d.kind === "aborted" || d.kind === "error") {
          const slice =
            gatewaySliceRef.current?.conversationId === conversationId
              ? gatewaySliceRef.current
              : null;
          let effectiveSlice = slice;
          if (
            slice?.active &&
            isWechatPendingAssistantId(d.assistantMessageId) &&
            Array.isArray(sessionRec.messages)
          ) {
            const src = wechatAssistantSourceKey(d.assistantMessageId);
            const finalId = src ? `wechat-assistant-${src}` : "";
            if (finalId && sessionRec.messages.some((m) => m.id === finalId)) {
              effectiveSlice = null;
            }
          }
          setMessages(mapSessionRecordToUiMessages(sessionRec, effectiveSlice));
        }
        return;
      }
      if (d.kind === "error") {
        const raw = String(d.message ?? "");
        const msg = formatStreamError(raw, t);
        finalizeAssistantById(d.assistantMessageId, {
          error: msg,
          ...(typeof d.content === "string" ? { content: d.content } : {}),
          ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
          ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
          ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
          ...(Array.isArray(d.assistantTimeline) ? { assistantTimeline: d.assistantTimeline } : {}),
        });
        if (isChatHttp404(raw)) {
          setChatApiBlocked(true);
          setProbeRestartKey((k) => k + 1);
        }
        return;
      }
      if (d.kind === "aborted" || d.kind === "done") {
        const extra = {
          ...(typeof d.content === "string" ? { content: d.content } : {}),
          ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
          ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
          ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
          ...(Array.isArray(d.assistantTimeline) ? { assistantTimeline: d.assistantTimeline } : {}),
        };
        finalizeAssistantById(d.assistantMessageId, extra);
        if (d.kind === "done") {
          const merged = messagesWithTerminalAssistantPayload(messagesRef.current, d.assistantMessageId, extra);
          syncSkillCreatorResultToLibrary(merged, conversationId, d.assistantMessageId);
        }
      }
    };
    window.addEventListener("openstudio-gateway-chat-terminal", fn);
    return () => window.removeEventListener("openstudio-gateway-chat-terminal", fn);
  }, [conversationId, finalizeAssistantById, t]);

  const canSend =
    !gatewayStreaming &&
    (input.trim().length > 0 || composerAttachments.length > 0) &&
    (composerAttachments.length > 0 || !isSlashOnlyComposerDraft(input, Boolean(composerSkillRow))) &&
    isElectron &&
    configLoaded &&
    !configIssueKey &&
    gatewayPhase === "online" &&
    !chatApiBlocked;

  const composerInputLocked =
    !isElectron ||
    gatewayStreaming ||
    !configLoaded ||
    (!configIssueKey && (gatewayPhase !== "online" || chatApiBlocked));

  /** Skill UI is local; keep it usable while waiting on gateway (matches `/` picker). Only lock while a reply streams. */
  const composerSkillUiLocked = gatewayStreaming;

  const composerPlaceholder = useMemo(() => {
    if (!isElectron) return t("chatLab.heroInputPlaceholder");
    if (!configLoaded) return t("chatLab.configLoadingPlaceholder");
    if (
      !configIssueKey &&
      (gatewayPhase === "checking" || gatewayPhase === "offline" || chatApiBlocked)
    ) {
      return t("chatLab.gatewayConnectingPlaceholder");
    }
    return t("chatLab.heroInputPlaceholder");
  }, [chatApiBlocked, configIssueKey, configLoaded, gatewayPhase, isElectron, t]);

  const commitUserMessageEdit = useCallback(
    async (messageId, nextRaw) => {
      const trimmed = String(nextRaw ?? "").trim();
      if (!trimmed) return false;
      if (!isElectron || !bridge?.startChatStream) return false;
      if (configIssueKey) return false;
      if (gatewayPhase !== "online" || chatApiBlocked) return false;

      const prev = messagesRef.current;
      const idx = prev.findIndex((m) => m.id === messageId && m.role === "user");
      if (idx === -1) return false;

      const sidAbort = activeStreamIdRef.current;
      if (sidAbort) {
        if (bridge?.abortChatStream) {
          try {
            await bridge.abortChatStream(sidAbort);
          } catch {
            /* ignore */
          }
        }
        resetGatewayStream(sidAbort);
      }
      activeStreamIdRef.current = null;
      activeAssistantIdRef.current = null;

      const preservedCreated = prev[idx].createdAt;
      const skillSnap = skillMetaFromPickRow(composerSkillRow);
      /** @type {Record<string, unknown>} */
      const editedUser = {
        ...prev[idx],
        content: trimmed,
        createdAt: typeof preservedCreated === "number" ? preservedCreated : Date.now(),
      };
      if (skillSnap) editedUser.skillMeta = skillSnap;
      else delete editedUser.skillMeta;
      const base = [...prev.slice(0, idx), editedUser];

      const priorRows = buildGatewayPayloadRows(base.slice(0, -1));
      const tailUserRows = buildGatewayPayloadRows([editedUser], { includeImageAttachments: true });
      const lastUserGatewayRow = tailUserRows[tailUserRows.length - 1];

      if (!paramC) {
        setSearchParams({ c: conversationId }, { replace: true });
      }

      const assistantNow = Date.now();
      const assistantMsg = {
        id: newId(),
        role: /** @type {const} */ ("assistant"),
        content: "",
        thinking: "",
        streaming: true,
        createdAt: assistantNow,
      };

      const persistableBase = base
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking && String(m.thinking).trim() ? { thinking: m.thinking } : {}),
          ...(typeof m.createdAt === "number" ? { createdAt: m.createdAt } : {}),
          ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
          ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
          ...(Array.isArray(m.assistantTimeline) && m.assistantTimeline.length
            ? { assistantTimeline: m.assistantTimeline }
            : {}),
          ...(m.skillMeta ? { skillMeta: m.skillMeta } : {}),
          ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
            ? { imageAttachments: m.imageAttachments }
            : {}),
        }));
      const persistableNext = [
        ...persistableBase,
        {
          id: assistantMsg.id,
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          createdAt: assistantMsg.createdAt,
        },
      ];
      const provisionalTitle = deriveTitleFromMessages(
        persistableNext.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinking: m.thinking,
          ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
            ? { imageAttachments: m.imageAttachments }
            : {}),
        })),
        { imageFallback: t("chatLab.chatUntitledImage") },
      );
      upsertSession(conversationId, provisionalTitle || "…", persistableNext);

      const streamId = newId();
      beginGatewayStream({
        conversationId,
        streamId,
        assistantMessageId: assistantMsg.id,
      });

      setMessages([...base, assistantMsg]);
      setInput("");
      setComposerAttachments([]);
      autoScrollRef.current = true;

      activeStreamIdRef.current = streamId;
      activeAssistantIdRef.current = assistantMsg.id;

      const systemMessage = { role: "system", content: t("chatLab.systemPrompt") };
      const outgoing = [systemMessage, ...priorRows, lastUserGatewayRow];
      const composerSkill = skillPickRowToPayload(composerSkillRow);
      setComposerSkillRow(null);

      const isFirstTurn = priorRows.length === 0;
      if (
        isFirstTurn &&
        config?.chatLabAutoTitle &&
        bridge?.generateChatTitle &&
        config?.credentials?.hasProviderApiKey
      ) {
        void bridge.generateChatTitle({ userText: trimmed }).then((r) => {
          if (!r?.ok || typeof r.title !== "string" || !r.title.trim()) return;
          const rec = getSession(conversationId);
          if (!rec) return;
          renameSession(conversationId, r.title.trim());
        });
      }

      const stopWechatTyping = maybeStartWechatTypingPulse(conversationId);
      try {
        await bridge.startChatStream({ streamId, conversationId, messages: outgoing, composerSkill });
      } catch (err) {
        resetGatewayStream(streamId);
        try {
          await bridge.abortChatStream(streamId);
        } catch {
          /* ignore */
        }
        const raw = String(err?.message ?? err);
        const msg = formatStreamError(raw, t);
        finalizeAssistantById(assistantMsg.id, { error: msg });
        if (isChatHttp404(raw)) {
          setChatApiBlocked(true);
          setProbeRestartKey((k) => k + 1);
        }
      } finally {
        stopWechatTyping();
      }
      return true;
    },
    [
      beginGatewayStream,
      bridge,
      chatApiBlocked,
      composerSkillRow,
      config?.chatLabAutoTitle,
      config?.credentials?.hasProviderApiKey,
      configIssueKey,
      conversationId,
      finalizeAssistantById,
      gatewayPhase,
      isElectron,
      paramC,
      resetGatewayStream,
      setSearchParams,
      t,
    ],
  );

  const submitNewUserTurn = useCallback(
    /**
     * @param {{
     *   trimmed: string;
     *   imageAttachments?: { mime: string; dataUrl: string }[];
     *   skillPickRow: import("../skills/skillRegistry.js").SkillPickRow | null;
     *   onCommitted?: () => void;
     * }} args
     */
    async ({ trimmed, imageAttachments, skillPickRow, onCommitted }) => {
      if (!paramC) {
        setSearchParams({ c: conversationId }, { replace: true });
      }

      const systemMessage = { role: "system", content: t("chatLab.systemPrompt") };
      const historyForRequest = buildGatewayPayloadRows(messagesRef.current);

      const now = Date.now();
      const skillSnap = skillMetaFromPickRow(skillPickRow ?? null);
      const composerSkill = skillPickRowToPayload(skillPickRow ?? null);
      const userMsg = {
        id: newId(),
        role: /** @type {const} */ ("user"),
        content: trimmed,
        createdAt: now,
        ...(skillSnap ? { skillMeta: skillSnap } : {}),
        ...(imageAttachments && imageAttachments.length ? { imageAttachments: imageAttachments } : {}),
      };
      const assistantMsg = {
        id: newId(),
        role: /** @type {const} */ ("assistant"),
        content: "",
        thinking: "",
        streaming: true,
        createdAt: now,
      };

      const persistablePrior = messagesRef.current
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking && String(m.thinking).trim() ? { thinking: m.thinking } : {}),
          ...(typeof m.createdAt === "number" ? { createdAt: m.createdAt } : {}),
          ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
          ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
          ...(Array.isArray(m.assistantTimeline) && m.assistantTimeline.length
            ? { assistantTimeline: m.assistantTimeline }
            : {}),
          ...(m.skillMeta ? { skillMeta: m.skillMeta } : {}),
          ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
            ? { imageAttachments: m.imageAttachments }
            : {}),
        }));
      const persistableNext = [
        ...persistablePrior,
        {
          id: userMsg.id,
          role: /** @type {const} */ ("user"),
          content: userMsg.content,
          createdAt: userMsg.createdAt,
          ...(userMsg.skillMeta ? { skillMeta: userMsg.skillMeta } : {}),
          ...(userMsg.imageAttachments ? { imageAttachments: userMsg.imageAttachments } : {}),
        },
        {
          id: assistantMsg.id,
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          createdAt: assistantMsg.createdAt,
        },
      ];
      const provisionalTitle = deriveTitleFromMessages(
        persistableNext.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinking: m.thinking,
          ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
            ? { imageAttachments: m.imageAttachments }
            : {}),
        })),
        { imageFallback: t("chatLab.chatUntitledImage") },
      );
      upsertSession(conversationId, provisionalTitle || "…", persistableNext);

      const streamId = newId();
      beginGatewayStream({
        conversationId,
        streamId,
        assistantMessageId: assistantMsg.id,
      });

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setUserBubbleEnterMessageId(userMsg.id);
      onCommitted?.();

      autoScrollRef.current = true;

      activeStreamIdRef.current = streamId;
      activeAssistantIdRef.current = assistantMsg.id;

      const tailUserRows = buildGatewayPayloadRows([userMsg], { includeImageAttachments: true });
      const lastUserGatewayRow = tailUserRows[tailUserRows.length - 1];
      const outgoing = [systemMessage, ...historyForRequest, lastUserGatewayRow];

      const isFirstTurn = historyForRequest.length === 0;
      if (
        isFirstTurn &&
        config?.chatLabAutoTitle &&
        bridge?.generateChatTitle &&
        config?.credentials?.hasProviderApiKey
      ) {
        void bridge.generateChatTitle({ userText: trimmed || t("chatLab.chatUntitledImage") }).then((r) => {
          if (!r?.ok || typeof r.title !== "string" || !r.title.trim()) return;
          const rec = getSession(conversationId);
          if (!rec) return;
          renameSession(conversationId, r.title.trim());
        });
      }

      const stopWechatTyping = maybeStartWechatTypingPulse(conversationId);
      try {
        await bridge.startChatStream({ streamId, conversationId, messages: outgoing, composerSkill });
      } catch (err) {
        resetGatewayStream(streamId);
        try {
          await bridge.abortChatStream(streamId);
        } catch {
          /* ignore */
        }
        const raw = String(err?.message ?? err);
        const msg = formatStreamError(raw, t);
        finalizeAssistantById(assistantMsg.id, { error: msg });
        if (isChatHttp404(raw)) {
          setChatApiBlocked(true);
          setProbeRestartKey((k) => k + 1);
        }
      } finally {
        stopWechatTyping();
      }
    },
    [
      beginGatewayStream,
      bridge,
      chatApiBlocked,
      config,
      conversationId,
      finalizeAssistantById,
      paramC,
      resetGatewayStream,
      setProbeRestartKey,
      setSearchParams,
      setMessages,
      t,
    ],
  );

  const send = useCallback(async () => {
    if (activeAssistantIdRef.current) return;
    if (messagesRef.current.some((m) => m.role === "assistant" && m.streaming)) return;
    if (gatewayStreaming) return;
    const trimmed = input.trim();
    const attachmentSnap =
      composerAttachments.length > 0
        ? composerAttachments.map(({ mime, dataUrl }) => ({ mime, dataUrl }))
        : undefined;
    if (!trimmed && (!attachmentSnap || attachmentSnap.length === 0)) return;
    if (!isElectron || !bridge?.startChatStream) return;
    if (configIssueKey) {
      return;
    }
    if (gatewayPhase !== "online" || chatApiBlocked) return;

    const editId = pendingEditMessageIdRef.current;
    if (editId) {
      const prev = messagesRef.current;
      const idx = prev.findIndex((m) => m.id === editId && m.role === "user");
      if (idx === -1) {
        setPendingEditMessageId(null);
      } else {
        setPendingEditMessageId(null);
        await commitUserMessageEdit(editId, trimmed);
        return;
      }
    }

    const historyForRequest = buildGatewayPayloadRows(messagesRef.current);
    let effectiveSkillRow = composerSkillRow;
    if (!effectiveSkillRow && historyForRequest.length === 0 && isSkillCreationNlIntent(trimmed)) {
      const hit = skillPickList.find((r) => r.kind === "openclaw" && r.slug === "skill-creator");
      if (hit) effectiveSkillRow = hit;
    }

    await submitNewUserTurn({
      trimmed,
      imageAttachments: attachmentSnap,
      skillPickRow: effectiveSkillRow ?? null,
      onCommitted: () => {
        setInput("");
        setComposerSkillRow(null);
        setComposerAttachments([]);
      },
    });
  }, [
    bridge,
    chatApiBlocked,
    commitUserMessageEdit,
    composerAttachments,
    composerSkillRow,
    configIssueKey,
    gatewayPhase,
    gatewayStreaming,
    input,
    isElectron,
    submitNewUserTurn,
  ]);

  const quickReplySend = useCallback(
    async (text) => {
      if (pendingEditMessageIdRef.current) return;
      if (activeAssistantIdRef.current) return;
      if (messagesRef.current.some((m) => m.role === "assistant" && m.streaming)) return;
      if (gatewayStreaming) return;
      const trimmed = String(text ?? "").trim();
      if (!trimmed) return;
      if (!isElectron || !bridge?.startChatStream) return;
      if (configIssueKey) return;
      if (gatewayPhase !== "online" || chatApiBlocked) return;

      await submitNewUserTurn({
        trimmed,
        imageAttachments: undefined,
        skillPickRow: null,
        onCommitted: () => {},
      });
    },
    [
      bridge,
      chatApiBlocked,
      configIssueKey,
      gatewayPhase,
      gatewayStreaming,
      isElectron,
      submitNewUserTurn,
    ],
  );

  const stop = useCallback(() => {
    const sid = activeStreamIdRef.current;
    if (!sid || !bridge?.abortChatStream) return;
    void bridge.abortChatStream(sid).catch(() => {
      /* ignore — the stream will emit `aborted` or `done` itself */
    });
  }, [bridge]);

  const exitComposerLongTextMode = useCallback(() => {
    setComposerLongTextMode(false);
    setComposerTextareaPx(CHAT_LAB_COMPOSER_TEXT_MIN_PX);
  }, []);

  const finishComposerResize = useCallback(
    /** @param {HTMLDivElement} el @param {number} pointerId */
    (el, pointerId) => {
      composerResizeDraggingRef.current = false;
      setComposerResizeDragging(false);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      setComposerTextareaPx((current) => {
        if (current >= composerSnapPx) {
          setComposerLongTextMode(true);
          return composerMaxPx;
        }
        setComposerLongTextMode(false);
        return current;
      });
    },
    [composerMaxPx, composerSnapPx],
  );

  const onComposerResizePointerDown = useCallback(
    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    (e) => {
      if (composerInputLocked || composerLongTextMode) return;
      if (e.button !== 0) return;
      e.preventDefault();
      composerResizeDragRef.current = { startY: e.clientY, startH: composerTextareaPx };
      composerResizeDraggingRef.current = true;
      setComposerResizeDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [composerInputLocked, composerLongTextMode, composerTextareaPx],
  );

  const onComposerResizePointerMove = useCallback(
    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    (e) => {
      if (!composerInputLocked && !composerLongTextMode) {
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        setComposerResizeGripX(Math.max(0, Math.min(r.width, x)));
      }
      if (!composerResizeDraggingRef.current) return;
      const { startY, startH } = composerResizeDragRef.current;
      const next = Math.min(
        composerMaxPx,
        Math.max(CHAT_LAB_COMPOSER_TEXT_MIN_PX, startH + (startY - e.clientY)),
      );
      setComposerTextareaPx(next);
    },
    [composerInputLocked, composerLongTextMode, composerMaxPx],
  );

  const onComposerResizeStripPointerEnter = useCallback(
    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    (e) => {
      if (composerInputLocked || composerLongTextMode) return;
      setComposerResizeStripHover(true);
      const w = e.currentTarget.getBoundingClientRect().width;
      setComposerResizeGripX(w / 2);
    },
    [composerInputLocked, composerLongTextMode],
  );

  const onComposerResizeStripPointerLeave = useCallback(
    () => {
      if (composerResizeDraggingRef.current) return;
      setComposerResizeStripHover(false);
    },
    [],
  );

  const onComposerResizePointerUp = useCallback(
    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    (e) => {
      if (!composerResizeDragging) return;
      finishComposerResize(e.currentTarget, e.pointerId);
    },
    [composerResizeDragging, finishComposerResize],
  );

  const onKeyDown = useCallback(
    /** @param {import('react').KeyboardEvent<HTMLTextAreaElement>} e */
    (e) => {
      if (composerLongTextMode) {
        if (
          e.key === "Enter" &&
          (e.ctrlKey || e.metaKey) &&
          !e.shiftKey &&
          !e.nativeEvent.isComposing
        ) {
          e.preventDefault();
          if (canSend) send();
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (canSend) send();
      }
    },
    [canSend, composerLongTextMode, send],
  );

  const isLanding = messages.length === 0;
  const { landingRevealReady, playHeroTitleEntrance, shellPhase, progressFrac, progressExiting, gatePortalEl } =
    useBootstrapGate();
  const portalHeroRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const landingHeroRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  useBootstrapHeroRelease(portalHeroRef, landingHeroRef, shellPhase);

  const gatePending = isLanding && shellPhase !== "ready";
  const showPortalChrome = gatePending && (shellPhase === "loading" || shellPhase === "exiting");
  const hideLandingHero = gatePending && (shellPhase === "loading" || shellPhase === "exiting");
  const gatePortalTarget =
    gatePortalEl ??
    (typeof document !== "undefined" ? document.querySelector(".bootstrap-gate-chrome") : null);

  const streamLocked = useMemo(
    () => gatewayStreaming || messages.some((m) => m.role === "assistant" && m.streaming),
    [gatewayStreaming, messages],
  );

  const sendButtonTitle = useMemo(() => {
    if (configIssueKey) return t(configIssueKey);
    if (!isElectron) return t("chatLab.electronOnly");
    if (!configLoaded) return t("chatLab.configLoadingPlaceholder");
    if (!configIssueKey && (gatewayPhase === "checking" || gatewayPhase === "offline" || chatApiBlocked)) {
      return t("chatLab.gatewayConnectingPlaceholder");
    }
    return undefined;
  }, [chatApiBlocked, configIssueKey, configLoaded, gatewayPhase, isElectron, t]);

  useEffect(() => {
    if (!composerAttachErrKey) return undefined;
    const h = window.setTimeout(() => setComposerAttachErrKey(null), 4200);
    return () => window.clearTimeout(h);
  }, [composerAttachErrKey]);

  const composerDataChars = useMemo(
    () => composerAttachments.reduce((sum, a) => sum + a.dataUrl.length, 0),
    [composerAttachments],
  );

  const contextUsageApprox = useMemo(() => {
    const chars = estimateThreadCharBudget(messages, {
      systemPromptLen: t("chatLab.systemPrompt").length,
      inputLen: input.length + composerDataChars,
    });
    const tokens = approxTokensFromChars(chars);
    const frac = tokens / CONTEXT_WINDOW_APPROX_TOKENS;
    return { chars, tokens, frac };
  }, [composerDataChars, input.length, messages, t]);

  const contextMeterLines = useMemo(() => {
    const pct = Math.round(Math.min(100, Math.max(0, contextUsageApprox.frac * 100)));
    const windowK = Math.round(CONTEXT_WINDOW_APPROX_TOKENS / 1000);
    const line1 = t("chatLab.contextMeterLine1", { pct });
    const line2 = t("chatLab.contextMeterLine2", { n: contextUsageApprox.tokens, windowK });
    return { line1, line2, pct, ariaSummary: `${line1}，${line2}` };
  }, [contextUsageApprox.frac, contextUsageApprox.tokens, t]);

  const addComposerImageFiles = useCallback(
    /** @param {FileList | File[] | null | undefined} fileList */
    async (fileList) => {
      if (composerInputLocked) return;
      const files = Array.from(fileList ?? []).filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/"));
      if (files.length === 0) return;
      setComposerAttachErrKey(null);
      /** @type {Array<{ id: string; name: string; mime: string; dataUrl: string }>} */
      const additions = [];
      for (const file of files) {
        try {
          additions.push(await readImageFileAsComposerAttachment(file));
        } catch (e) {
          const msg = String(e?.message ?? e ?? "");
          if (msg === "image_too_large") setComposerAttachErrKey("chatLab.imageTooLarge");
          else setComposerAttachErrKey("chatLab.invalidImageType");
        }
      }
      if (additions.length === 0) return;
      setComposerAttachments((prev) => {
        const merged = [...prev, ...additions];
        if (merged.length <= MAX_CHAT_COMPOSER_IMAGES) return merged;
        setComposerAttachErrKey("chatLab.maxComposerImages");
        return merged.slice(0, MAX_CHAT_COMPOSER_IMAGES);
      });
    },
    [composerInputLocked],
  );

  const clearUserBubbleEnterAnim = useCallback((messageId) => {
    setUserBubbleEnterMessageId((cur) => (cur === messageId ? null : cur));
  }, []);

  const beginComposerEdit = useCallback((messageId, payload) => {
    setPendingEditMessageId(messageId);
    const content = typeof payload === "string" ? payload : String(payload?.content ?? "");
    const skillMeta = typeof payload === "object" && payload && "skillMeta" in payload ? payload.skillMeta : undefined;
    const row = pickRowFromSkillMeta(skillMeta, skillPickList);
    setComposerSkillRow(row);
    setInput(content);
    autoScrollRef.current = true;
  }, [skillPickList]);

  const composerResizeSnapHint =
    composerResizeDragging && composerTextareaPx >= composerSnapPx && !composerLongTextMode;

  const composer = (
    <div className="chat-lab__composer-outer">
      <div className="chat-lab__composer-row">
        <div
        className={cn(
          "chat-lab__shell",
          composerDragActive && !composerInputLocked && "chat-lab__shell--drag",
          composerLongTextMode && "chat-lab__shell--long-text",
          composerResizeDragging && "chat-lab__shell--resize-drag",
        )}
        >
        <div
          className={cn(
            "chat-lab__shell-resize",
            composerInputLocked && !composerLongTextMode && "chat-lab__shell-resize--disabled",
            composerLongTextMode && "chat-lab__shell-resize--long-text",
            composerResizeSnapHint && "chat-lab__shell-resize--snapping",
            (composerResizeStripHover || composerResizeDragging) &&
              !composerLongTextMode &&
              "chat-lab__shell-resize--hot",
          )}
          role={composerLongTextMode ? "presentation" : "separator"}
          {...(composerLongTextMode
            ? {}
            : {
                "aria-orientation": "horizontal",
                "aria-valuemin": CHAT_LAB_COMPOSER_TEXT_MIN_PX,
                "aria-valuemax": composerMaxPx,
                "aria-valuenow": Math.round(composerTextareaPx),
                "aria-label": t("chatLab.composerResizeHandleAria"),
                "aria-disabled": composerInputLocked,
              })}
          onPointerEnter={onComposerResizeStripPointerEnter}
          onPointerLeave={onComposerResizeStripPointerLeave}
          onPointerDown={onComposerResizePointerDown}
          onPointerMove={onComposerResizePointerMove}
          onPointerUp={onComposerResizePointerUp}
          onPointerCancel={onComposerResizePointerUp}
        >
          {composerLongTextMode ? (
            <button
              type="button"
              className="chat-lab__shell-resize-close"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                exitComposerLongTextMode();
              }}
              title={t("chatLab.composerExitLongEditHint")}
              aria-label={t("chatLab.composerExitLongEdit")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 6 6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : composerResizeSnapHint ? (
            <div className="chat-lab__shell-resize-hint-inline" role="status">
              {t("chatLab.composerReleaseLongEdit")}
            </div>
          ) : (composerResizeStripHover || composerResizeDragging) && !composerInputLocked ? (
            <div
              className="chat-lab__shell-resize-grip"
              style={{ left: composerResizeGripX }}
              aria-hidden
            />
          ) : null}
        </div>
        <div
          className="chat-lab__shell-body"
          onDragEnter={(e) => {
            if (composerInputLocked || !e.dataTransfer?.types?.includes("Files")) return;
            e.preventDefault();
            composerDragDepthRef.current += 1;
            setComposerDragActive(true);
          }}
          onDragLeave={(e) => {
            if (!composerDragActive) return;
            e.preventDefault();
            composerDragDepthRef.current -= 1;
            if (composerDragDepthRef.current <= 0) {
              composerDragDepthRef.current = 0;
              setComposerDragActive(false);
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            composerDragDepthRef.current = 0;
            setComposerDragActive(false);
            if (composerInputLocked) return;
            e.preventDefault();
            if (e.dataTransfer?.files?.length) void addComposerImageFiles(e.dataTransfer.files);
          }}
        >
          {composerSkillRow || composerSkillRowLeaving ? (
            <div className={cn("chat-lab__shell-skill-row", composerSkillRowLeaving && "chat-lab__shell-skill-row--leaving")}>
              <ComposerSkillChip
                row={composerSkillRow}
                disabled={composerSkillUiLocked}
                onClear={clearComposerSkillRow}
                t={t}
              />
            </div>
          ) : null}
          {composerAttachments.length > 0 || composerAttachmentsLeaving ? (
            <div
              className={cn("chat-lab__composer-attachments", composerAttachmentsLeaving && "chat-lab__composer-attachments--leaving")}
              aria-label={t("chatLab.composerAttachmentsLabel")}
            >
              {composerAttachments.map((a) => (
                <div key={a.id} className="chat-lab__composer-att-thumb">
                  <img src={a.dataUrl} alt="" className="chat-lab__composer-att-img" />
                  <button
                    type="button"
                    className="chat-lab__composer-att-remove"
                    onClick={() => setComposerAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    disabled={composerInputLocked}
                    title={t("chatLab.removeComposerImage")}
                    aria-label={t("chatLab.removeComposerImage")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {composerAttachErrKey ? (
            <div className="chat-lab__composer-att-err" role="status">
              {composerAttachErrKey === "chatLab.maxComposerImages"
                ? t(composerAttachErrKey, { max: MAX_CHAT_COMPOSER_IMAGES })
                : t(composerAttachErrKey)}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className={cn(
              "chat-lab__shell-textarea",
              composerSkillRow && "chat-lab__shell-textarea--with-chip",
              composerAttachments.length > 0 && "chat-lab__shell-textarea--with-attachments",
            )}
            style={{
              height: composerTextareaPx,
              maxHeight: composerMaxPx,
            }}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const fl = e.clipboardData?.files;
              if (fl && fl.length > 0 && [...fl].some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void addComposerImageFiles(fl);
              }
            }}
            placeholder={composerPlaceholder}
            disabled={composerInputLocked}
            spellCheck
          />
        </div>
        <ComposerSkillSlashPopover
          open={slashSkillMenuActive}
          textareaRef={textareaRef}
          filterQuery={slashFilterQuery}
          skills={skillPickList}
          onPick={(row) => {
            setComposerSkillRow(row);
            setInput((v) => stripSlashPickerPrefix(v));
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onClose={() => {}}
          t={t}
        />
        <div className="chat-lab__shell-toolbar">
          <div className="chat-lab__shell-toolbar-start">
            <Select
              id="chat-toolbar-model"
              ariaLabel={t("chatLab.toolbarAuto")}
              value={enabledModelOptions.length > 0 ? toolbarModelId : "__model_not_configured__"}
              onChange={(v) => {
                if (enabledModelOptions.length === 0) return;
                setToolbarModelId(String(v));
                void applyToolbarModelId(String(v));
              }}
              options={
                enabledModelOptions.length > 0
                  ? enabledModelOptions
                  : [{ value: "__model_not_configured__", label: t("chatLab.modelNeedConfig") }]
              }
              className="chat-lab__pill-model min-w-[11rem]"
            />
            <ComposerSkillToolbarPicker
              skills={skillPickList}
              selected={composerSkillRow}
              onSelect={(row) => setComposerSkillRow(row)}
              disabled={composerSkillUiLocked}
              t={t}
            />
            {pendingEditMessageId ? (
              <span className="chat-lab__composer-edit-tag" role="status">
                <span className="chat-lab__composer-edit-tag-label">{t("chatLab.composerEditingMessageTag")}</span>
                <button
                  type="button"
                  className="chat-lab__composer-edit-tag-dismiss"
                  onClick={() => setPendingEditMessageId(null)}
                  title={t("chatLab.composerDismissEditHint")}
                  aria-label={t("chatLab.composerDismissEditHint")}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ) : null}
          </div>
          <div className="chat-lab__shell-toolbar-end">
            <ChatLabContextMeter
              ratio={Math.min(1, contextUsageApprox.frac)}
              ariaSummary={contextMeterLines.ariaSummary}
              percentText={`${contextMeterLines.pct}%`}
            />
            <button
              type="button"
              className={cn(
                "chat-lab__send-round",
                gatewayStreaming ? "chat-lab__send-round--stop" : "chat-lab__send-round--send",
                !gatewayStreaming && canSend && "chat-lab__send-round--active",
              )}
              disabled={!gatewayStreaming && !canSend}
              onClick={gatewayStreaming ? stop : send}
              title={gatewayStreaming ? t("chatLab.stop") : sendButtonTitle}
              aria-label={gatewayStreaming ? t("chatLab.stop") : t("chatLab.send")}
            >
              <span className="chat-lab__send-round-label">{t("chatLab.send")}</span>
              <span className="chat-lab__send-round-stop-icon" aria-hidden>
                <ChatStreamPauseIcon />
              </span>
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );

  return (
    <ChatLabPreviewProvider>
      <ChatLabAutoHtmlPreview conversationId={conversationId} messages={messages} />
      <div className="chat-lab__workspace relative">
        <div className="chat-lab__column">
          <div
            className={cn(
              "chat-lab",
              isLanding && "chat-lab--landing",
              gatePending && "chat-lab--gate-pending",
              isLanding && landingRevealReady && "chat-lab--gate-revealed",
              !isLanding && "chat-lab--thread",
            )}
          >
            {isLanding ? (
              <>
                {showPortalChrome && gatePortalTarget
                  ? createPortal(
                      <div className="bootstrap-gate-chrome__stack">
                        <ChatLabHero
                          ref={portalHeroRef}
                          className={cn(
                            shellPhase === "loading" && "chat-lab__hero--gate-splash",
                            shellPhase === "exiting" && "chat-lab__hero--gate-releasing",
                          )}
                          suppressTitleEntrance={!playHeroTitleEntrance}
                        />
                        <div
                          className={cn(
                            "chat-lab__gate-progress",
                            progressExiting && "chat-lab__gate-progress--exit",
                          )}
                          aria-hidden={shellPhase === "exiting" ? true : undefined}
                        >
                          <div className="chat-lab__gate-progress-track">
                            <div
                              className="chat-lab__gate-progress-fill"
                              style={{ width: `${Math.round(progressFrac * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>,
                      gatePortalTarget,
                    )
                  : null}
                <div className="chat-lab__landing-mid">
                  <ChatLabHero
                    ref={landingHeroRef}
                    className={cn(hideLandingHero && "chat-lab__hero--gate-measure")}
                    suppressTitleEntrance={!playHeroTitleEntrance}
                  />
                </div>
              </>
            ) : (
              <div className="chat-lab__thread-stack">
                <header className="chat-lab__conv-header">
                  <h2 className="chat-lab__conv-title">{headerTitle || t("chatLab.chatUntitled")}</h2>
                </header>
                <ChatLabVirtualMessageList
                  key={conversationId}
                  messages={messages}
                  sessionArtifacts={sessionArtifacts}
                  messagesScrollRef={messagesScrollRef}
                  autoScrollRef={autoScrollRef}
                  gatewayStreaming={gatewayStreaming}
                  streamLocked={streamLocked}
                  userBubbleEnterMessageId={userBubbleEnterMessageId}
                  onUserBubbleEnterAnimEnd={clearUserBubbleEnterAnim}
                  onBeginUserEdit={beginComposerEdit}
                  onQuickReply={quickReplySend}
                  quickReplyDisabled={streamLocked || Boolean(pendingEditMessageId)}
                  t={t}
                  locale={locale}
                  threadLabel={t("chatLab.title")}
                />
              </div>
            )}
          </div>
          <div
            className={cn(
              "chat-lab__composer-slot",
              gatePending && "chat-lab__composer-slot--gate-pending",
            )}
          >
            {composer}
          </div>
        </div>
        <ChatLabPreviewDock />
      </div>
    </ChatLabPreviewProvider>
  );
}

/**
 * When the latest assistant reply finishes streaming and includes a ```html … ``` fence,
 * open the preview dock (disk-only artifacts with no fenced body still need manual/open via link).
 * @param {{ conversationId: string; messages: Array<{ id: string; role: string; content?: string; streaming?: boolean; error?: string }> }} props
 */
function ChatLabAutoHtmlPreview({ conversationId, messages }) {
  const { t } = useI18n();
  const preview = useChatLabPreview();
  const handledTailIdRef = useRef(/** @type {string | null} */ (null));

  useEffect(() => {
    handledTailIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (!preview) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.streaming || last.error) return;
    if (handledTailIdRef.current === last.id) return;
    const doc = lastHtmlFenceAsSrcDocDocument(String(last.content ?? ""));
    handledTailIdRef.current = last.id;
    if (!doc) return;
    preview.openSrcDoc(doc, t("chatLab.previewTitleHtml"));
  }, [messages, preview, t]);

  return null;
}

/** Pause bars — shown on the red “stop stream” control (icon only; label via aria on the button). */
function ChatStreamPauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

function ChatStreamingSparkle({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2 13.9 8.2 20 10l-6.1 1.8L12 22l-1.9-8.2L4 10l6.1-1.8L12 2z"
      />
    </svg>
  );
}

/** Lightweight “thinking” affordance — two sparkles scale while trading places (see qclaw-style references). */
function ChatStreamingIndicator({ label }) {
  return (
    <span className="chat-lab__streaming muted" role="status" aria-live="polite">
      <span className="chat-lab__streaming-stars" aria-hidden>
        <ChatStreamingSparkle className="chat-lab__streaming-star chat-lab__streaming-star--a" />
        <ChatStreamingSparkle className="chat-lab__streaming-star chat-lab__streaming-star--b" />
      </span>
      <span className="chat-lab__streaming-label">{label}</span>
    </span>
  );
}

/**
 * One collapsible between prose segments: tools + agent steps in original timeline order.
 * @param {{
 *   segments: Array<{ kind: "tool"; refId: string } | { kind: "activity"; refId: string }>;
 *   toolMap: Map<string, import("../chat/toolTraceMerge.js").ToolTraceRow>;
 *   activityMap: Map<string, import("../chat/toolTraceMerge.js").ActivityRow>;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   streaming: boolean;
 * }} props
 */
function GapToolActivityPanel({ segments, toolMap, activityMap, t, streaming }) {
  const [open, setOpen] = useState(() => Boolean(streaming));
  const enterRegistryRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);

  const summaryCounts = useMemo(() => {
    let toolCount = 0;
    let stepCount = 0;
    for (const s of segments) {
      if (s.kind === "tool") toolCount++;
      else if (s.kind === "activity") stepCount++;
    }
    return { toolCount, stepCount };
  }, [segments]);

  const lastActivityIdx = useMemo(() => {
    let last = -1;
    segments.forEach((s, idx) => {
      if (s.kind === "activity") last = idx;
    });
    return last;
  }, [segments]);

  if (!segments.length) return null;

  return (
    <TraceDisclosure
      className="chat-lab__tool-chain chat-lab__timeline-gap-chain"
      open={open}
      onOpenChange={setOpen}
      triggerClassName="chat-lab__tool-chain-summary"
      summary={t("chatLab.timelineGapSummary", {
        toolCount: summaryCounts.toolCount,
        stepCount: summaryCounts.stepCount,
      })}
    >
      <div className="chat-lab__tool-chain-body">
        {segments.map((s, idx) => {
          if (s.kind === "tool") {
            const row = toolMap.get(s.refId);
            if (!row) return null;
            return (
              <ToolRow
                key={`gap-tool-${s.refId}`}
                row={row}
                t={t}
                enterRegistryRef={enterRegistryRef}
              />
            );
          }
          const row = activityMap.get(s.refId);
          if (!row) return null;
          return (
            <ActivityRow
              key={`gap-activity-${s.refId}`}
              row={row}
              t={t}
              streaming={streaming}
              isTail={Boolean(streaming) && idx === lastActivityIdx}
              enterRegistryRef={enterRegistryRef}
            />
          );
        })}
      </div>
    </TraceDisclosure>
  );
}

/**
 * Render assistant reply in timeline order: prose blocks alternate with gap panels.
 * Consecutive tool/step refs between two text segments merge into one gap panel.
 * @param {{
 *   timeline: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *   toolRows: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *   activityRows: import("../chat/toolTraceMerge.js").ActivityRow[];
 *   mdComponents: import("react-markdown").Components;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   streaming: boolean;
 *   tailBusy: boolean;
 *   tailBusyLabel: string;
 * }} props
 */
const AssistantInterleavedBody = memo(function AssistantInterleavedBody({
  timeline,
  toolRows,
  activityRows,
  mdComponents,
  t,
  streaming,
  tailBusy,
  tailBusyLabel,
}) {
  const toolMap = useMemo(() => new Map(toolRows.map((r) => [r.id, r])), [toolRows]);
  const activityMap = useMemo(() => new Map(activityRows.map((r) => [r.id, r])), [activityRows]);

  /** @type {Array<
   *   | { kind: "text"; body: string; key: string }
   *   | { kind: "thinking"; body: string; key: string }
   *   | { kind: "toolActivityGap"; segments: Array<{ kind: "tool"; refId: string } | { kind: "activity"; refId: string }>; key: string }
   * >} */
  const renderParts = useMemo(() => {
    /** @type {Array<
     *   | { kind: "text"; body: string; key: string }
     *   | { kind: "thinking"; body: string; key: string }
     *   | {
     *       kind: "toolActivityGap";
     *       segments: Array<{ kind: "tool"; refId: string } | { kind: "activity"; refId: string }>;
     *       key: string;
     *     }
     * >} */
    const out = [];
    /** @type {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */
    const gapBuf = [];

    const flushGap = () => {
      if (!gapBuf.length) return;
      let i = 0;
      while (i < gapBuf.length) {
        const seg = gapBuf[i];
        if (seg.kind === "thinking") {
          out.push({
            kind: "thinking",
            body: seg.body,
            key: `th-${out.length}-${i}`,
          });
          i++;
          continue;
        }
        /** @type {Array<{ kind: "tool"; refId: string } | { kind: "activity"; refId: string }>} */
        const ta = [];
        while (i < gapBuf.length && gapBuf[i].kind !== "thinking") {
          const s = gapBuf[i];
          if (s.kind === "tool" || s.kind === "activity") {
            ta.push({ kind: s.kind, refId: s.refId });
          }
          i++;
        }
        if (ta.length) {
          out.push({
            kind: "toolActivityGap",
            segments: ta,
            key: `gap-${out.length}-${ta[0]?.refId ?? "empty"}`,
          });
        }
      }
      gapBuf.length = 0;
    };

    for (let ti = 0; ti < timeline.length; ti++) {
      const seg = timeline[ti];
      if (!seg) continue;
      if (seg.kind === "text") {
        flushGap();
        out.push({ kind: "text", body: seg.body, key: `tx-${ti}` });
      } else {
        gapBuf.push(seg);
      }
    }
    flushGap();
    return out;
  }, [timeline]);

  const lastGapPartIdx = useMemo(() => {
    let last = -1;
    renderParts.forEach((p, idx) => {
      if (p.kind === "toolActivityGap") last = idx;
    });
    return last;
  }, [renderParts]);

  const lastThinkingPartIdx = useMemo(() => {
    let last = -1;
    renderParts.forEach((p, idx) => {
      if (p.kind === "thinking") last = idx;
    });
    return last;
  }, [renderParts]);

  return (
    <div className="chat-lab__assistant-timeline">
      {renderParts.map((p, ri) => {
        if (p.kind === "text") {
          if (!String(p.body ?? "").trim()) return null;
          const src = normalizeLatexMathDelimitersForRemark(p.body);
          return (
            <div key={p.key} className="chat-lab__timeline-block chat-lab__timeline-block--text chat-lab__md">
              <ReactMarkdown
                remarkPlugins={CHAT_MD_REMARK_PLUGINS}
                rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
                components={mdComponents}
              >
                {src}
              </ReactMarkdown>
            </div>
          );
        }
        if (p.kind === "thinking") {
          if (!String(p.body ?? "").trim()) return null;
          return (
            <div key={p.key} className="chat-lab__timeline-block chat-lab__timeline-block--thinking">
              <TraceDisclosure
                className={cn(
                  "chat-lab__think",
                  streaming && ri === lastThinkingPartIdx && "thinking-pulse-border",
                )}
                defaultOpen={streaming}
                triggerClassName="chat-lab__think-summary"
                panelInnerClassName="chat-lab__think-panel-inner"
                summary={
                  <>
                    {t("chatLab.thinking")}
                    <span className="chat-lab__think-hint muted">· {t("chatLab.thinkingHint")}</span>
                  </>
                }
              >
                <pre className="chat-lab__think-body">{p.body}</pre>
              </TraceDisclosure>
            </div>
          );
        }
        const panelStreaming = Boolean(streaming) && ri === lastGapPartIdx;
        return (
          <div key={p.key} className="chat-lab__timeline-block chat-lab__timeline-block--gap-chain">
            <GapToolActivityPanel
              segments={p.segments}
              toolMap={toolMap}
              activityMap={activityMap}
              t={t}
              streaming={panelStreaming}
            />
          </div>
        );
      })}
      {tailBusy ? (
        <div className="chat-lab__timeline-block chat-lab__timeline-block--pending">
          <ChatStreamingIndicator label={tailBusyLabel} />
        </div>
      ) : null}
    </div>
  );
});

/** @param {unknown} v */
function formatJsonSafe(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** @param {string} s @param {number} max */
function truncateOneLine(s, max = 80) {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** @param {Record<string, unknown> | undefined} args @param {string[]} keys */
function pickArgString(args, keys) {
  if (!args || typeof args !== "object") return "";
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, k)) continue;
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Best-effort command / URL snippet for shell-like tools (names differ by gateway/model).
 * @param {Record<string, unknown> | undefined} args
 */
function pickCommandSnippet(args) {
  const direct = pickArgString(args, [
    "command",
    "cmd",
    "shell",
    "script",
    "code",
    "powershell_command",
    "powershell",
    "line",
    "text",
    "input",
    "program",
  ]);
  if (direct) return direct;
  const raw = args && (args.arguments ?? args.params ?? args.argument);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object" && !Array.isArray(p)) {
        const inner = pickArgString(p, ["command", "cmd", "shell", "script", "url"]);
        if (inner) return inner;
      }
    } catch {
      /* ignore */
    }
  }
  const url = pickArgString(args, ["url", "href", "uri", "link", "address"]);
  if (url) return url;
  return "";
}

/** @typedef {"search" | "file" | "exec" | "session" | "generic"} ToolTraceVisualKind */

/**
 * Icon-first presentation: narrow action text + fuller string for summaries / a11y.
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow} row
 * @param {(k: string, v?: Record<string, string | number>) => string} t
 * @returns {{ kind: ToolTraceVisualKind; brief: string; aria: string }}
 */
function getToolTracePresentation(row, t) {
  const tool = String(row.toolName || "").trim() || "(tool)";
  const nameLower = tool.toLowerCase();

  const sum = typeof row.summary === "string" ? row.summary.trim() : "";
  const lab = typeof row.label === "string" ? row.label.trim() : "";

  /** @type {Record<string, unknown> | undefined} */
  const args = row.args && typeof row.args === "object" ? /** @type {Record<string, unknown>} */ (row.args) : undefined;

  if (sum && sum.toLowerCase() !== nameLower && sum.length > 2) {
    const line = truncateOneLine(sum, 96);
    return { kind: "generic", brief: line, aria: line };
  }

  if (lab && lab.toLowerCase() !== nameLower && lab.length > 2 && !/^phase\s*[:\uff1a]/i.test(lab)) {
    const line = truncateOneLine(lab, 96);
    return { kind: "generic", brief: line, aria: line };
  }

  const pathSnippet = pickArgString(args, [
    "path",
    "file_path",
    "filepath",
    "target_file",
    "absolute_path",
    "file",
    "uri",
    "resolvedPath",
  ]);
  const pathRead =
    /\bread|file\s*system|filesystem|disk/i.test(tool) ||
    nameLower.includes("read_file") ||
    nameLower.includes("readfile") ||
    nameLower.endsWith("_read") ||
    nameLower.includes("fetch_file");
  if (pathSnippet && pathRead) {
    const path = truncateOneLine(pathSnippet, 112);
    return { kind: "file", brief: path, aria: t("chatLab.toolFriendlyViewed", { path }) };
  }

  const q = pickArgString(args, ["query", "q", "search_query", "keywords", "search", "prompt", "term"]);
  const searchLike =
    nameLower.includes("search") ||
    nameLower.includes("web_") ||
    nameLower.includes("bing") ||
    nameLower.includes("brave") ||
    nameLower.includes("serp") ||
    nameLower.includes("look_up");
  if (q && searchLike) {
    const query = truncateOneLine(q, 112);
    return { kind: "search", brief: query, aria: t("chatLab.toolFriendlySearched", { query }) };
  }

  const cmdSnippet = pickCommandSnippet(args);
  const shellLike =
    nameLower.includes("exec") ||
    nameLower.includes("run_terminal") ||
    nameLower.includes("bash") ||
    nameLower.includes("shell") ||
    nameLower.includes("command") ||
    nameLower === "run" ||
    nameLower.includes("powershell") ||
    nameLower.includes("spawn") ||
    nameLower.includes("subprocess");

  if (cmdSnippet && shellLike) {
    const cmd = truncateOneLine(cmdSnippet, 112);
    return { kind: "exec", brief: cmd, aria: t("chatLab.toolFriendlyCommand", { cmd }) };
  }

  if (
    /\bsession\b|session_status|^status$/i.test(tool) ||
    nameLower.includes("session_status") ||
    nameLower.includes("lifecycle")
  ) {
    const st = pickArgString(args, ["phase", "status", "state", "stage"]) || String(row.phase || "").trim();
    if (st) {
      const detail = truncateOneLine(st, 72);
      return { kind: "session", brief: detail, aria: t("chatLab.toolFriendlySession", { detail }) };
    }
    const brief = t("chatLab.toolFriendlySessionBrief");
    return { kind: "session", brief, aria: brief };
  }

  if (!shellLike && pathSnippet && !cmdSnippet) {
    const path = truncateOneLine(pathSnippet, 112);
    return { kind: "file", brief: path, aria: t("chatLab.toolFriendlyViewed", { path }) };
  }

  const err = typeof row.error === "string" ? row.error.trim() : "";
  if (err) {
    const summary = truncateOneLine(tool + (lab && lab !== tool ? ` · ${lab}` : ""), 64);
    const errLine = truncateOneLine(err, 72);
    return {
      kind: "generic",
      brief: summary,
      aria: t("chatLab.toolFriendlyWithError", { summary, err: errLine }),
    };
  }

  const line = truncateOneLine(lab || tool, 96);
  return { kind: "generic", brief: line, aria: line };
}

/** @returns {"ok"|"run"|"fail"} */
function activityGlyphState(row, streaming, isTailRow) {
  const phase = String(row.phase ?? "").toLowerCase();
  const hay = `${String(row.title ?? "")}\n${String(row.text ?? "").slice(0, 480)}`;
  const looksFail =
    /^(error|failed|fatal|abort|timeout)\b|\berror\b|exception|not found\b/i.test(phase) ||
    /\bfail(ed|ure)?\b|fatal|unable to|ECONN|\b\d{3}\s+error\b/i.test(hay);
  if (looksFail) return "fail";
  if (streaming && isTailRow) return "run";
  return "ok";
}

/**
 * Claim a one-time enter animation when this row instance mounts (not when parent merely sees the id).
 * @param {string} rowId
 * @param {import("react").MutableRefObject<Set<string>>} enterRegistryRef
 */
function useTraceRowEnterOnMount(rowId, enterRegistryRef) {
  const showRef = useRef(false);
  if (!showRef.current && enterRegistryRef) {
    const key = String(rowId ?? "").trim();
    if (key && !enterRegistryRef.current.has(key)) {
      enterRegistryRef.current.add(key);
      showRef.current = true;
    }
  }
  return showRef.current;
}

/**
 * @param {{
 *   row: import("../chat/toolTraceMerge.js").ToolTraceRow;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   enterRegistryRef: import("react").MutableRefObject<Set<string>>;
 * }} props
 */
function ToolRow({ row, t, enterRegistryRef }) {
  const showEnterAnim = useTraceRowEnterOnMount(row.id, enterRegistryRef);
  const name = row.toolName || row.label || "(tool)";
  const pres = getToolTracePresentation(row, t);
  const done = Boolean(row.done) || /^(end|complete|completed|ok)$/i.test(String(row.phase ?? "").trim());
  const failed = Boolean(row.error && String(row.error).trim());
  const glyphState = /** @type {"ok"|"run"|"fail"} */ (failed ? "fail" : done ? "ok" : "run");
  const showPhaseChip =
    Boolean(row.phase) &&
    !(done && /^result$/i.test(String(row.phase).trim())) &&
    String(row.phase).toLowerCase() !== "end";
  const hasDetail = Boolean(
    showPhaseChip ||
      (row.args && Object.keys(row.args).length > 0) ||
      (row.result && row.result.trim()) ||
      (row.partialResult && row.partialResult.trim()) ||
      (row.error && row.error.trim()) ||
      (row.status && row.status.trim()) ||
      (row.summary && row.summary.trim() && truncateOneLine(row.summary.trim(), 96) !== pres.brief),
  );
  return (
    <TraceDisclosure
      variant="row"
      expandable={hasDetail}
      defaultOpen={false}
      chevronBefore={false}
      className={cn(
        "chat-lab__tool-nested",
        showEnterAnim && "chat-lab__trace-row-enter chat-lab__reveal-enter",
      )}
      triggerClassName={cn(
        "chat-lab__tool-nested-summary",
        showEnterAnim && "chat-lab__reveal-blur-host",
      )}
      triggerAriaLabel={pres.aria}
      summary={
        <>
          {showEnterAnim ? <span className="chat-lab__reveal-blur-veil" aria-hidden /> : null}
          <span className="chat-lab__tool-step-wrap" aria-hidden>
            <TraceStepGlyph state={glyphState} forToolChain />
          </span>
          <span className="chat-lab__tool-nested-copy">
            <span className="chat-lab__tool-title">{pres.brief}</span>
          </span>
          {hasDetail ? <TraceRowChevron /> : null}
        </>
      }
    >
      {hasDetail ? (
        <div className="chat-lab__tool-nested-body">
          <div className="chat-lab__tool-nested-meta">
            <span className="muted">{truncateOneLine(name, 56)}</span>
            {showPhaseChip ? (
              <span className="muted"> · {t("chatLab.toolPhase", { phase: row.phase })}</span>
            ) : null}
          </div>
          {row.status ? <div>{row.status}</div> : null}
          {row.args && Object.keys(row.args).length > 0 ? (
            <div>
              <strong>{t("chatLab.toolArgs")}</strong>
              <pre>{formatJsonSafe(row.args)}</pre>
            </div>
          ) : null}
          {row.partialResult ? (
            <div>
              <strong>{t("chatLab.toolPartial")}</strong>
              <pre>{row.partialResult}</pre>
            </div>
          ) : null}
          {row.result ? (
            <div>
              <strong>{t("chatLab.toolResult")}</strong>
              <pre>{row.result}</pre>
            </div>
          ) : null}
          {row.error ? (
            <div style={{ color: "#d84b4b" }}>
              <strong>{t("chatLab.toolErrorLabel")}</strong>
              <pre>{row.error}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </TraceDisclosure>
  );
}

/**
 * @param {{
 *   rows: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   streaming: boolean;
 * }} props
 */
function ToolChainPanel({ rows, t, streaming }) {
  const [open, setOpen] = useState(() => Boolean(streaming));
  const enterRegistryRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);
  if (!rows?.length) return null;
  return (
    <TraceDisclosure
      className="chat-lab__tool-chain"
      open={open}
      onOpenChange={setOpen}
      triggerClassName="chat-lab__tool-chain-summary"
      summary={t("chatLab.toolsInvokedSummary", { count: rows.length })}
    >
      <div className="chat-lab__tool-chain-body">
        {rows.map((row) => (
          <ToolRow key={row.id} row={row} t={t} enterRegistryRef={enterRegistryRef} />
        ))}
      </div>
    </TraceDisclosure>
  );
}

/**
 * @param {{
 *   row: import("../chat/toolTraceMerge.js").ActivityRow;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   streaming?: boolean;
 *   isTail?: boolean;
 *   enterRegistryRef: import("react").MutableRefObject<Set<string>>;
 * }} props
 */
function ActivityRow({ row, t, streaming, isTail, enterRegistryRef }) {
  const showEnterAnim = useTraceRowEnterOnMount(row.id, enterRegistryRef);
  const stream = truncateOneLine(String(row.stream ?? "").trim(), 64);
  const titleRaw = String(row.title ?? "").trim();
  const phase = String(row.phase ?? "").trim();
  const headline =
    stream.toLowerCase() === "lifecycle" && phase
      ? `${titleRaw || stream} · ${phase}`
      : titleRaw || stream || "—";
  const title = truncateOneLine(headline, 104);
  const textRaw = typeof row.text === "string" ? row.text.trim() : "";
  const truncatedText = textRaw.length > 2000 ? `${textRaw.slice(0, 2000)}…` : textRaw;

  const hasDetail = Boolean(phase || truncatedText.length > 0 || stream);

  const ariaPieces = [stream, titleRaw || undefined, phase || undefined].filter(Boolean);
  const aria = ariaPieces.length ? ariaPieces.join(" · ") : title;
  const gState = activityGlyphState(row, Boolean(streaming), Boolean(isTail));

  return (
    <TraceDisclosure
      variant="row"
      expandable={hasDetail}
      defaultOpen={false}
      chevronBefore={false}
      className={cn(
        "chat-lab__tool-nested chat-lab__activity-nested",
        showEnterAnim && "chat-lab__trace-row-enter chat-lab__reveal-enter",
      )}
      triggerClassName={cn(
        "chat-lab__tool-nested-summary",
        showEnterAnim && "chat-lab__reveal-blur-host",
      )}
      triggerAriaLabel={aria}
      summary={
        <>
          {showEnterAnim ? <span className="chat-lab__reveal-blur-veil" aria-hidden /> : null}
          <span className="chat-lab__tool-step-wrap" aria-hidden>
            <TraceStepGlyph state={gState} />
          </span>
          <span className="chat-lab__tool-nested-copy">
            <span className="chat-lab__tool-title">{title}</span>
          </span>
          {hasDetail ? <TraceRowChevron /> : null}
        </>
      }
    >
      {hasDetail ? (
        <div className="chat-lab__tool-nested-body">
          {stream ? (
            <div className="chat-lab__tool-nested-meta">
              <span className="muted">{stream}</span>
            </div>
          ) : null}
          {phase ? <div className="muted">{t("chatLab.toolPhase", { phase })}</div> : null}
          {truncatedText ? (
            <div className="chat-lab__activity-text">{truncatedText}</div>
          ) : !phase && stream ? (
            <div className="muted">{t("chatLab.activityEmptyDetail")}</div>
          ) : null}
        </div>
      ) : null}
    </TraceDisclosure>
  );
}

/**
 * @param {{
 *   rows: import("../chat/toolTraceMerge.js").ActivityRow[];
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   streaming?: boolean;
 * }} props
 */
function ActivityChainPanel({ rows, t, streaming }) {
  const [open, setOpen] = useState(() => Boolean(streaming));
  const enterRegistryRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);
  if (!rows?.length) return null;
  return (
    <TraceDisclosure
      className="chat-lab__tool-chain chat-lab__activity-chain"
      open={open}
      onOpenChange={setOpen}
      triggerClassName="chat-lab__tool-chain-summary"
      summary={t("chatLab.activityStepsSummary", { count: rows.length })}
    >
      <div className="chat-lab__tool-chain-body">
        {rows.map((r, idx) => (
          <ActivityRow
            key={r.id}
            row={r}
            t={t}
            streaming={streaming}
            isTail={Boolean(streaming) && idx === rows.length - 1}
            enterRegistryRef={enterRegistryRef}
          />
        ))}
      </div>
    </TraceDisclosure>
  );
}

function MessageMetaCopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2M8 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageMetaEditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Max height before user-sent bubble content is collapsed by default. */
const USER_MESSAGE_COLLAPSED_MAX_PX = 240;

function UserMessageExpandChevronIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 10l5.2 5.2L18 10"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * @param {{
 *   message: {
 *     id: string;
 *     content: string;
 *     imageAttachments?: { mime: string; dataUrl: string }[];
 *   };
 *   mdComponents: import("react-markdown").Components;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   expanded: boolean;
 *   onExpandedChange: (next: boolean) => void;
 *   onFoldableChange: (canFold: boolean) => void;
 * }} props
 */
const UserMessageCollapsibleBody = memo(function UserMessageCollapsibleBody({
  message,
  mdComponents,
  t,
  expanded,
  onExpandedChange,
  onFoldableChange,
}) {
  const innerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [naturalH, setNaturalH] = useState(0);

  const userMdSource = useMemo(
    () => normalizeLatexMathDelimitersForRemark(String(message.content ?? "")),
    [message.content],
  );

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNaturalH(el.scrollHeight));
    ro.observe(el);
    setNaturalH(el.scrollHeight);
    return () => ro.disconnect();
  }, [message.content, message.imageAttachments, userMdSource]);

  const canFold = naturalH > USER_MESSAGE_COLLAPSED_MAX_PX;
  const showCollapsed = canFold && !expanded;

  useLayoutEffect(() => {
    onFoldableChange(canFold);
  }, [canFold, onFoldableChange]);

  useLayoutEffect(() => {
    if (!canFold) onExpandedChange(false);
  }, [canFold, onExpandedChange]);

  return (
    <div
      className={cn("chat-lab__user-body-clip", showCollapsed && "chat-lab__user-body-clip--collapsed")}
      style={showCollapsed ? { maxHeight: USER_MESSAGE_COLLAPSED_MAX_PX } : undefined}
    >
      <div ref={innerRef} className="chat-lab__user-body">
        {String(message.content ?? "").trim() ? (
          <div className="chat-lab__md chat-lab__user-md">
            <ReactMarkdown
              remarkPlugins={CHAT_MD_REMARK_PLUGINS}
              rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
              components={mdComponents}
            >
              {userMdSource}
            </ReactMarkdown>
          </div>
        ) : null}
        {Array.isArray(message.imageAttachments) && message.imageAttachments.length > 0 ? (
          <div className="chat-lab__user-images">
            {message.imageAttachments.map((att, idx) => (
              <a
                key={`${message.id}-img-${idx}`}
                className="chat-lab__user-image-link"
                href={att.dataUrl}
                target="_blank"
                rel="noreferrer"
              >
                <img src={att.dataUrl} alt="" className="chat-lab__user-image" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {showCollapsed ? (
        <button
          type="button"
          className="chat-lab__user-body-expand"
          onClick={() => onExpandedChange(true)}
          aria-expanded="false"
          aria-label={t("chatLab.userMessageExpand")}
        >
          <span className="chat-lab__user-body-expand__fade" aria-hidden />
          <span className="chat-lab__user-body-expand__ico">
            <UserMessageExpandChevronIcon />
          </span>
        </button>
      ) : null}
    </div>
  );
});

/**
 * Mini form when the assistant ends with a list of clarification questions (not a single-choice MCQ).
 * @param {{
 *   items: Array<{ id: string; prompt: string; badge: string }>;
 *   disabled: boolean;
 *   sent: boolean;
 *   onSubmit: (text: string) => void;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
const AssistantQuestionnaireCard = memo(function AssistantQuestionnaireCard({
  items,
  disabled,
  sent,
  onSubmit,
  t,
}) {
  const baseId = useId();
  const layoutKey = useMemo(() => items.map((it) => it.id).join("\x1e"), [items]);
  /** @type {[Record<string, string>, import("react").Dispatch<import("react").SetStateAction<Record<string, string>>>]} */
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(items.map((it) => [it.id, ""])),
  );

  useEffect(() => {
    setAnswers(Object.fromEntries(items.map((it) => [it.id, ""])));
  }, [layoutKey]);

  const canSubmit = useMemo(
    () => items.some((it) => String(answers[it.id] ?? "").trim().length > 0),
    [items, answers],
  );

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (disabled || sent || !canSubmit) return;
      const body = formatQuestionnaireReplyMessage(
        items,
        answers,
        t("chatLab.questionnaireUnanswered"),
      );
      const text = `${t("chatLab.questionnaireReplyPreamble")}\n\n${body}`;
      onSubmit(text);
    },
    [answers, canSubmit, disabled, items, onSubmit, sent, t],
  );

  if (!items?.length) return null;

  return (
    <div className="chat-lab__quick-replies-shell">
      <div
        className={cn("chat-lab__quick-replies", "chat-lab__questionnaire", sent && "chat-lab__questionnaire--sent")}
        role="group"
        aria-label={t("chatLab.questionnaireGroup")}
      >
      <div className="chat-lab__quick-replies__header" aria-hidden>
        <span className="chat-lab__quick-replies__pin" aria-hidden />
      </div>
      <form className="chat-lab__questionnaire__form" onSubmit={handleSubmit}>
        {/* Scroll on a plain div — Chromium/Electron often ignores ::-webkit-scrollbar on <form>. */}
        <div className="chat-lab__questionnaire__fields">
          {items.map((it) => {
            const inputId = `${baseId}__${it.id}`;
            return (
              <div key={it.id} className="chat-lab__quick-reply-row">
                <div className="chat-lab__questionnaire-card">
                  <span className="chat-lab__questionnaire-card__badge">{it.badge}</span>
                  <label className="chat-lab__questionnaire-card__prompt" htmlFor={inputId}>
                    {it.prompt}
                  </label>
                  <input
                    id={inputId}
                    name={it.id}
                    type="text"
                    className="chat-lab__questionnaire-card__input"
                    autoComplete="off"
                    value={answers[it.id] ?? ""}
                    placeholder={t("chatLab.questionnaireAnswerPlaceholder")}
                    disabled={disabled || sent}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [it.id]: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="chat-lab__questionnaire__actions">
          <button
            type="submit"
            className="chat-lab__questionnaire-submit"
            disabled={disabled || sent || !canSubmit}
          >
            {t("chatLab.questionnaireSubmit")}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
});

/**
 * One-click replies for one or stacked multi-tier assistant choice lists.
 * @param {{
 *   tiers: Array<{ id: string; options: Array<{ id: string; label: string; sendText: string; badge: string }> }>;
 *   disabled: boolean;
 *   sentText: string | null;
 *   onSelect: (text: string) => void;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
const AssistantQuickReplyChips = memo(function AssistantQuickReplyChips({
  tiers,
  disabled,
  sentText,
  onSelect,
  t,
}) {
  /** @type {[Array<string | null>, import("react").Dispatch<import("react").SetStateAction<Array<string | null>>>]} */
  const [answers, setAnswers] = useState(/** @type {Array<string | null>} */ ([]));
  /** @type {[number, import("react").Dispatch<import("react").SetStateAction<number>>]} */
  const [viewIndex, setViewIndex] = useState(0);
  /** @type {[boolean, import("react").Dispatch<import("react").SetStateAction<boolean>>]} */
  const [tierExiting, setTierExiting] = useState(false);
  /** @type {import("react").MutableRefObject<boolean>} */
  const sequenceSubmittedRef = useRef(false);

  const tiersSig = useMemo(() => tiers.map((x) => x.id).join("\x1e"), [tiers]);

  useEffect(() => {
    sequenceSubmittedRef.current = false;
    setAnswers(tiers.map(() => null));
    setViewIndex(0);
    setTierExiting(false);
  }, [tiersSig, tiers]);

  const unansweredIdx = answers.findIndex((a) => !String(a ?? "").trim());
  const progressTier = unansweredIdx === -1 ? tiers.length : unansweredIdx;

  const safeTierIdx =
    tiers.length <= 1 ? 0 : Math.min(Math.max(viewIndex, 0), Math.max(tiers.length - 1, 0));
  const options = tiers[safeTierIdx]?.options ?? [];

  const sentPieces = useMemo(() => {
    if (sentText == null) return /** @type {string[]} */ ([]);
    const s = sentText.trim();
    if (!s) return [];
    return s.includes("\n\n") ? s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [s];
  }, [sentText]);

  const snippetForTier = useMemo(() => {
    const fromAnswer = String(answers[safeTierIdx] ?? "").trim();
    if (fromAnswer) return fromAnswer;
    if (sentText == null) return null;
    if (tiers.length <= 1) return sentText.trim() || null;
    if (sentPieces.length >= tiers.length) return sentPieces[safeTierIdx] ?? null;
    return null;
  }, [answers, safeTierIdx, sentPieces.length, sentText, tiers.length]);

  const frozen = disabled || tierExiting || Boolean(sentText);
  const canInteractRadios =
    tiers.length > 1 &&
    !frozen &&
    safeTierIdx === progressTier &&
    progressTier < tiers.length;

  const handleMultiPick = useCallback(
    /** @param {string} picked */
    (picked) => {
      const trimmed = String(picked ?? "").trim();
      if (!trimmed || frozen || tiers.length <= 1) return;
      const u = unansweredIdx;
      if (u < 0 || u >= tiers.length) return;
      if (safeTierIdx !== u) return;

      setTierExiting(true);

      window.setTimeout(() => {
        setAnswers((prev) => {
          const base = tiers.map((_t, idx) =>
            idx === u ? trimmed : String(prev[idx] ?? "").trim() || null,
          );
          const allDone =
            tiers.length >= 2 && base.length === tiers.length && base.every((x) => String(x ?? "").trim());
          if (allDone && !sequenceSubmittedRef.current) {
            sequenceSubmittedRef.current = true;
            void onSelect(formatChoiceSequenceReply(base.map((x) => String(x ?? "").trim())));
          }
          return base;
        });

        setViewIndex(() => Math.min(u + 1, tiers.length - 1));
        setTierExiting(false);
      }, 380);
    },
    [frozen, unansweredIdx, onSelect, safeTierIdx, tiers, tiers.length],
  );

  if (!tiers?.length) return null;

  const pager = tiers.length > 1;

  return (
    <div className="chat-lab__quick-replies-shell">
      <div className="chat-lab__quick-replies">
      <div
        className={cn(
          "chat-lab__quick-replies__header",
          pager && "chat-lab__quick-replies__header--pager",
        )}
      >
        {pager ? (
          <div className="chat-lab__quick-replies__header-nav">
            <button
              type="button"
              className="chat-lab__quick-replies__pager-btn"
              disabled={frozen || viewIndex <= 0}
              aria-label={t("chatLab.quickReplyPrevAria")}
              onClick={() => setViewIndex((vi) => Math.max(0, vi - 1))}
            >
              {t("chatLab.quickReplyPrev")}
            </button>
            <span className="chat-lab__quick-replies__pager-count">
              {t("chatLab.quickReplyStepCount", { current: viewIndex + 1, total: tiers.length })}
            </span>
            <button
              type="button"
              className="chat-lab__quick-replies__pager-btn"
              disabled={frozen || viewIndex >= tiers.length - 1}
              aria-label={t("chatLab.quickReplyNextAria")}
              onClick={() => setViewIndex((vi) => Math.min(tiers.length - 1, vi + 1))}
            >
              {t("chatLab.quickReplyNext")}
            </button>
          </div>
        ) : (
          <span className="chat-lab__quick-replies__header-spacer" aria-hidden />
        )}
        <span className="chat-lab__quick-replies__pin" aria-hidden />
      </div>
      <div className={cn("chat-lab__quick-replies__stack", pager && "chat-lab__quick-replies__stack--layered")}>
        {pager
          ? tiers
              .slice(safeTierIdx + 1, Math.min(safeTierIdx + 4, tiers.length))
              .map((peekTier, peekIdx) => {
                const peekLabel =
                  peekTier?.options?.[0]?.sendText ??
                  peekTier?.options?.[0]?.label ??
                  t("chatLab.quickReplyStackMore");
                return (
                  <div
                    key={peekTier.id}
                    aria-hidden
                    className={cn(
                      "chat-lab__quick-replies__stack-sheet",
                      `chat-lab__quick-replies__stack-sheet--n${peekIdx + 2}`,
                    )}
                  >
                    <span className="chat-lab__quick-replies__stack-sheet-title">{peekLabel}</span>
                  </div>
                );
              })
          : null}
        <div className={cn("chat-lab__quick-replies__tier-front", tierExiting && "chat-lab__quick-replies__tier-front--exit")}>
          <div
            role="radiogroup"
            aria-label={
              tiers.length > 1
                ? t("chatLab.quickReplyGroupStep", { current: safeTierIdx + 1, total: tiers.length })
                : t("chatLab.quickReplyGroup")
            }
          >
            {options.map((o) => {
              const line = snippetForTier ?? "";
              const isSent = line !== "" && o.sendText === line;

              return (
                <div key={o.id} className="chat-lab__quick-reply-row">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={Boolean(isSent)}
                    className={cn(
                      "chat-lab__quick-reply-card",
                      isSent && "chat-lab__quick-reply-card--sent",
                    )}
                    disabled={
                      frozen ||
                      (tiers.length > 1
                        ? !canInteractRadios
                        : false) ||
                      (sentText != null ? !isSent : false)
                    }
                    onClick={() => (tiers.length <= 1 ? onSelect(o.sendText) : handleMultiPick(o.sendText))}
                  >
                    <span className="chat-lab__quick-reply-card__radio" aria-hidden>
                      <span className="chat-lab__quick-reply-card__radio-dot" />
                    </span>
                    <span className="chat-lab__quick-reply-card__body">
                      <span className="chat-lab__quick-reply-card__kicker">{o.badge}</span>
                      <span className="chat-lab__quick-reply-card__label">{o.label}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
});

/**
 * @param {{
 *   message: {
 *     id: string;
 *     role: "user" | "assistant";
 *     content: string;
 *     thinking?: string;
 *     streaming?: boolean;
 *     error?: string;
 *     toolTrace?: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *     activityLog?: import("../chat/toolTraceMerge.js").ActivityRow[];
 *     assistantTimeline?: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *     createdAt?: number;
 *     skillMeta?: { kind: "openclaw" | "user"; slug?: string; userSkillId?: string; label: string; emoji: string };
 *     imageAttachments?: { mime: string; dataUrl: string }[];
 *   };
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   locale: import("../i18n/messages.js").LocaleId;
 *   streamLocked: boolean;
 *   allowAssistantQuickReply: boolean;
 *   quickReplyDisabled: boolean;
 *   onQuickReply?: (text: string) => void | Promise<void>;
 *   animateUserEnter?: boolean;
 *   onUserEnterAnimEnd?: (messageId: string) => void;
 *   onBeginUserEdit: (
 *     messageId: string,
 *     payload: {
 *       content: string;
 *       skillMeta?: { kind: "openclaw" | "user"; slug?: string; userSkillId?: string; label: string; emoji: string };
 *     },
 *   ) => void;
 * }} props
 */
const MessageBubble = memo(function MessageBubble({
  message,
  t,
  locale,
  streamLocked,
  animateUserEnter = false,
  onUserEnterAnimEnd,
  allowAssistantQuickReply,
  quickReplyDisabled,
  onQuickReply,
  onBeginUserEdit,
}) {
  const isUser = message.role === "user";
  const shouldEnterAnim = isUser && animateUserEnter;
  const handleUserEnterAnimEnd = useCallback(
    /** @param {import("react").AnimationEvent<HTMLDivElement>} e */
    (e) => {
      if (e.animationName !== "chat-lab-reveal-enter") return;
      onUserEnterAnimEnd?.(message.id);
    },
    [message.id, onUserEnterAnimEnd],
  );

  useEffect(() => {
    if (!shouldEnterAnim) return undefined;
    const timer = window.setTimeout(() => {
      onUserEnterAnimEnd?.(message.id);
    }, 560);
    return () => window.clearTimeout(timer);
  }, [shouldEnterAnim, message.id, onUserEnterAnimEnd]);
  const timeline = Array.isArray(message.assistantTimeline) ? message.assistantTimeline : [];
  const interleavedAssistant = timeline.length > 0;
  const showTyping =
    !isUser &&
    message.streaming &&
    !message.content &&
    !message.thinking &&
    !message.error &&
    !interleavedAssistant;

  const interleavedTailBusy =
    interleavedAssistant && Boolean(message.streaming) && !message.error;

  const previewApi = useContext(ChatLabPreviewContext);

  const mdComponents = useMemo(
    () => ({
      ...createChatLabMarkdownComponents(t),
      /** @param {import("react").AnchorHTMLAttributes<HTMLAnchorElement> & { children?: import("react").ReactNode }} props */
      a: ({ href, children }) => {
        const kind = href ? previewKindFromHref(href) : null;
        const text = chatMarkdownPlainText(children);
        /** @param {import("react").MouseEvent<HTMLAnchorElement>} e */
        const onClick = (e) => {
          if (!previewApi || !href || !kind) return;
          if (e.button !== 0) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (previewApi.openFromMarkdownLink(href, text)) e.preventDefault();
        };
        return (
          <a
            href={href ?? "#"}
            onClick={onClick}
            target="_blank"
            rel="noreferrer noopener"
            className="chat-lab__md-a"
          >
            {children}
          </a>
        );
      },
    }),
    [t, previewApi],
  );

  const [thinkOpen, setThinkOpen] = useState(() => Boolean(message.streaming));

  useEffect(() => {
    if (message.streaming) setThinkOpen(true);
  }, [message.streaming]);

  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const activityRows = Array.isArray(message.activityLog) ? message.activityLog : [];

  const assistantMdSource = useMemo(
    () => normalizeLatexMathDelimitersForRemark(String(message.content ?? "")),
    [message.content],
  );

  const timeLabel =
    typeof message.createdAt === "number" ? formatMessageTimestamp(message.createdAt, locale) : "";
  const timeIso =
    typeof message.createdAt === "number" && Number.isFinite(message.createdAt)
      ? new Date(message.createdAt).toISOString()
      : undefined;

  const copyPlain = useMemo(() => {
    if (isUser) {
      const base = String(message.content ?? "").trim();
      const n = Array.isArray(message.imageAttachments) ? message.imageAttachments.length : 0;
      if (n > 0) {
        const note = t("chatLab.messageImagesCopyNote", { count: n });
        if (!base) return note;
        return `${base}\n${note}`;
      }
      return String(message.content ?? "");
    }
    const c = String(message.content ?? "").trim();
    const th = String(message.thinking ?? "").trim();
    const err = message.error ? String(message.error).trim() : "";
    const parts = /** @type {string[]} */ ([]);
    if (c) parts.push(c);
    if (th) parts.push(th);
    if (err) parts.push(err);
    return parts.join("\n\n---\n");
  }, [isUser, message.content, message.error, message.imageAttachments, message.thinking, t]);

  const [copiedPulse, setCopiedPulse] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = copyPlain.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        return;
      }
    }
    setCopiedPulse(true);
    window.setTimeout(() => setCopiedPulse(false), 1600);
  }, [copyPlain]);

  const disableUserEdit = streamLocked;

  const startComposerEdit = useCallback(() => {
    onBeginUserEdit(message.id, {
      content: String(message.content ?? ""),
      ...(message.skillMeta ? { skillMeta: message.skillMeta } : {}),
    });
  }, [message.content, message.id, message.skillMeta, onBeginUserEdit]);

  const [userLongFoldable, setUserLongFoldable] = useState(false);
  const [userLongExpanded, setUserLongExpanded] = useState(false);

  useEffect(() => {
    if (!isUser) return;
    setUserLongExpanded(false);
  }, [isUser, message.id]);

  const handleUserFoldable = useCallback((can) => {
    setUserLongFoldable(can);
  }, []);

  const assistantInteractive = useMemo(() => {
    if (isUser || !allowAssistantQuickReply || message.streaming || message.error || !onQuickReply) {
      return null;
    }
    /** Full assistant text (streaming merges plain `text` deltas here even when a timeline exists). */
    return parseAssistantQuickReplies(String(message.content ?? ""));
  }, [
    allowAssistantQuickReply,
    isUser,
    message.content,
    message.error,
    message.streaming,
    onQuickReply,
  ]);

  const assistantQuickReplyTiers = useMemo(() => {
    const hit = assistantInteractive;
    if (!hit || hit.kind === "questionnaire") return null;
    if (hit.kind === "choice") return [{ id: "quick-one", options: hit.options }];
    if (hit.kind === "choice_sequence") return hit.stages;
    return null;
  }, [assistantInteractive]);

  const [quickReplySent, setQuickReplySent] = useState(/** @type {string | null} */ (null));
  const [questionnaireSent, setQuestionnaireSent] = useState(false);
  useEffect(() => {
    setQuickReplySent(null);
    setQuestionnaireSent(false);
  }, [message.id]);

  const handleQuickReply = useCallback(
    (text) => {
      if (quickReplyDisabled || !onQuickReply) return;
      setQuickReplySent(text);
      void onQuickReply(text);
    },
    [onQuickReply, quickReplyDisabled],
  );

  const handleQuestionnaireSubmit = useCallback(
    (text) => {
      if (quickReplyDisabled || !onQuickReply) return;
      setQuestionnaireSent(true);
      void onQuickReply(text);
    },
    [onQuickReply, quickReplyDisabled],
  );

  const quickReplyChipsEl =
    assistantQuickReplyTiers?.length && onQuickReply ? (
      <AssistantQuickReplyChips
        tiers={assistantQuickReplyTiers}
        disabled={quickReplyDisabled}
        sentText={quickReplySent}
        onSelect={handleQuickReply}
        t={t}
      />
    ) : assistantInteractive?.kind === "questionnaire" && onQuickReply ? (
      <AssistantQuestionnaireCard
        items={assistantInteractive.items}
        disabled={quickReplyDisabled}
        sent={questionnaireSent}
        onSubmit={handleQuestionnaireSubmit}
        t={t}
      />
    ) : null;

  return (
    <div
      className={cn(
        "chat-lab__msg",
        isUser ? "chat-lab__msg--user" : "chat-lab__msg--assistant",
        shouldEnterAnim && "chat-lab__msg--user-enter chat-lab__reveal-enter",
      )}
      onAnimationEnd={shouldEnterAnim ? handleUserEnterAnimEnd : undefined}
    >
      {isUser && message.skillMeta ? (
        <div className="chat-lab__msg-skill-pill" title={`${message.skillMeta.emoji} ${message.skillMeta.label}`}>
          <span className="chat-lab__msg-skill-emoji" aria-hidden>
            {message.skillMeta.emoji}
          </span>
          <span className="chat-lab__msg-skill-label">{message.skillMeta.label}</span>
        </div>
      ) : null}
      <article
        className={cn(
          "chat-lab__bubble",
          isUser && "chat-lab__bubble--user",
          shouldEnterAnim && "chat-lab__reveal-blur-host",
        )}
        data-role={message.role}
      >
        {shouldEnterAnim ? <span className="chat-lab__reveal-blur-veil" aria-hidden /> : null}
        {!isUser && !interleavedAssistant && toolRows.length > 0 ? (
          <ToolChainPanel rows={toolRows} t={t} streaming={Boolean(message.streaming)} />
        ) : null}
        {!isUser && !interleavedAssistant && activityRows.length > 0 ? (
          <ActivityChainPanel rows={activityRows} t={t} streaming={Boolean(message.streaming)} />
        ) : null}
        {!isUser && !interleavedAssistant && message.thinking ? (
          <TraceDisclosure
            className={cn("chat-lab__think", message.streaming && "thinking-pulse-border")}
            open={thinkOpen}
            onOpenChange={setThinkOpen}
            triggerClassName="chat-lab__think-summary"
            panelInnerClassName="chat-lab__think-panel-inner"
            summary={
              <>
                {t("chatLab.thinking")}
                <span className="chat-lab__think-hint muted">· {t("chatLab.thinkingHint")}</span>
              </>
            }
          >
            <pre className="chat-lab__think-body">{message.thinking}</pre>
          </TraceDisclosure>
        ) : null}
        {isUser ? (
          <UserMessageCollapsibleBody
            message={message}
            mdComponents={mdComponents}
            t={t}
            expanded={userLongExpanded}
            onExpandedChange={setUserLongExpanded}
            onFoldableChange={handleUserFoldable}
          />
        ) : interleavedAssistant ? (
          <div className="chat-lab__md chat-lab__md--assistant-interleaved">
            <AssistantInterleavedBody
              timeline={timeline}
              toolRows={toolRows}
              activityRows={activityRows}
              mdComponents={mdComponents}
              t={t}
              streaming={Boolean(message.streaming)}
              tailBusy={Boolean(interleavedTailBusy)}
              tailBusyLabel={t("chatLab.streaming")}
            />
            {message.error ? (
              <div className="mt-1 text-[0.78rem]" style={{ color: "#d84b4b" }}>
                {message.error}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="chat-lab__md">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={CHAT_MD_REMARK_PLUGINS}
                rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
                components={mdComponents}
              >
                {assistantMdSource}
              </ReactMarkdown>
            ) : showTyping ? (
              <ChatStreamingIndicator label={t("chatLab.streaming")} />
            ) : !message.thinking &&
              !message.error &&
              toolRows.length === 0 &&
              activityRows.length === 0 ? (
              <p className="chat-lab__empty-reply muted">{t("chatLab.emptyAssistantReply")}</p>
            ) : null}
            {message.error ? (
              <div className="mt-1 text-[0.78rem]" style={{ color: "#d84b4b" }}>
                {message.error}
              </div>
            ) : null}
          </div>
        )}
      </article>
      {isUser || !message.streaming ? (
        <div
          className={cn(
            "chat-lab__msg-footer",
            isUser ? "chat-lab__msg-footer--user" : "chat-lab__msg-footer--assistant",
          )}
        >
          {timeLabel ? (
            <time className="chat-lab__msg-time" dateTime={timeIso}>
              {timeLabel}
            </time>
          ) : null}
          {isUser && userLongFoldable && userLongExpanded ? (
            <button
              type="button"
              className="chat-lab__msg-collapse-btn"
              onClick={() => setUserLongExpanded(false)}
            >
              {t("chatLab.userMessageCollapse")}
            </button>
          ) : null}
          <div className="chat-lab__msg-actions">
            {isUser ? (
              <>
                <button
                  type="button"
                  className="chat-lab__msg-action-btn"
                  onClick={handleCopy}
                  disabled={!copyPlain.trim()}
                  title={copiedPulse ? t("chatLab.messageCopied") : t("chatLab.messageCopy")}
                  aria-label={t("chatLab.messageCopy")}
                >
                  <MessageMetaCopyIcon />
                </button>
                <button
                  type="button"
                  className="chat-lab__msg-action-btn"
                  onClick={startComposerEdit}
                  disabled={disableUserEdit}
                  title={t("chatLab.messageEdit")}
                  aria-label={t("chatLab.messageEdit")}
                >
                  <MessageMetaEditIcon />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="chat-lab__msg-action-btn"
                onClick={handleCopy}
                disabled={!copyPlain.trim()}
                title={copiedPulse ? t("chatLab.messageCopied") : t("chatLab.messageCopy")}
                aria-label={t("chatLab.messageCopy")}
              >
                <MessageMetaCopyIcon />
              </button>
            )}
          </div>
        </div>
      ) : null}
      {!isUser && quickReplyChipsEl ? (
        <div className="chat-lab__msg-quick-replies">{quickReplyChipsEl}</div>
      ) : null}
    </div>
  );
});

/**
 * Variable-height virtual list for chat bubbles (Markdown cost scales with visible rows only).
 * @param {{
 *   messages: Array<{
 *     id: string;
 *     role: "user" | "assistant";
 *     content: string;
 *     thinking?: string;
 *     streaming?: boolean;
 *     error?: string;
 *     toolTrace?: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *     activityLog?: import("../chat/toolTraceMerge.js").ActivityRow[];
 *     assistantTimeline?: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *     createdAt?: number;
 *     skillMeta?: { kind: "openclaw" | "user"; slug?: string; userSkillId?: string; label: string; emoji: string };
 *   }>;
 *   messagesScrollRef: import("react").MutableRefObject<HTMLDivElement | null>;
 *   autoScrollRef: import("react").MutableRefObject<boolean>;
 *   gatewayStreaming: boolean;
 *   streamLocked: boolean;
 *   userBubbleEnterMessageId: string | null;
 *   onUserBubbleEnterAnimEnd: (messageId: string) => void;
 *   onBeginUserEdit: (
 *     messageId: string,
 *     payload: {
 *       content: string;
 *       skillMeta?: { kind: "openclaw" | "user"; slug?: string; userSkillId?: string; label: string; emoji: string };
 *     },
 *   ) => void;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   locale: LocaleId;
 *   threadLabel: string;
 *   onQuickReply: (text: string) => void | Promise<void>;
 *   quickReplyDisabled: boolean;
 * }} props
 */
function ChatLabVirtualMessageList({
  messages,
  sessionArtifacts,
  messagesScrollRef,
  autoScrollRef,
  gatewayStreaming,
  streamLocked,
  userBubbleEnterMessageId,
  onUserBubbleEnterAnimEnd,
  onBeginUserEdit,
  onQuickReply,
  quickReplyDisabled,
  t,
  locale,
  threadLabel,
}) {
  const messagesEstRef = useRef(messages);
  messagesEstRef.current = messages;
  const scrollFadeTimerRef = useRef(/** @type {number | null} */ (null));
  const scrollbarDraggingRef = useRef(false);
  const [scrollbarVisible, setScrollbarVisible] = useState(false);
  const [scrollbarMetrics, setScrollbarMetrics] = useState(
    /** @type {{ canScroll: boolean; top: number; height: number; thumbHeight: number; thumbTop: number }} */ ({
      canScroll: false,
      top: 0,
      height: 0,
      thumbHeight: 0,
      thumbTop: 0,
    }),
  );

  const estimateSize = useCallback((index) => {
    const m = messagesEstRef.current[index];
    if (m?.role === "user") {
      let h = m.skillMeta ? 118 : 96;
      const n = Array.isArray(m.imageAttachments) ? m.imageAttachments.length : 0;
      if (n > 0) h += 56 + Math.min(n, 8) * 56;
      return h;
    }
    return 228;
  }, []);

  const getItemKey = useCallback((index) => messagesEstRef.current[index]?.id ?? index, []);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize,
    overscan: 8,
    getItemKey,
    useAnimationFrameWithResizeObserver: true,
  });

  const virtualTotal = rowVirtualizer.getTotalSize();
  const vInstRef = useRef(rowVirtualizer);
  vInstRef.current = rowVirtualizer;

  const syncScrollbarMetrics = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const trackHeight = Math.max(0, Math.round(rect.height));
    const scrollRange = el.scrollHeight - el.clientHeight;
    const canScroll = Number.isFinite(scrollRange) && scrollRange > 1;
    if (!canScroll || trackHeight <= 0) {
      setScrollbarMetrics((prev) => {
        if (!prev.canScroll && prev.top === Math.round(rect.top) && prev.height === trackHeight) return prev;
        return {
          canScroll: false,
          top: Math.round(rect.top),
          height: trackHeight,
          thumbHeight: 0,
          thumbTop: 0,
        };
      });
      return;
    }
    const ratio = Math.min(1, Math.max(0, el.scrollTop / scrollRange));
    const thumbMin = 36;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(thumbMin, Math.round((el.clientHeight / el.scrollHeight) * trackHeight)),
    );
    const thumbTravel = Math.max(1, trackHeight - thumbHeight);
    const thumbTop = Math.round(ratio * thumbTravel);
    setScrollbarMetrics((prev) => {
      const nextTop = Math.round(rect.top);
      if (
        prev.canScroll === true &&
        prev.top === nextTop &&
        prev.height === trackHeight &&
        prev.thumbHeight === thumbHeight &&
        prev.thumbTop === thumbTop
      ) {
        return prev;
      }
      return {
        canScroll: true,
        top: nextTop,
        height: trackHeight,
        thumbHeight,
        thumbTop,
      };
    });
  }, [messagesScrollRef]);

  const scheduleScrollbarHide = useCallback((delayMs = 1400) => {
    if (scrollFadeTimerRef.current != null) window.clearTimeout(scrollFadeTimerRef.current);
    scrollFadeTimerRef.current = window.setTimeout(() => {
      if (scrollbarDraggingRef.current) return;
      setScrollbarVisible(false);
      scrollFadeTimerRef.current = null;
    }, delayMs);
  }, []);

  const handleScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 80;
    syncScrollbarMetrics();
    setScrollbarVisible(true);
    scheduleScrollbarHide();
  }, [messagesScrollRef, autoScrollRef, scheduleScrollbarHide, syncScrollbarMetrics]);

  useEffect(
    () => () => {
      if (scrollFadeTimerRef.current != null) window.clearTimeout(scrollFadeTimerRef.current);
    },
    [],
  );

  const onScrollbarPointerEnter = useCallback(() => {
    setScrollbarVisible(true);
    if (scrollFadeTimerRef.current != null) {
      window.clearTimeout(scrollFadeTimerRef.current);
      scrollFadeTimerRef.current = null;
    }
  }, []);

  const onScrollbarPointerLeave = useCallback(() => {
    if (scrollbarDraggingRef.current) return;
    scheduleScrollbarHide();
  }, [scheduleScrollbarHide]);

  const onScrollbarThumbPointerDown = useCallback(
    /** @param {import("react").PointerEvent<HTMLSpanElement>} e */
    (e) => {
      if (e.button !== 0) return;
      const el = messagesScrollRef.current;
      if (!el || !scrollbarMetrics.canScroll) return;
      const scrollRange = el.scrollHeight - el.clientHeight;
      const thumbTravel = Math.max(1, scrollbarMetrics.height - scrollbarMetrics.thumbHeight);
      if (scrollRange <= 0 || thumbTravel <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      scrollbarDraggingRef.current = true;
      setScrollbarVisible(true);
      if (scrollFadeTimerRef.current != null) {
        window.clearTimeout(scrollFadeTimerRef.current);
        scrollFadeTimerRef.current = null;
      }
      const startY = e.clientY;
      const startTop = scrollbarMetrics.thumbTop;
      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        const nextTop = Math.max(0, Math.min(thumbTravel, startTop + dy));
        el.scrollTop = (nextTop / thumbTravel) * scrollRange;
      };
      const onUp = () => {
        scrollbarDraggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        scheduleScrollbarHide();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [messagesScrollRef, scheduleScrollbarHide, scrollbarMetrics],
  );

  useLayoutEffect(() => {
    const scrollEl = messagesScrollRef.current;
    if (!scrollEl) return undefined;
    syncScrollbarMetrics();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncScrollbarMetrics) : null;
    ro?.observe(scrollEl);
    window.addEventListener("resize", syncScrollbarMetrics);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncScrollbarMetrics);
    };
  }, [messagesScrollRef, syncScrollbarMetrics]);

  /** Pin-to-bottom only when the transcript or stream phase changes — not on row height remeasure (e.g. tool panels). */
  useLayoutEffect(() => {
    if (!autoScrollRef.current || messages.length === 0) return;
    vInstRef.current.scrollToIndex(messages.length - 1, { align: "end", behavior: "instant" });
  }, [messages, gatewayStreaming, autoScrollRef]);

  /** User-bubble enter anim + streaming row growth need a remeasure or the first turn can clip. */
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    vInstRef.current.measure();
  }, [messages.length, userBubbleEnterMessageId, gatewayStreaming]);

  return (
    <>
      <div
        className="chat-lab__messages chat-lab__messages--virtual"
        ref={messagesScrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label={threadLabel}
      >
        <div
          className="chat-lab__messages-vtrack"
          style={{
            height: virtualTotal,
            width: "100%",
            position: "relative",
            flexShrink: 0,
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const m = messages[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="chat-lab__msg-vrow"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                  ...(virtualRow.index < messages.length - 1 ? { paddingBottom: "0.85rem" } : {}),
                }}
              >
                <MessageBubble
                  message={m}
                  t={t}
                  locale={locale}
                  streamLocked={streamLocked}
                  animateUserEnter={m.role === "user" && m.id === userBubbleEnterMessageId}
                  onUserEnterAnimEnd={onUserBubbleEnterAnimEnd}
                  allowAssistantQuickReply={
                    virtualRow.index === messages.length - 1 && m.role === "assistant"
                  }
                  quickReplyDisabled={quickReplyDisabled}
                  onQuickReply={onQuickReply}
                  onBeginUserEdit={onBeginUserEdit}
                />
              </div>
            );
          })}
        </div>
        {sessionArtifacts?.length && !gatewayStreaming ? (
          <ChatLabArtifactsBar artifacts={sessionArtifacts} />
        ) : null}
      </div>
      <div
        className={cn(
          "chat-lab__viewport-scrollbar",
          scrollbarVisible && scrollbarMetrics.canScroll && "chat-lab__viewport-scrollbar--show",
          scrollbarMetrics.canScroll && "chat-lab__viewport-scrollbar--interactive",
        )}
        style={{
          top: `${scrollbarMetrics.top}px`,
          height: `${scrollbarMetrics.height}px`,
        }}
        onPointerEnter={onScrollbarPointerEnter}
        onPointerLeave={onScrollbarPointerLeave}
        aria-hidden
      >
        <span
          className="chat-lab__viewport-scrollbar-thumb"
          style={{
            height: `${scrollbarMetrics.thumbHeight}px`,
            transform: `translateY(${scrollbarMetrics.thumbTop}px)`,
          }}
          onPointerDown={onScrollbarThumbPointerDown}
        />
      </div>
    </>
  );
}
