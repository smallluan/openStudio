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
import "katex/dist/katex.min.css";
import {
  CONTEXT_WINDOW_APPROX_TOKENS,
  approxTokensFromChars,
  estimateThreadCharBudget,
  openClawAttachmentsFromComposer,
  MAX_CHAT_COMPOSER_IMAGES,
  imageAttachmentsContextChars,
  readImageFileAsComposerAttachment,
} from "../chat/chatLabComposerAttachments.js";
import { buildStreamUsageMeta } from "../chat/chatStreamUsageMeta.js";
import {
  emojiForFileRefKind,
  gatewayUserMessageBodyWithRefs,
  MAX_CHAT_COMPOSER_FILE_REFS,
  resolveDroppedLocalPaths,
} from "../chat/chatLabComposerFileRefs.js";
import {
  formatChoiceSequenceReply,
  formatQuestionnaireReplyMessage,
  parseAssistantQuickReplies,
} from "../chat/assistantQuickReplyParse.js";
import { preferLongerAssistantText, reconcileTimelineWithCanonicalText } from "../chat/streamTimelineMerge.js";
import {
  coalesceImageOnlyTextParts,
} from "../chat/chatLabMarkdownImageGrid.js";
import {
  agentSessionKeysForConversation,
  buildGatewayPayloadRows,
  recordAgentGatewaySync,
  resetThreadGatewaySync,
  resolveAgentGatewayContext,
} from "../chat/gatewayContext.js";
import {
  CHAT_SESSION_CHANNEL_WECHAT,
  deriveTitleFromMessages,
  getSession,
  loadAllSessions,
  renameSession,
  setSessionOrchestrationMode,
  setSessionOrchestrationFastMode,
  updateSessionOrchestration,
  updateSessionParticipants,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import { buildGroupMemberChangeEvents } from "../chat/chatLabGroupMemberEvents.js";
import { useOrchestrationRunner } from "../orchestration/useOrchestrationRunner.js";
import ChatLabOrchestrationPlanPopover from "../components/chat-lab/ChatLabOrchestrationPlanPopover.jsx";
import ChatLabOrchestrationSidePanel from "../components/chat-lab/ChatLabOrchestrationSidePanel.jsx";
import {
  buildOrchestrationAnchorMessage,
  resolveOrchestrationCurrentStepTitle,
  hasOrchestrationTimelineMessages,
  inferOrchestrationRunFromMessages,
  isOrchestrationSessionBusy,
  isOrchestrationTuckedMessage,
  normalizeMessagesForOrchestrationUi,
  resolveOrchestrationRunForTimeline,
} from "../studio/orchestrationAnchorMessage.js";
import {
  activeMentionQuery,
  agentMentionLabel,
  insertMention,
  insertMentionEveryone,
  isEveryoneMention,
  mentionEligibleAgents,
  mentionEveryoneAgents,
  parseAgentMentions,
  parseAgentDelegateMention,
  resolveReplyTargets,
} from "../studio/agentMentions.js";
import { extractFirstWebMarkdownLink, readLinkOpenModeLocal } from "../chat/chatLabLinkOpenPreference.js";
import { composeChatLabSystemPrompt, composeChatLabStudioSuffix, fetchChatLabWorkspaceContextBlock } from "../chat/chatLabSystemPrompt.js";
import {
  agentAvatarGlyph,
  agentDisplayLabel,
  groupAgentsInSession,
  sessionKeyForAgent,
  systemMessageForAgent,
} from "../studio/agents.js";
import { useStudio } from "../context/StudioContext.jsx";
import ChatLabToolbarScroll from "../components/chat-lab/ChatLabToolbarScroll.jsx";
import ChatLabAgentMentionPopover from "../components/chat-lab/ChatLabAgentMentionPopover.jsx";
import { ComposerFollowUpChip, MessageFollowUpTag } from "../components/chat-lab/ChatLabFollowUpChip.jsx";
import { navigateToFollowUpQuote } from "../chat/chatLabFollowUp.js";
import ChatLabSelectionToolbar from "../components/chat-lab/ChatLabSelectionToolbar.jsx";
import { startWechatTypingPulse } from "../chat/wechatStreamTyping.js";
import { isWechatPendingAssistantId } from "../chat/useWechatSessionSync.js";
import ChatLabHero from "../components/chat-lab/ChatLabHero.jsx";
import { useBootstrapHeroRelease } from "../components/chat-lab/useBootstrapHeroRelease.js";
import { useBootstrapGate } from "../context/BootstrapGateContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import {
  useChatLabStreaming,
  useGatewayStreamSlices,
} from "../context/ChatLabStreamingContext.jsx";
import { createChatLabMarkdownComponents } from "../components/chat-lab/chatLabMarkdown.jsx";
import ChatLabPreviewDock from "../components/chat-lab/ChatLabPreviewDock.jsx";
import ChatLabContextBar from "../components/chat-lab/ChatLabContextBar.jsx";
import ChatLabComposerSlot from "../components/chat-lab/ChatLabComposerSlot.jsx";
import ChatLabSessionScopeReset from "../components/chat-lab/ChatLabSessionScopeReset.jsx";
import ChatLabWorkspaceActiveRootBridge from "../components/chat-lab/ChatLabWorkspaceActiveRootBridge.jsx";
import { ChatLabWorkspaceProvider } from "../context/ChatLabWorkspaceContext.jsx";
import {
  ChatLabPreviewContext,
  ChatLabPreviewProvider,
  useChatLabPreview,
} from "../context/ChatLabPreviewContext.jsx";
import { ImageViewProvider } from "../context/ImageViewContext.jsx";
import Image from "../ui/Image.jsx";
import { lastHtmlFenceAsSrcDocDocument } from "../chat/chatLabDocumentPreview.js";
import { collectSessionArtifacts } from "../chat/chatLabSessionArtifacts.js";
import ChatLabArtifactsBar from "../components/chat-lab/ChatLabArtifactsBar.jsx";
import { TraceDisclosure, TraceRowChevron, TraceStepGlyph } from "../components/chat-lab/TraceDisclosure.jsx";
import {
  ComposerSkillChip,
  ComposerSkillSlashPopover,
  isSlashOnlyComposerDraft,
  stripSlashPickerPrefix,
} from "../components/chat-lab/ChatLabComposerSkills.jsx";
import { ComposerFileRefChip } from "../components/chat-lab/ChatLabComposerFileRefs.jsx";
import { ChatLabContextMeter } from "../components/chat-lab/ChatLabContextMeter.jsx";
import {
  filterSkillPickList,
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
import ChatLabMarkdownContent from "../components/chat-lab/ChatLabMarkdownContent.jsx";
import ChatLabThreadNav from "../components/chat-lab/ChatLabThreadNav.jsx";
import ChatLabConvHeader from "../components/chat-lab/ChatLabConvHeader.jsx";
import {
  findActiveUserMessageId,
  findActiveUserMessageIdVirtual,
  animateScrollTop,
  scrollThreadToMessage,
} from "../chat/chatLabThreadScroll.js";
import { cn } from "../ui/cn.js";
import Select from "../ui/Select.jsx";
import Checkbox from "../ui/Checkbox.jsx";

/** Below this count, skip virtual scroll — avoids row-height drift on some Electron/GPU setups. */
const CHAT_LAB_PLAIN_MESSAGE_MAX = 48;
/** Distance from bottom (px) within which the transcript stays pinned during streaming. */
const CHAT_AUTO_SCROLL_BOTTOM_PX = 96;

/** @param {HTMLElement | null} el @param {import("react").MutableRefObject<boolean>} autoScrollRef */
function syncChatAutoScrollFromEl(el, autoScrollRef) {
  if (!el) return;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  autoScrollRef.current = distFromBottom < CHAT_AUTO_SCROLL_BOTTOM_PX;
}

/**
 * Pin transcript scroll without stacking layout work on every streaming token.
 * @param {HTMLElement | null} el
 * @param {import("react").MutableRefObject<boolean>} autoScrollRef
 * @param {import("react").MutableRefObject<number | null>} rafRef
 */
function schedulePinChatScroll(el, autoScrollRef, rafRef) {
  if (!el || !autoScrollRef.current) return;
  if (rafRef.current != null) return;
  rafRef.current = requestAnimationFrame(() => {
    rafRef.current = null;
    if (!autoScrollRef.current || !el) return;
    el.scrollTop = el.scrollHeight;
  });
}

/** Pin transcript to bottom on thread open — ignores auto-scroll opt-out. */
function forcePinChatScroll(el) {
  if (!el) return;
  const apply = () => {
    el.scrollTop = el.scrollHeight;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

/** Distance from bottom (px) within which nested trace panels stay pinned during streaming. */
const NESTED_AUTO_SCROLL_BOTTOM_PX = 48;

/**
 * Pin a nested overflow container to bottom while content grows, unless the user scrolled up.
 * @param {boolean} active
 * @param {unknown} contentDigest
 */
function useNestedAutoScroll(active, contentDigest) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const pinnedRef = useRef(true);
  const rafRef = useRef(/** @type {number | null} */ (null));

  const syncPinned = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distFromBottom < NESTED_AUTO_SCROLL_BOTTOM_PX;
  }, []);

  const pinToBottom = useCallback(() => {
    const el = ref.current;
    if (!el || !pinnedRef.current) return;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el2 = ref.current;
      if (!el2 || !pinnedRef.current) return;
      el2.scrollTop = el2.scrollHeight;
    });
  }, []);

  useEffect(() => {
    if (active) pinnedRef.current = true;
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    pinnedRef.current = true;
    pinToBottom();
  }, [active, contentDigest, pinToBottom]);

  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    pinnedRef.current = true;
    const pin = () => {
      if (!pinnedRef.current) return;
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(pin) : null;
    ro?.observe(el);
    for (const child of el.children) ro?.observe(child);
    return () => ro?.disconnect();
  }, [active, contentDigest]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const onScroll = useCallback(() => syncPinned(), [syncPinned]);
  const onUserScrollIntent = useCallback(() => {
    pinnedRef.current = false;
  }, []);

  return { ref, onScroll, onUserScrollIntent };
}

/**
 * Scrollable nested trace body — auto-pins to bottom while streaming output grows.
 * @param {{
 *   className?: string;
 *   pinActive?: boolean;
 *   contentDigest?: unknown;
 *   children: import("react").ReactNode;
 * }} props
 */
function TraceNestedScrollBody({ className, pinActive = false, contentDigest = "", children }) {
  const { ref, onScroll, onUserScrollIntent } = useNestedAutoScroll(pinActive, contentDigest);
  return (
    <div
      ref={ref}
      className={className}
      onScroll={onScroll}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest("a,button,input,textarea,select,[role='button'],[contenteditable='true']")) return;
        onUserScrollIntent();
      }}
      onTouchStart={onUserScrollIntent}
      onWheel={(e) => {
        if (e.deltaY < 0) onUserScrollIntent();
      }}
    >
      {children}
    </div>
  );
}

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

/** Draft threads stay in memory until the user sends their first message. */
function sessionHasUserTurn(rows) {
  return rows.some((m) => m && m.role === "user" && !m.error);
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
 * @param {import("../studio/agents.js").LobsterAgent} agent
 * @param {(key: string) => string} t
 * @param {import("../studio/agents.js").LobsterAgent[]} groupAgents
 * @param {{ orchestrationTeamRoster?: string; mentionDelegateReply?: boolean; workspaceContext?: string }} [extra]
 */
function systemRowForGroupAgent(agent, t, groupAgents, extra = {}) {
  const others = groupAgents.filter((a) => a.id !== agent.id);
  const groupDelegateHint =
    others.length > 0
      ? extra.mentionDelegateReply
        ? t("chatLab.groupDelegateReplyHint")
        : t("chatLab.groupDelegateHint")
      : "";
  const workspaceBlock = String(extra.workspaceContext ?? "").trim();
  const studioSuffix = [workspaceBlock, composeChatLabStudioSuffix(t)].filter(Boolean).join("\n\n");
  return systemMessageForAgent(agent, t("chatLab.systemPrompt"), {
    groupAgents,
    groupDelegateHint,
    studioSuffix,
    ...extra,
  });
}

/**
 * @param {Record<string, unknown> | undefined} msg
 * @param {Set<string>} sessionAgentIds
 */
function isDelegatableGroupAssistantMessage(msg, sessionAgentIds) {
  if (!msg || msg.role !== "assistant" || typeof msg.agentId !== "string" || !msg.agentId || msg.error) {
    return false;
  }
  if (
    msg.messageKind === "orchestration_event" ||
    msg.messageKind === "orchestration_internal" ||
    msg.messageKind === "orchestration_plan" ||
    msg.messageKind === "orchestration_anchor" ||
    msg.messageKind === "group_member_event"
  ) {
    return false;
  }
  if (msg.mentionDelegateReply) return false;
  return sessionAgentIds.has(msg.agentId);
}

/**
 * @param {Record<string, unknown>} m
 */
function toPersistedChatMessage(m) {
  return {
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
    ...(m.followUpRef ? { followUpRef: m.followUpRef } : {}),
    ...(Array.isArray(m.imageAttachments) && m.imageAttachments.length
      ? { imageAttachments: m.imageAttachments }
      : {}),
    ...(Array.isArray(m.fileRefs) && m.fileRefs.length ? { fileRefs: m.fileRefs } : {}),
    ...(typeof m.agentId === "string" && m.agentId ? { agentId: m.agentId } : {}),
    ...(Array.isArray(m.mentions) && m.mentions.length ? { mentions: m.mentions } : {}),
    ...(m.mentionDelegateReply ? { mentionDelegateReply: true } : {}),
    ...(typeof m.mentionDelegateFromAgentId === "string" && m.mentionDelegateFromAgentId
      ? { mentionDelegateFromAgentId: m.mentionDelegateFromAgentId }
      : {}),
    ...(m.messageKind === "orchestration_event" ||
    m.messageKind === "orchestration_plan" ||
    m.messageKind === "orchestration_internal" ||
    m.messageKind === "group_member_event"
      ? { messageKind: m.messageKind }
      : {}),
    ...(m.orchestrationPlan && typeof m.orchestrationPlan === "object"
      ? { orchestrationPlan: m.orchestrationPlan }
      : {}),
    ...(typeof m.orchestrationPhase === "string" && m.orchestrationPhase
      ? { orchestrationPhase: m.orchestrationPhase }
      : {}),
    ...(typeof m.orchestrationTaskId === "string" && m.orchestrationTaskId
      ? { orchestrationTaskId: m.orchestrationTaskId }
      : {}),
    ...(typeof m.orchestrationEventKey === "string" && m.orchestrationEventKey
      ? { orchestrationEventKey: m.orchestrationEventKey }
      : {}),
    ...(typeof m.orchestrationWorkerId === "string" && m.orchestrationWorkerId
      ? { orchestrationWorkerId: m.orchestrationWorkerId }
      : {}),
    ...(typeof m.orchestrationRunId === "string" && m.orchestrationRunId
      ? { orchestrationRunId: m.orchestrationRunId }
      : {}),
  };
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
    ...(Array.isArray(m.fileRefs) && m.fileRefs.length ? { fileRefs: m.fileRefs } : {}),
    ...(m.agentId ? { agentId: m.agentId } : {}),
    ...(Array.isArray(m.mentions) && m.mentions.length ? { mentions: m.mentions } : {}),
    ...(m.mentionDelegateReply ? { mentionDelegateReply: true } : {}),
    ...(m.mentionDelegateFromAgentId ? { mentionDelegateFromAgentId: m.mentionDelegateFromAgentId } : {}),
    ...(m.messageKind ? { messageKind: m.messageKind } : {}),
    ...(m.orchestrationPlan ? { orchestrationPlan: m.orchestrationPlan } : {}),
    ...(m.orchestrationPhase ? { orchestrationPhase: m.orchestrationPhase } : {}),
    ...(m.orchestrationTaskId ? { orchestrationTaskId: m.orchestrationTaskId } : {}),
    ...(m.orchestrationEventKey ? { orchestrationEventKey: m.orchestrationEventKey } : {}),
    ...(m.orchestrationWorkerId ? { orchestrationWorkerId: m.orchestrationWorkerId } : {}),
    ...(m.orchestrationRunId ? { orchestrationRunId: m.orchestrationRunId } : {}),
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

function mapSessionRecordToUiMessages(rec, gatewaySliceOrSlices) {
  const gatewaySlices = !gatewaySliceOrSlices
    ? []
    : Array.isArray(gatewaySliceOrSlices)
      ? gatewaySliceOrSlices
      : [gatewaySliceOrSlices];
  const activeSlices = gatewaySlices.filter((s) => s?.active && s.conversationId === rec.id);
  /** @type {Map<string, (typeof gatewaySlices)[number]>} */
  const sliceByAssistantId = new Map(
    activeSlices.map((s) => [String(s.assistantMessageId ?? "").trim(), s]).filter(([id]) => id),
  );
  let activeAssistantIds = new Set(sliceByAssistantId.keys());
  /** @type {typeof rec.messages} */
  let storeRows = Array.isArray(rec.messages) ? rec.messages : [];
  if (rec.channel === CHAT_SESSION_CHANNEL_WECHAT) {
    storeRows = dedupeWechatAssistantStoreRows(storeRows);
    for (const activeAssistantId of [...activeAssistantIds]) {
      if (!isWechatPendingAssistantId(activeAssistantId)) continue;
      const src = wechatAssistantSourceKey(activeAssistantId);
      const finalId = src ? `wechat-assistant-${src}` : "";
      if (finalId && storeRows.some((m) => m.id === finalId)) {
        const slice = sliceByAssistantId.get(activeAssistantId);
        activeAssistantIds.delete(activeAssistantId);
        activeAssistantIds.add(finalId);
        if (slice) {
          sliceByAssistantId.delete(activeAssistantId);
          sliceByAssistantId.set(finalId, slice);
        }
      }
    }
  }
  for (const activeAssistantId of activeAssistantIds) {
    if (!storeRows.some((m) => m.id === activeAssistantId)) {
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
  }
  let rows = storeRows.map((m) =>
    mapSessionMessageRow(m, { streaming: Boolean(activeAssistantIds.has(m.id)) }),
  );
  if (activeSlices.length > 0) {
    rows = rows.map((m) => {
      const gatewaySlice = sliceByAssistantId.get(m.id);
      if (!gatewaySlice) return m;
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
  if (trimmed === "stream_aborted_before_reply") return t("chatLab.streamAbortedBeforeReply");
  if (trimmed === "stream_empty_before_gateway_reply") return t("chatLab.streamEmptyBeforeGatewayReply");
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
  const next = { ...m, streaming: false, createdAt: Date.now() };
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
  if (Array.isArray(extra?.mentions)) {
    if (extra.mentions.length > 0) next.mentions = extra.mentions;
    else delete next.mentions;
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
  return <ChatLabPageMain />;
}

function ChatLabPageMain() {
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

  const activeRootRef = useRef(/** @type {string | null} */ (null));
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.startChatStream);

  const resolveWorkspaceContextBlock = useCallback(
    () => fetchChatLabWorkspaceContextBlock(bridge, activeRootRef.current, t),
    [bridge, t],
  );
  const { agents, agentById, mainAgent } = useStudio();
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
  const [composerFileRefs, setComposerFileRefs] = useState(
    /** @type {import("../chat/chatLabComposerFileRefs.js").ComposerFileRef[]} */
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
  const [composerFollowUpRef, setComposerFollowUpRef] = useState(
    /** @type {import("../chat/chatSessionsStore.js").MessageFollowUpRef | null} */ (null),
  );
  const [composerAttachmentsLeaving, setComposerAttachmentsLeaving] = useState(false);
  const [composerFileRefsLeaving, setComposerFileRefsLeaving] = useState(false);
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
  const [participantIds, setParticipantIds] = useState(/** @type {string[]} */ ([]));
  const [orchestrationMode, setOrchestrationMode] = useState(false);
  const [orchestrationFastMode, setOrchestrationFastMode] = useState(false);
  const [orchestrationSideMode, setOrchestrationSideMode] = useState(
    /** @type {"live" | "timeline"} */ ("live"),
  );
  const delegatedFromMessageRef = useRef(/** @type {Set<string>} */ (new Set()));
  const delegateAfterAgentReplyRef = useRef(
    /** @type {((assistantMessageId: string, mergedHistory: Array<Record<string, unknown>>) => void) | null} */ (
      null
    ),
  );
  const [mentionCaret, setMentionCaret] = useState(0);
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0);

  const participantPool = useMemo(() => {
    const ids = new Set(participantIds);
    if (mainAgent) ids.add(mainAgent.id);
    return agents.filter((a) => ids.has(a.id));
  }, [agents, mainAgent, participantIds]);

  const mainAgentLabel = t("agents.defaultName");

  const mentionPoolOpts = useMemo(
    () => ({ mainAgent, participantIds }),
    [mainAgent, participantIds],
  );

  const mentionEligible = useMemo(
    () => mentionEligibleAgents(agents, mentionPoolOpts),
    [agents, mentionPoolOpts],
  );

  const mentionActive = useMemo(
    () => activeMentionQuery(input, mentionCaret, agents, mentionPoolOpts),
    [agents, input, mentionCaret, mentionPoolOpts],
  );

  const mentionEveryoneLabel = t("chatLab.mentionEveryone");

  const mentionFilteredAgents = useMemo(() => {
    if (!mentionActive) return [];
    const q = mentionActive.query.trim().toLowerCase();
    return mentionEligible.filter((a) => {
      const label = agentMentionLabel(a, mainAgentLabel).toLowerCase();
      const gid = (a.gatewayAgentId || "").toLowerCase();
      return !q || label.includes(q) || gid.includes(q);
    });
  }, [mentionEligible, mainAgentLabel, mentionActive]);

  const mentionEveryoneEnabled = useMemo(
    () => mentionEveryoneAgents(agents, { mainAgent, participantIds }).length >= 2,
    [agents, mainAgent, participantIds],
  );

  const mentionEveryoneVisible = useMemo(() => {
    if (!mentionActive || !mentionEveryoneEnabled) return false;
    const q = mentionActive.query.trim().toLowerCase();
    if (!q) return true;
    return mentionEveryoneLabel.toLowerCase().includes(q);
  }, [mentionActive, mentionEveryoneEnabled, mentionEveryoneLabel]);

  const mentionOptionCount = (mentionEveryoneVisible ? 1 : 0) + mentionFilteredAgents.length;

  /** Active gateway stream ids for abort/stop (multi-agent turns may have several). */
  const activeStreamIdsRef = useRef(/** @type {Set<string>} */ (new Set()));
  /** Assistant bubble id → gateway stream id. */
  const assistantStreamIdsRef = useRef(/** @type {Map<string, string>} */ (new Map()));
  const messagesRef = useRef(messages);
  const messagesScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const threadScrollApiRef = useRef(
    /** @type {import("../chat/chatLabThreadScroll.js").ChatLabThreadScrollApi | null} */ (null),
  );
  const autoScrollRef = useRef(true);

  const { beginGatewayStream, resetGatewayStream } = useChatLabStreaming();
  const gatewaySlicesForConv = useGatewayStreamSlices(conversationId);
  const gatewaySlicesRef = useRef(gatewaySlicesForConv);
  gatewaySlicesRef.current = gatewaySlicesForConv;
  const gatewayStreaming = gatewaySlicesForConv.some((s) => s.active);
  const parallelReplyActive = useMemo(
    () => messages.filter((m) => m.role === "assistant" && m.streaming).length > 1,
    [messages],
  );

  /** Switching threads clears send guards; finalize skips terminal events when conversationId mismatch left refs stuck. */
  useEffect(() => {
    activeStreamIdsRef.current.clear();
    assistantStreamIdsRef.current.clear();
    setPendingEditMessageId(null);
    setComposerSkillRow(null);
    setComposerFollowUpRef(null);
    setComposerAttachments([]);
    setComposerFileRefs([]);
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

  const clearComposerFileRefs = useCallback(() => {
    setComposerFileRefsLeaving(true);
    setTimeout(() => {
      setComposerFileRefs([]);
      setComposerFileRefsLeaving(false);
    }, 180);
  }, []);

  const [composerFocused, setComposerFocused] = useState(false);
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);

  const firstComposerLine = (input.split("\n")[0] ?? "");
  const slashSkillMenuEligible = !composerSkillRow && firstComposerLine.startsWith("/");
  const slashSkillMenuOpen = composerFocused && slashSkillMenuEligible;
  const slashFilterQuery = slashSkillMenuEligible ? firstComposerLine.slice(1) : "";
  const slashFilteredSkills = useMemo(
    () => filterSkillPickList(skillPickList, slashFilterQuery),
    [skillPickList, slashFilterQuery],
  );

  useEffect(() => {
    setSlashHighlightIndex(0);
  }, [slashFilterQuery]);

  useEffect(() => {
    setSlashHighlightIndex((i) => {
      if (slashFilteredSkills.length === 0) return 0;
      return Math.min(i, slashFilteredSkills.length - 1);
    });
  }, [slashFilteredSkills.length]);

  const pickSlashSkill = useCallback((row) => {
    setComposerSkillRow(row);
    setInput((v) => stripSlashPickerPrefix(v));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const prevParamCRef = useRef(/** @type {string | null} */ (null));

  useLayoutEffect(() => {
    const prev = prevParamCRef.current;
    prevParamCRef.current = paramC;

    if (!paramC) {
      if (prev != null) {
        autoScrollRef.current = true;
        setMessages([]);
        setParticipantIds([]);
        setOrchestrationMode(false);
        setChatApiBlocked(false);
      } else if (messagesRef.current.length === 0) {
        setChatApiBlocked(false);
      }
      return;
    }

    const rec = getSession(paramC);
    if (rec) {
      autoScrollRef.current = true;
      const liveSlices = gatewaySlicesRef.current.filter((s) => s.active && s.conversationId === paramC);
      setMessages(mapSessionRecordToUiMessages(rec, liveSlices.length ? liveSlices : null));
      const stored = Array.isArray(rec.participantIds) ? rec.participantIds : [];
      setParticipantIds(stored.filter((id) => id && id !== mainAgent?.id));
      setOrchestrationMode(Boolean(rec.orchestrationMode));
      setOrchestrationFastMode(Boolean(rec.orchestrationFastMode));
      setChatApiBlocked(false);
      return;
    }
    if (messagesRef.current.length > 0) return;
    navigate("/chat", { replace: true });
  }, [mainAgent?.id, navigate, paramC]);

  const handleParticipantsChange = useCallback(
    (ids) => {
      const prevNonMain = participantIds.filter((id) => id !== mainAgent?.id);
      const nextNonMain = ids.filter((id) => id !== mainAgent?.id);
      const memberEvents = buildGroupMemberChangeEvents(
        prevNonMain,
        nextNonMain,
        agentById,
        t,
        t("chatLab.groupMemberActorYou"),
      );

      const next = [...new Set([...(mainAgent ? [mainAgent.id] : []), ...ids])];
      setParticipantIds(ids.filter((id) => id !== mainAgent?.id));

      if (memberEvents.length > 0) {
        const uiEvents = memberEvents.map((m) => mapSessionMessageRow(m));
        setMessages((prev) => [...prev, ...uiEvents]);
        autoScrollRef.current = true;
      }

      const sid = paramC || conversationId;
      const rec = sid ? getSession(sid) : null;
      if (rec) {
        updateSessionParticipants(sid, next, memberEvents);
        if (memberEvents.length > 0) {
          resetThreadGatewaySync(sid);
        }
      }
      if (isElectron && bridge?.prewarmStudioGatewaySessions && sid) {
        const participantAgents = next
          .map((id) => agentById.get(id))
          .filter(Boolean);
        const agentSessionKeys = agentSessionKeysForConversation(sid, participantAgents);
        if (agentSessionKeys.length) {
          void bridge
            .prewarmStudioGatewaySessions({ agentSessionKeys, urgent: true })
            .catch(() => {});
        }
      }
    },
    [agentById, autoScrollRef, bridge, conversationId, isElectron, mainAgent, paramC, participantIds, t],
  );

  /** WeChat inbound / store updates: keep the open thread aligned with sidebar persistence (avoids race with auto-reply). */
  useEffect(() => {
    if (!paramC) return undefined;

    const mergeWechatThreadFromStore = () => {
      const rec = getSession(paramC);
      if (!rec || rec.channel !== CHAT_SESSION_CHANNEL_WECHAT) return;
      const liveSlices = gatewaySlicesRef.current.filter((s) => s.conversationId === paramC);
      if (liveSlices.some((s) => s.active)) {
        return;
      }
      let slices = liveSlices;
      if (slices.length === 1) {
        const slice = slices[0];
        if (
          slice?.active &&
          isWechatPendingAssistantId(slice.assistantMessageId) &&
          Array.isArray(rec.messages)
        ) {
          const src = wechatAssistantSourceKey(slice.assistantMessageId);
          const finalId = src ? `wechat-assistant-${src}` : "";
          if (finalId && rec.messages.some((m) => m.id === finalId)) {
            slices = [];
          }
        }
      }
      setMessages(mapSessionRecordToUiMessages(rec, slices));
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
    if (!paramC || !gatewaySlicesForConv.some((s) => s.active)) return;
    setMessages((prev) => {
      const missing = gatewaySlicesForConv.some(
        (s) => s.active && !prev.some((m) => m.id === s.assistantMessageId),
      );
      if (!missing) return prev;
      const rec = getSession(paramC);
      if (!rec) return prev;
      return mapSessionRecordToUiMessages(rec, gatewaySlicesForConv);
    });
  }, [gatewaySlicesForConv, paramC]);

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
    if (!sessionHasUserTurn(messages)) return;
    if (gatewayStreaming) return;

    const h = window.setTimeout(() => {
      const toSave = messages
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            !m.error &&
            !isWechatPendingAssistantId(m.id),
        )
        .map((m) => toPersistedChatMessage(m));
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

  // Listen for user config changes from other components (e.g. ModelSettingsContext)
  useEffect(() => {
    const onUserConfigChanged = () => {
      void reloadConfig();
    };
    window.addEventListener("openstudio-user-config-changed", onUserConfigChanged);
    return () => window.removeEventListener("openstudio-user-config-changed", onUserConfigChanged);
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
        const modelId = String(p.modelId ?? "").trim();
        return { value: p.id, label: modelId || t("chatLab.modelNeedConfig") };
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
    if (!gatewaySlicesForConv.length) return;
    setMessages((prev) => {
      let next = prev;
      let changed = false;
      for (const slice of gatewaySlicesForConv) {
        if (!slice.active) continue;
        const { assistantMessageId, active, content, thinking, toolTrace, activityLog, assistantTimeline } =
          slice;
        let idx = next.findIndex((m) => m.id === assistantMessageId);
        let rowId = assistantMessageId;
        if (idx === -1 && isWechatPendingAssistantId(assistantMessageId)) {
          const finalId = assistantMessageId.replace(/^wechat-replying-/, "wechat-assistant-");
          idx = next.findIndex((m) => m.id === finalId);
          if (idx !== -1) rowId = finalId;
        }
        if (idx === -1) continue;
        next = next.map((m) => {
          if (m.id !== rowId) return m;
          changed = true;
          const row = { ...m, content, thinking, streaming: active };
          if (toolTrace && toolTrace.length > 0) row.toolTrace = toolTrace;
          if (activityLog && activityLog.length > 0) row.activityLog = activityLog;
          if (Array.isArray(assistantTimeline)) {
            if (assistantTimeline.length > 0) row.assistantTimeline = assistantTimeline;
            else delete row.assistantTimeline;
          }
          return row;
        });
      }
      return changed ? next : prev;
    });
  }, [gatewaySlicesForConv, paramC]);

  const prevSliceCountForConvRef = useRef(0);
  useEffect(() => {
    const prevCount = prevSliceCountForConvRef.current;
    const nextCount = gatewaySlicesForConv.length;
    prevSliceCountForConvRef.current = nextCount;
    if (prevCount > 0 && nextCount === 0) {
      setMessages((pm) =>
        pm.some((m) => m.streaming)
          ? pm.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          : pm,
      );
    }
  }, [conversationId, gatewaySlicesForConv.length]);

  const abortAllActiveStreams = useCallback(async () => {
    const ids = [...activeStreamIdsRef.current];
    for (const sid of ids) {
      resetGatewayStream(sid);
      if (bridge?.abortChatStream) {
        try {
          await bridge.abortChatStream(sid);
        } catch {
          /* ignore */
        }
      }
    }
    activeStreamIdsRef.current.clear();
    assistantStreamIdsRef.current.clear();
  }, [bridge, resetGatewayStream]);

  const finalizeAssistantById = useCallback(
    (assistantId, extra) => {
      if (!assistantId) return;
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

  const flushAndResetGatewayStream = useCallback(
    (streamId) => {
      const slice = gatewaySlicesRef.current.find((s) => String(s.streamId) === String(streamId));
      if (slice?.assistantMessageId) {
        finalizeAssistantById(String(slice.assistantMessageId), {
          content: slice.content ?? "",
          thinking: slice.thinking ?? "",
          ...(Array.isArray(slice.toolTrace) && slice.toolTrace.length ? { toolTrace: slice.toolTrace } : {}),
          ...(Array.isArray(slice.activityLog) && slice.activityLog.length
            ? { activityLog: slice.activityLog }
            : {}),
          ...(Array.isArray(slice.assistantTimeline) && slice.assistantTimeline.length
            ? { assistantTimeline: slice.assistantTimeline }
            : {}),
          streaming: false,
        });
      }
      resetGatewayStream(streamId);
    },
    [finalizeAssistantById, resetGatewayStream],
  );

  const orchestrationRunner = useOrchestrationRunner({
    conversationId,
    agents,
    mainAgent,
    participantIds,
    agentById,
    messagesRef,
    setMessages,
    bridge,
    beginGatewayStream,
    resetGatewayStream,
    flushAndResetGatewayStream,
    finalizeAssistantById,
    abortAllActiveStreams,
    activeStreamIdsRef,
    assistantStreamIdsRef,
    orchestrationFastMode,
    t,
  });

  const sessionOrchestrationRun = useMemo(() => {
    void sessionTitleBump;
    void orchestrationRunner.runnerActivityTick;
    return getSession(conversationId)?.orchestration ?? null;
  }, [conversationId, sessionTitleBump, orchestrationRunner.runnerActivityTick]);

  const orchestrationUiMessages = useMemo(
    () => normalizeMessagesForOrchestrationUi(messages, mainAgent?.id ?? null).messages,
    [messages, mainAgent?.id],
  );

  const orchestrationRun = useMemo(
    () =>
      resolveOrchestrationRunForTimeline(
        sessionOrchestrationRun,
        orchestrationUiMessages,
        mainAgent?.id ?? null,
      ),
    [sessionOrchestrationRun, orchestrationUiMessages, mainAgent?.id],
  );

  const orchestrationStreamBusy = useMemo(
    () => orchestrationRunner.isOrchestrationStreamBusy(conversationId),
    [
      conversationId,
      orchestrationRunner,
      orchestrationRunner.runnerActivityTick,
      orchestrationRun?.status,
      orchestrationRun?.updatedAt,
    ],
  );

  const orchestrationRunnerActive = useMemo(
    () => orchestrationRunner.isOrchestrationRunnerActive(conversationId),
    [
      conversationId,
      orchestrationRunner,
      orchestrationRunner.runnerActivityTick,
      orchestrationRun?.updatedAt,
    ],
  );

  const orchestrationInProgress = useMemo(
    () => orchestrationRunner.isOrchestrationInProgress(conversationId),
    [conversationId, orchestrationRunner, orchestrationRun?.status, orchestrationRun?.updatedAt],
  );

  useEffect(() => {
    if (!orchestrationInProgress) return;
    setOrchestrationSideMode("live");
  }, [orchestrationRun?.runId, orchestrationInProgress]);

  const orchestrationBusyForDock = Boolean(orchestrationRunnerActive || gatewayStreaming);
  const orchestrationCurrentStepTitle = useMemo(() => {
    const fallback = orchestrationBusyForDock
      ? t("chatLab.streaming")
      : t("orchestration.dock.empty");
    if (!orchestrationMode || !orchestrationRun?.status || !mainAgent) return fallback;
    const agentLabels = new Map(agents.map((a) => [a.id, agentDisplayLabel(a)]));
    const anchor = buildOrchestrationAnchorMessage(
      orchestrationUiMessages,
      orchestrationRun,
      mainAgent,
      {
        streaming: orchestrationBusyForDock,
        t,
        agentLabels,
        liveSlices: gatewaySlicesForConv,
      },
    );
    return resolveOrchestrationCurrentStepTitle(anchor?.activityLog, {
      busy: orchestrationBusyForDock,
      fallback,
    });
  }, [
    orchestrationMode,
    orchestrationRun,
    orchestrationRun?.activeTaskIds,
    orchestrationRun?.updatedAt,
    orchestrationRun?.plan,
    orchestrationRun?.status,
    mainAgent,
    orchestrationUiMessages,
    orchestrationBusyForDock,
    agents,
    gatewaySlicesForConv,
    t,
  ]);

  const sessionArtifacts = useMemo(() => {
    const tuckCtx = {
      orchestrationRun,
      mainAgentId: mainAgent?.id ?? null,
      orchestrationMode,
    };
    const source = orchestrationInProgress
      ? orchestrationUiMessages.filter((m) => !isOrchestrationTuckedMessage(m, tuckCtx))
      : messages;
    return collectSessionArtifacts(source);
  }, [messages, orchestrationUiMessages, orchestrationInProgress, orchestrationMode, orchestrationRun, mainAgent?.id]);

  useEffect(() => {
    if (!conversationId || !orchestrationMode) return;
    const run = getSession(conversationId)?.orchestration;
    if (!run) return;
    if (["planning", "revising", "running"].includes(run.status)) {
      orchestrationRunner.recoverOrphanOrchestration(conversationId);
    }
    // Only recover on conversation entry — not on every status transition (avoids duplicate events).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, orchestrationMode]);

  /** Repair legacy orchestration rows + missing session.orchestration on load. */
  const orchMigrateDoneRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (!conversationId || !mainAgent?.id) return;
    const rec = getSession(conversationId);
    if (!rec) return;

    const uiRows = mapSessionRecordToUiMessages(rec, null);
    const { messages: normalized, changed } = normalizeMessagesForOrchestrationUi(
      uiRows,
      mainAgent.id,
    );

    const needsRunRepair = !rec.orchestration?.runId;
    const inferred = needsRunRepair
      ? inferOrchestrationRunFromMessages(normalized, rec.orchestration ?? null, mainAgent.id)
      : null;

    if (!changed && !inferred) return;
    if (orchMigrateDoneRef.current.has(conversationId) && !changed) return;

    if (changed) {
      const toSave = normalized
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => toPersistedChatMessage(m));
      upsertSession(conversationId, rec.title || "…", toSave, {
        participantIds: rec.participantIds,
        orchestration: rec.orchestration,
        orchestrationMode: rec.orchestrationMode,
      });
      setMessages(normalized);
    }
    if (inferred) {
      updateSessionOrchestration(conversationId, inferred);
    }
    orchMigrateDoneRef.current.add(conversationId);
  }, [conversationId, mainAgent?.id, sessionTitleBump]);

  const prevConversationIdRef = useRef(conversationId);
  useEffect(() => {
    delegatedFromMessageRef.current.clear();
  }, [conversationId]);

  useEffect(() => {
    const prev = prevConversationIdRef.current;
    if (prev && prev !== conversationId) {
      const leavingOrchBusy = isOrchestrationSessionBusy(getSession(prev));
      if (!leavingOrchBusy) {
        void abortAllActiveStreams();
        void orchestrationRunner.pauseOrchestration(prev);
      }
      autoScrollRef.current = true;
      const rec = getSession(conversationId);
      if (!rec) {
        setParticipantIds([]);
        setOrchestrationMode(false);
      }
    }
    prevConversationIdRef.current = conversationId;
  }, [abortAllActiveStreams, conversationId, mainAgent?.id, orchestrationRunner]);

  /** Background orchestration persists to the session store while another thread is open. */
  useEffect(() => {
    if (!conversationId) return undefined;
    const syncFromStore = () => {
      const rec = getSession(conversationId);
      if (!rec || !isOrchestrationSessionBusy(rec)) return;
      const liveSlices = gatewaySlicesRef.current.filter((s) => s.active && s.conversationId === conversationId);
      if (liveSlices.length > 0) return;
      setMessages(mapSessionRecordToUiMessages(rec, null));
    };
    window.addEventListener("openstudio-chat-sessions-changed", syncFromStore);
    return () => window.removeEventListener("openstudio-chat-sessions-changed", syncFromStore);
  }, [conversationId]);

  useEffect(() => {
    /** @param {Event} e */
    const fn = (e) => {
      const ce = /** @type {CustomEvent} */ (e);
      const d = ce.detail;
      if (!d || d.conversationId !== conversationId) return;
      const clearStreamTracking = (assistantMessageId) => {
        const sid = assistantStreamIdsRef.current.get(String(assistantMessageId ?? ""));
        if (sid) {
          activeStreamIdsRef.current.delete(sid);
          assistantStreamIdsRef.current.delete(String(assistantMessageId ?? ""));
        }
      };
      const sessionRec = getSession(conversationId);
      if (sessionRec?.channel === CHAT_SESSION_CHANNEL_WECHAT) {
        if (d.kind === "done" || d.kind === "aborted" || d.kind === "error") {
          clearStreamTracking(d.assistantMessageId);
          const liveSlices = gatewaySlicesRef.current.filter((s) => s.conversationId === conversationId);
          let effectiveSlices = liveSlices;
          if (liveSlices.length === 1) {
            const slice = liveSlices[0];
            if (
              slice?.active &&
              isWechatPendingAssistantId(d.assistantMessageId) &&
              Array.isArray(sessionRec.messages)
            ) {
              const src = wechatAssistantSourceKey(d.assistantMessageId);
              const finalId = src ? `wechat-assistant-${src}` : "";
              if (finalId && sessionRec.messages.some((m) => m.id === finalId)) {
                effectiveSlices = [];
              }
            }
          }
          const mapped = mapSessionRecordToUiMessages(sessionRec, effectiveSlices);
          const pendingId = String(d.assistantMessageId ?? "");
          const finalId = isWechatPendingAssistantId(pendingId)
            ? pendingId.replace(/^wechat-replying-/, "wechat-assistant-")
            : pendingId;
          const hasFinalRow = mapped.some((m) => m.id === finalId || m.id === pendingId);
          if (!hasFinalRow) {
            finalizeAssistantById(pendingId, {
              ...(d.kind === "error"
                ? { error: formatStreamError(String(d.message ?? ""), t) }
                : d.kind === "aborted"
                  ? { error: "aborted" }
                  : {}),
              ...(typeof d.content === "string" ? { content: d.content } : {}),
              ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
              ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
              ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
              ...(Array.isArray(d.assistantTimeline) ? { assistantTimeline: d.assistantTimeline } : {}),
            });
            return;
          }
          setMessages(mapped);
        }
        // Trigger system notification for wechat channel replies too
        if (d.kind === "done") {
          try {
            if (bridge?.showSystemNotification && typeof document !== "undefined" && !document.hasFocus()) {
              const title = sessionRec?.title?.trim() || "Open Studio";
              const body = String(d.content ?? "").trim().slice(0, 100) || "Reply completed";
              void bridge.showSystemNotification({ title, body });
            }
          } catch {
            // Notification failure should not block the stream
          }
        }
        return;
      }

      if (d.kind === "error") {
        clearStreamTracking(d.assistantMessageId);
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
        clearStreamTracking(d.assistantMessageId);
        const extra = {
          ...(typeof d.content === "string" ? { content: d.content } : {}),
          ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
          ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
          ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
          ...(Array.isArray(d.assistantTimeline) ? { assistantTimeline: d.assistantTimeline } : {}),
        };
        if (d.kind === "done" && !orchestrationMode) {
          const row = messagesRef.current.find((m) => m.id === d.assistantMessageId);
          const sessionAgentIds = new Set(
            groupAgentsInSession({ agents, mainAgent, participantIds }).map((a) => a.id),
          );
          const content =
            typeof extra.content === "string"
              ? extra.content
              : String(row?.content ?? "");
          if (
            sessionAgentIds.size >= 2 &&
            isDelegatableGroupAssistantMessage(row, sessionAgentIds) &&
            content.includes("@")
          ) {
            const { mentionIds } = parseAgentDelegateMention(content, agents, {
              speakerAgentId: String(row?.agentId ?? ""),
              mainAgent,
              participantIds,
              mainFallback: mainAgentLabel,
              everyoneLabel: mentionEveryoneLabel,
            });
            if (mentionIds.length) extra.mentions = mentionIds;
          }
        }
        finalizeAssistantById(d.assistantMessageId, extra);
        if (d.kind === "done") {
          const merged = messagesWithTerminalAssistantPayload(messagesRef.current, d.assistantMessageId, extra);
          syncSkillCreatorResultToLibrary(merged, conversationId, d.assistantMessageId);
          const agentId = merged.find((m) => m.id === d.assistantMessageId)?.agentId;
          if (conversationId && typeof agentId === "string" && agentId) {
            const ctx = resolveAgentGatewayContext({
              conversationId,
              agentId,
              historyMessages: merged,
              mode: "thread",
              agentById,
              mainAgentStudioId: mainAgent?.id,
            });
            if (ctx.syncThroughMessageId) {
              recordAgentGatewaySync(conversationId, agentId, ctx.syncThroughMessageId, merged);
            }
          }
          delegateAfterAgentReplyRef.current?.(d.assistantMessageId, merged);
          // Trigger system notification when reply completes (if window is not focused)
          try {
            if (bridge?.showSystemNotification && typeof document !== "undefined" && !document.hasFocus()) {
              const assistantMsg = merged.find((m) => m.id === d.assistantMessageId);
              const replyPreview = String(assistantMsg?.content ?? "").trim().slice(0, 100);
              const title = sessionRec?.title?.trim() || "Open Studio";
              void bridge.showSystemNotification({
                title,
                body: replyPreview || "Reply completed",
              });
            }
          } catch {
            // Notification failure should not block the stream
          }
        }
      }
    };
    window.addEventListener("openstudio-gateway-chat-terminal", fn);
    return () => window.removeEventListener("openstudio-gateway-chat-terminal", fn);
  }, [
    agentById,
    agents,
    conversationId,
    finalizeAssistantById,
    mainAgent,
    mainAgentLabel,
    mentionEveryoneLabel,
    orchestrationMode,
    participantIds,
    t,
  ]);

  const canSend =
    !gatewayStreaming &&
    (input.trim().length > 0 || composerAttachments.length > 0 || composerFileRefs.length > 0) &&
    (composerAttachments.length > 0 ||
      composerFileRefs.length > 0 ||
      !isSlashOnlyComposerDraft(input, Boolean(composerSkillRow))) &&
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
      const prev = messagesRef.current;
      const idx = prev.findIndex((m) => m.id === messageId && m.role === "user");
      if (idx === -1) return false;
      const preservedImages = prev[idx].imageAttachments;
      const hasImages = Array.isArray(preservedImages) && preservedImages.length > 0;
      if (!trimmed && composerFileRefs.length === 0 && !hasImages) return false;
      if (!isElectron || !bridge?.startChatStream) return false;
      if (configIssueKey) return false;
      if (gatewayPhase !== "online" || chatApiBlocked) return false;

      await abortAllActiveStreams();
      resetThreadGatewaySync(conversationId);

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
      if (composerFollowUpRef) editedUser.followUpRef = composerFollowUpRef;
      else delete editedUser.followUpRef;
      const fileSnap =
        composerFileRefs.length > 0
          ? composerFileRefs.map(({ path, name, kind }) => ({ path, name, kind }))
          : [];
      if (fileSnap.length) editedUser.fileRefs = fileSnap;
      else delete editedUser.fileRefs;
      const base = [...prev.slice(0, idx), editedUser];

      const tailUserRows = buildGatewayPayloadRows([editedUser], { includeImageAttachments: true });
      const lastUserGatewayRow = tailUserRows[tailUserRows.length - 1];
      const editCtx =
        mainAgent ?
          resolveAgentGatewayContext({
            conversationId,
            agentId: mainAgent.id,
            historyMessages: base.slice(0, -1),
            mode: "thread",
            agentById,
            mainAgentStudioId: mainAgent.id,
          })
        : { priorRows: buildGatewayPayloadRows(base.slice(0, -1), { agentById }), contextEmbedMode: "full", syncThroughMessageId: null };
      const priorRows = editCtx.priorRows;

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
        ...(mainAgent ? { agentId: mainAgent.id } : {}),
      };

      const persistableBase = base
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => toPersistedChatMessage(m));
      const persistableNext = [
        ...persistableBase,
        {
          id: assistantMsg.id,
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          createdAt: assistantMsg.createdAt,
          ...(assistantMsg.agentId ? { agentId: assistantMsg.agentId } : {}),
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
      setComposerFileRefs([]);
      autoScrollRef.current = true;

      activeStreamIdsRef.current.add(streamId);
      assistantStreamIdsRef.current.set(assistantMsg.id, streamId);

      const editGroupAgents = groupAgentsInSession({ agents, mainAgent, participantIds });
      const workspaceContext = await resolveWorkspaceContextBlock();
      const sysRow = mainAgent
        ? systemRowForGroupAgent(mainAgent, t, editGroupAgents, { workspaceContext })
        : { role: "system", content: composeChatLabSystemPrompt(t, { workspaceContext }) };
      const outgoing = [
        ...(sysRow ? [sysRow] : []),
        ...priorRows,
        ...tailUserRows,
      ];
      const composerSkill = skillPickRowToPayload(composerSkillRow);
      setComposerSkillRow(null);

      const isFirstTurn = priorRows.length === 0;
      if (
        isFirstTurn &&
        config?.chatLabAutoTitle &&
        bridge?.generateChatTitle &&
        config?.credentials?.hasProviderApiKey
      ) {
        void bridge.generateChatTitle({ userText: trimmed, conversationId }).then((r) => {
          if (!r?.ok || typeof r.title !== "string" || !r.title.trim()) return;
          const rec = getSession(conversationId);
          if (!rec) return;
          renameSession(conversationId, r.title.trim());
        });
      }

      const stopWechatTyping = maybeStartWechatTypingPulse(conversationId);
      try {
        await bridge.startChatStream({
          streamId,
          conversationId,
          messages: outgoing,
          composerSkill,
          contextEmbedMode: editCtx.contextEmbedMode,
          ...(editCtx.threadSummaryPrefix ? { threadSummaryPrefix: editCtx.threadSummaryPrefix } : {}),
          ...(mainAgent
            ? {
                agentSessionKey: sessionKeyForAgent(mainAgent),
                gatewayAgentId: mainAgent.gatewayAgentId,
              }
            : {}),
          usageMeta: buildStreamUsageMeta({
            conversationTitle: getSession(conversationId)?.title,
            assistantMessageId: assistantMsg.id,
            userMessageId: messageId,
            userContentPreview: trimmed,
            agentId: mainAgent?.id,
          }),
        });
      } catch (err) {
        resetGatewayStream(streamId);
        activeStreamIdsRef.current.delete(streamId);
        assistantStreamIdsRef.current.delete(assistantMsg.id);
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
      abortAllActiveStreams,
      beginGatewayStream,
      bridge,
      chatApiBlocked,
      composerFileRefs,
      composerSkillRow,
      config?.chatLabAutoTitle,
      config?.credentials?.hasProviderApiKey,
      configIssueKey,
      conversationId,
      finalizeAssistantById,
      gatewayPhase,
      isElectron,
      paramC,
      mainAgent,
      resetGatewayStream,
      resolveWorkspaceContextBlock,
      setSearchParams,
      t,
    ],
  );

  const submitNewUserTurn = useCallback(
    /**
     * @param {{
     *   trimmed: string;
     *   imageAttachments?: { mime: string; dataUrl: string }[];
     *   fileRefs?: import("../chat/chatSessionsStore.js").PersistedFileRef[];
     *   skillPickRow: import("../skills/skillRegistry.js").SkillPickRow | null;
     *   followUpRef?: import("../chat/chatSessionsStore.js").MessageFollowUpRef | null;
     *   onCommitted?: () => void;
     * }} args
     */
    async ({ trimmed, imageAttachments, fileRefs, skillPickRow, followUpRef, onCommitted }) => {
      if (orchestrationMode) return;
      if (!paramC) {
        setSearchParams({ c: conversationId }, { replace: true });
      }

      const { cleanText, mentionIds } = parseAgentMentions(trimmed, agents, {
        mainFallback: mainAgentLabel,
        everyoneLabel: mentionEveryoneLabel,
        mainAgent,
        participantIds,
      });
      const effectiveText = cleanText || trimmed;
      const replyTargets = resolveReplyTargets({
        mentionIds,
        participantIds,
        agents,
      });
      if (!replyTargets.length) return;

      const priorHistory = buildGatewayPayloadRows(messagesRef.current, { agentById });

      const now = Date.now();
      const skillSnap = skillMetaFromPickRow(skillPickRow ?? null);
      const composerSkill = skillPickRowToPayload(skillPickRow ?? null);
      const userMsg = {
        id: newId(),
        role: /** @type {const} */ ("user"),
        content: effectiveText,
        createdAt: now,
        ...(mentionIds.length ? { mentions: mentionIds } : {}),
        ...(skillSnap ? { skillMeta: skillSnap } : {}),
        ...(followUpRef ? { followUpRef } : {}),
        ...(imageAttachments && imageAttachments.length ? { imageAttachments: imageAttachments } : {}),
        ...(fileRefs && fileRefs.length ? { fileRefs: fileRefs } : {}),
      };

      const persistablePrior = messagesRef.current
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => toPersistedChatMessage(m));

      const sessionParticipantIds = [
        ...new Set([
          ...(mainAgent ? [mainAgent.id] : []),
          ...participantIds,
          ...mentionIds,
          ...replyTargets.map((a) => a.id),
        ]),
      ];

      setMessages((prev) => [...prev, userMsg]);
      setUserBubbleEnterMessageId(userMsg.id);
      onCommitted?.();
      autoScrollRef.current = true;

      const isFirstTurn = priorHistory.length === 0;
      if (
        isFirstTurn &&
        config?.chatLabAutoTitle &&
        bridge?.generateChatTitle &&
        config?.credentials?.hasProviderApiKey
      ) {
        void bridge.generateChatTitle({ userText: effectiveText || t("chatLab.chatUntitledImage") }).then((r) => {
          if (!r?.ok || typeof r.title !== "string" || !r.title.trim()) return;
          const rec = getSession(conversationId);
          if (!rec) return;
          renameSession(conversationId, r.title.trim());
        });
      }

      const stopWechatTyping = maybeStartWechatTypingPulse(conversationId);
      const groupAgents = groupAgentsInSession({ agents, mainAgent, participantIds: sessionParticipantIds });
      const workspaceContext = await resolveWorkspaceContextBlock();

      const parallelReply = replyTargets.length > 1;
      const historyBeforeUser = messagesRef.current.filter((m) => m.id !== userMsg.id);
      const tailUserRows = buildGatewayPayloadRows([userMsg], {
        includeImageAttachments: true,
        agentById,
      });

      /** @type {Array<{
       *   target: import("../studio/agents.js").LobsterAgent;
       *   assistantMsg: { id: string; role: "assistant"; content: string; thinking: string; streaming: boolean; createdAt: number; agentId: string };
       *   streamId: string;
       *   outgoing: Array<{ role: string; content: string; attachments?: unknown[] }>;
       * }>} */
      const launchJobs = replyTargets.map((target, i) => {
        const assistantMsg = {
          id: newId(),
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          streaming: true,
          createdAt: now + i + 1,
          agentId: target.id,
        };
        const sysRow = systemRowForGroupAgent(target, t, groupAgents, { workspaceContext });
        const ctx = resolveAgentGatewayContext({
          conversationId,
          agentId: target.id,
          historyMessages: historyBeforeUser,
          mode: "thread",
          agentById,
          mainAgentStudioId: mainAgent?.id,
        });
        const outgoing = [...(sysRow ? [sysRow] : []), ...ctx.priorRows, ...tailUserRows];
        return {
          target,
          assistantMsg,
          streamId: newId(),
          outgoing,
          contextEmbedMode: ctx.contextEmbedMode,
          threadSummaryPrefix: ctx.threadSummaryPrefix,
          syncThroughMessageId: ctx.syncThroughMessageId,
        };
      });

      const persistableNext = [
        ...persistablePrior,
        {
          id: userMsg.id,
          role: /** @type {const} */ ("user"),
          content: userMsg.content,
          createdAt: userMsg.createdAt,
          ...(userMsg.mentions?.length ? { mentions: userMsg.mentions } : {}),
          ...(userMsg.skillMeta ? { skillMeta: userMsg.skillMeta } : {}),
          ...(userMsg.followUpRef ? { followUpRef: userMsg.followUpRef } : {}),
          ...(userMsg.imageAttachments ? { imageAttachments: userMsg.imageAttachments } : {}),
          ...(userMsg.fileRefs ? { fileRefs: userMsg.fileRefs } : {}),
        },
        ...launchJobs.map(({ assistantMsg }) => ({
          id: assistantMsg.id,
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          createdAt: assistantMsg.createdAt,
          agentId: assistantMsg.agentId,
        })),
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
      upsertSession(conversationId, provisionalTitle || "…", persistableNext, {
        participantIds: sessionParticipantIds,
      });

      setMessages((prev) => [...prev, ...launchJobs.map((j) => j.assistantMsg)]);

      for (const job of launchJobs) {
        beginGatewayStream({
          conversationId,
          streamId: job.streamId,
          assistantMessageId: job.assistantMsg.id,
        });
        activeStreamIdsRef.current.add(job.streamId);
        assistantStreamIdsRef.current.set(job.assistantMsg.id, job.streamId);
      }

      const runFanoutJob = async (job, composerSkillForJob) => {
        try {
          await bridge.startChatStream({
            streamId: job.streamId,
            conversationId,
            messages: job.outgoing,
            composerSkill: composerSkillForJob,
            agentSessionKey: sessionKeyForAgent(job.target),
            gatewayAgentId: job.target.gatewayAgentId,
            concurrent: true,
            contextEmbedMode: job.contextEmbedMode,
            ...(job.threadSummaryPrefix ? { threadSummaryPrefix: job.threadSummaryPrefix } : {}),
            usageMeta: buildStreamUsageMeta({
              conversationTitle: getSession(conversationId)?.title,
              assistantMessageId: job.assistantMsg.id,
              userMessageId: userMsg.id,
              userContentPreview: effectiveText,
              agentId: job.target.id,
            }),
          });
        } catch (err) {
          resetGatewayStream(job.streamId);
          activeStreamIdsRef.current.delete(job.streamId);
          assistantStreamIdsRef.current.delete(job.assistantMsg.id);
          try {
            await bridge.abortChatStream(job.streamId);
          } catch {
            /* ignore */
          }
          const raw = String(err?.message ?? err);
          const msg = formatStreamError(raw, t);
          finalizeAssistantById(job.assistantMsg.id, { error: msg });
          if (isChatHttp404(raw)) {
            setChatApiBlocked(true);
            setProbeRestartKey((k) => k + 1);
          }
        }
      };

      const FANOUT_BATCH_SIZE = 4;
      try {
        if (parallelReply) {
          for (let i = 0; i < launchJobs.length; i += FANOUT_BATCH_SIZE) {
            const batch = launchJobs.slice(i, i + FANOUT_BATCH_SIZE);
            await Promise.allSettled(
              batch.map((job, j) => runFanoutJob(job, i + j === 0 ? composerSkill : null)),
            );
          }
        } else {
          await runFanoutJob(launchJobs[0], composerSkill);
        }
      } finally {
        stopWechatTyping();
      }
    },
    [
      agentById,
      beginGatewayStream,
      bridge,
      config,
      conversationId,
      finalizeAssistantById,
      agents,
      mainAgent,
      mainAgentLabel,
      orchestrationMode,
      paramC,
      mentionEveryoneLabel,
      participantIds,
      resetGatewayStream,
      resolveWorkspaceContextBlock,
      setProbeRestartKey,
      setSearchParams,
      setMessages,
      t,
    ],
  );

  const launchGroupAgentReply = useCallback(
    async ({ target, historyMessages, triggerAgentId }) => {
      if (!target || !bridge?.startChatStream || !mainAgent || !conversationId) return;

      const now = Date.now();
      const assistantMsg = {
        id: newId(),
        role: /** @type {const} */ ("assistant"),
        content: "",
        thinking: "",
        streaming: true,
        createdAt: now,
        agentId: target.id,
        mentionDelegateReply: true,
        ...(triggerAgentId ? { mentionDelegateFromAgentId: triggerAgentId } : {}),
      };
      const streamId = newId();
      const sessionParticipantIds = [...new Set([mainAgent.id, ...participantIds, target.id])];
      const groupAgents = groupAgentsInSession({
        agents,
        mainAgent,
        participantIds: sessionParticipantIds,
      });
      const workspaceContext = await resolveWorkspaceContextBlock();
      const sysRow = systemRowForGroupAgent(target, t, groupAgents, {
        mentionDelegateReply: true,
        workspaceContext,
      });
      const ctx = resolveAgentGatewayContext({
        conversationId,
        agentId: target.id,
        historyMessages,
        mode: "thread",
        agentById,
        mainAgentStudioId: mainAgent.id,
        forceBootstrap: true,
      });
      const outgoing = [...(sysRow ? [sysRow] : []), ...ctx.priorRows];

      const persistablePrior = historyMessages
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => toPersistedChatMessage(m));
      const persistableNext = [
        ...persistablePrior,
        {
          id: assistantMsg.id,
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          createdAt: assistantMsg.createdAt,
          agentId: assistantMsg.agentId,
          mentionDelegateReply: true,
          ...(triggerAgentId ? { mentionDelegateFromAgentId: triggerAgentId } : {}),
        },
      ];
      const rec = getSession(conversationId);
      const provisionalTitle = deriveTitleFromMessages(
        persistableNext.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinking: m.thinking,
        })),
        { imageFallback: t("chatLab.chatUntitledImage") },
      );
      upsertSession(conversationId, rec?.title || provisionalTitle || "…", persistableNext, {
        participantIds: sessionParticipantIds,
      });

      setMessages((prev) => (prev.some((m) => m.id === assistantMsg.id) ? prev : [...prev, assistantMsg]));
      autoScrollRef.current = true;

      beginGatewayStream({
        conversationId,
        streamId,
        assistantMessageId: assistantMsg.id,
      });
      activeStreamIdsRef.current.add(streamId);
      assistantStreamIdsRef.current.set(assistantMsg.id, streamId);

      const stopWechatTyping = maybeStartWechatTypingPulse(conversationId);
      const lastTurnPreview = [...historyMessages]
        .reverse()
        .find(
          (m) =>
            (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim().length > 0,
        );
      try {
        await bridge.startChatStream({
          streamId,
          conversationId,
          messages: outgoing,
          composerSkill: null,
          agentSessionKey: sessionKeyForAgent(target),
          gatewayAgentId: target.gatewayAgentId,
          concurrent: true,
          contextEmbedMode: ctx.contextEmbedMode,
          ...(ctx.threadSummaryPrefix ? { threadSummaryPrefix: ctx.threadSummaryPrefix } : {}),
          usageMeta: buildStreamUsageMeta({
            conversationTitle: getSession(conversationId)?.title,
            assistantMessageId: assistantMsg.id,
            userContentPreview: String(lastTurnPreview?.content ?? "").trim(),
            agentId: target.id,
          }),
        });
      } catch (err) {
        resetGatewayStream(streamId);
        activeStreamIdsRef.current.delete(streamId);
        assistantStreamIdsRef.current.delete(assistantMsg.id);
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
      agentById,
      agents,
      beginGatewayStream,
      bridge,
      conversationId,
      finalizeAssistantById,
      mainAgent,
      participantIds,
      resetGatewayStream,
      resolveWorkspaceContextBlock,
      setProbeRestartKey,
      setMessages,
      t,
    ],
  );

  const maybeDelegateAfterAgentReply = useCallback(
    (assistantMessageId, mergedHistory) => {
      if (orchestrationMode) return;
      if (!conversationId) return;
      if (delegatedFromMessageRef.current.has(assistantMessageId)) return;

      const msg = mergedHistory.find((m) => m.id === assistantMessageId);
      const sessionAgents = groupAgentsInSession({ agents, mainAgent, participantIds });
      const sessionAgentIds = new Set(sessionAgents.map((a) => a.id));
      if (sessionAgentIds.size < 2) return;
      if (!isDelegatableGroupAssistantMessage(msg, sessionAgentIds)) return;

      const speakerId = String(msg?.agentId ?? "");
      const { mentionIds } = parseAgentDelegateMention(String(msg?.content ?? ""), agents, {
        speakerAgentId: speakerId,
        mainAgent,
        participantIds,
        mainFallback: mainAgentLabel,
        everyoneLabel: mentionEveryoneLabel,
      });
      if (mentionIds.length !== 1) return;

      const target = agentById.get(mentionIds[0]);
      if (!target || target.id === speakerId) return;

      delegatedFromMessageRef.current.add(assistantMessageId);

      const historyWithMentions = mergedHistory.map((m) =>
        m.id === assistantMessageId && !m.mentions?.length ? { ...m, mentions: mentionIds } : m,
      );
      void launchGroupAgentReply({
        target,
        historyMessages: historyWithMentions,
        triggerAgentId: speakerId,
      });
    },
    [
      agentById,
      agents,
      conversationId,
      launchGroupAgentReply,
      mainAgent,
      mainAgentLabel,
      mentionEveryoneLabel,
      orchestrationMode,
      participantIds,
    ],
  );

  useEffect(() => {
    delegateAfterAgentReplyRef.current = maybeDelegateAfterAgentReply;
  }, [maybeDelegateAfterAgentReply]);

  const send = useCallback(async () => {
    if (messagesRef.current.some((m) => m.role === "assistant" && m.streaming)) return;
    if (gatewayStreaming) return;
    const trimmed = input.trim();
    const attachmentSnap =
      composerAttachments.length > 0
        ? composerAttachments.map(({ mime, dataUrl }) => ({ mime, dataUrl }))
        : undefined;
    const fileRefsSnap =
      composerFileRefs.length > 0
        ? composerFileRefs.map(({ path, name, kind }) => ({ path, name, kind }))
        : undefined;
    if (
      !trimmed &&
      (!attachmentSnap || attachmentSnap.length === 0) &&
      (!fileRefsSnap || fileRefsSnap.length === 0)
    ) {
      return;
    }
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

    if (orchestrationMode) {
      if (orchestrationStreamBusy) return;
      if (orchestrationRun?.status === "awaiting_approval") return;
      if (attachmentSnap?.length || fileRefsSnap?.length) return;
      const { cleanText, mentionIds } = parseAgentMentions(trimmed, agents, {
        mainFallback: mainAgentLabel,
        everyoneLabel: mentionEveryoneLabel,
        mainAgent,
        participantIds,
      });
      const effectiveText = cleanText || trimmed;
      const now = Date.now();
      const userMsg = {
        id: newId(),
        role: /** @type {const} */ ("user"),
        content: effectiveText,
        createdAt: now,
        ...(mentionIds.length ? { mentions: mentionIds } : {}),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setComposerSkillRow(null);
      autoScrollRef.current = true;
      const sessionParticipantIds = [
        ...new Set([
          ...(mainAgent ? [mainAgent.id] : []),
          ...participantIds,
          ...mentionIds,
        ]),
      ];
      if (!paramC) setSearchParams({ c: conversationId }, { replace: true });
      const rec = getSession(conversationId);
      const persistable = [
        ...(rec?.messages ?? []),
        {
          id: userMsg.id,
          role: /** @type {const} */ ("user"),
          content: userMsg.content,
          createdAt: userMsg.createdAt,
          ...(mentionIds.length ? { mentions: mentionIds } : {}),
        },
      ];
      upsertSession(conversationId, deriveTitleFromMessages(persistable) || "…", persistable, {
        participantIds: sessionParticipantIds,
        orchestrationMode: true,
        orchestration: rec?.orchestration,
      });
      void orchestrationRunner.startOrchestration(conversationId, effectiveText, mentionIds);
      return;
    }

    await submitNewUserTurn({
      trimmed,
      imageAttachments: attachmentSnap,
      fileRefs: fileRefsSnap,
      skillPickRow: effectiveSkillRow ?? null,
      followUpRef: composerFollowUpRef,
      onCommitted: () => {
        setInput("");
        setComposerSkillRow(null);
        setComposerFollowUpRef(null);
        setComposerAttachments([]);
        setComposerFileRefs([]);
      },
    });
  }, [
    bridge,
    chatApiBlocked,
    commitUserMessageEdit,
    composerAttachments,
    composerFileRefs,
    composerSkillRow,
    configIssueKey,
    conversationId,
    gatewayPhase,
    gatewayStreaming,
    input,
    isElectron,
    orchestrationStreamBusy,
    orchestrationRun?.status,
    agents,
    mainAgent,
    mainAgentLabel,
    mentionEveryoneLabel,
    orchestrationMode,
    orchestrationRunner,
    paramC,
    participantIds,
    setSearchParams,
    submitNewUserTurn,
  ]);

  const quickReplySend = useCallback(
    async (text) => {
      if (pendingEditMessageIdRef.current) return;
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
    if (orchestrationStreamBusy) {
      void orchestrationRunner.pauseOrchestration();
      return;
    }
    void abortAllActiveStreams();
  }, [abortAllActiveStreams, orchestrationStreamBusy, orchestrationRunner]);

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

  const pickMentionAgent = useCallback(
    (agent) => {
      if (!mentionActive) return;
      const next = insertMention(input, mentionActive, agent, mainAgentLabel);
      setInput(next);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const pos = next.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        setMentionCaret(pos);
      });
    },
    [input, mainAgentLabel, mentionActive],
  );

  const pickMentionEveryone = useCallback(() => {
    if (!mentionActive) return;
    const next = insertMentionEveryone(input, mentionActive, mentionEveryoneLabel);
    setInput(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = next.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      setMentionCaret(pos);
    });
  }, [input, mentionActive, mentionEveryoneLabel]);

  const onKeyDown = useCallback(
    /** @param {import('react').KeyboardEvent<HTMLTextAreaElement>} e */
    (e) => {
      if (mentionActive && mentionOptionCount > 0 && !e.nativeEvent.isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionHighlightIndex((i) => (i + 1) % mentionOptionCount);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionHighlightIndex((i) => (i - 1 + mentionOptionCount) % mentionOptionCount);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (mentionEveryoneVisible && mentionHighlightIndex === 0) {
            pickMentionEveryone();
          } else {
            const agentIndex = mentionHighlightIndex - (mentionEveryoneVisible ? 1 : 0);
            const agent = mentionFilteredAgents[agentIndex];
            if (agent) pickMentionAgent(agent);
          }
          return;
        }
      }

      if (slashSkillMenuOpen && slashFilteredSkills.length > 0 && !e.nativeEvent.isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashHighlightIndex((i) => (i + 1) % slashFilteredSkills.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashHighlightIndex((i) => (i - 1 + slashFilteredSkills.length) % slashFilteredSkills.length);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const row = slashFilteredSkills[slashHighlightIndex];
          if (row) pickSlashSkill(row);
          return;
        }
      }

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
    [
      canSend,
      composerLongTextMode,
      mentionActive,
      mentionEveryoneVisible,
      mentionFilteredAgents,
      mentionHighlightIndex,
      mentionOptionCount,
      pickMentionAgent,
      pickMentionEveryone,
      pickSlashSkill,
      send,
      slashFilteredSkills,
      slashHighlightIndex,
      slashSkillMenuOpen,
    ],
  );

  const isLanding = !messages.some((m) => m.messageKind !== "group_member_event");
  const {
    landingRevealReady,
    playHeroTitleEntrance,
    shellPhase,
    bootPhase,
    progressFrac,
    progressExiting,
    gatePortalEl,
  } =
    useBootstrapGate();
  const portalHeroRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const landingHeroRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  useBootstrapHeroRelease(portalHeroRef, landingHeroRef, shellPhase);

  const gatePending = shellPhase !== "ready";
  const showPortalChrome = gatePending && (shellPhase === "loading" || shellPhase === "exiting");
  const hideLandingHero = isLanding && gatePending && (shellPhase === "loading" || shellPhase === "exiting");
  const gatePortalTarget =
    gatePortalEl ??
    (typeof document !== "undefined" ? document.querySelector(".bootstrap-gate-chrome") : null);
  const gateStepLabel = useMemo(() => {
    switch (bootPhase) {
      case "config_synced":
        return t("bootstrap.stepSyncConfig");
      case "gateway_connect":
        return t("bootstrap.stepConnectingGateway");
      case "tools_catalog":
      case "session_ensure":
      case "tools_effective":
        return t("bootstrap.stepPreparingTools");
      case "gateway_ready":
      case "skipped_no_gateway":
      case "complete":
        return t("bootstrap.stepReady");
      case "gateway_retrying":
        return t("bootstrap.stepRetrying");
      default:
        return t("bootstrap.stepStarting");
    }
  }, [bootPhase, t]);

  const orchestrationAwaitingPlan =
    orchestrationMode && orchestrationRun?.status === "awaiting_approval";

  const streamLocked = useMemo(
    () =>
      gatewayStreaming ||
      orchestrationStreamBusy ||
      messages.some((m) => m.role === "assistant" && m.streaming),
    [gatewayStreaming, orchestrationStreamBusy, messages],
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

  const composerPendingImageChars = useMemo(
    () =>
      imageAttachmentsContextChars(
        composerAttachments.map((a) => ({ dataUrl: a.dataUrl })),
        { includePayload: true },
      ),
    [composerAttachments],
  );

  const contextUsageApprox = useMemo(() => {
    const chars = estimateThreadCharBudget(messages, {
      systemPromptLen: composeChatLabSystemPrompt(t).length,
      inputLen: input.length,
      pendingImagePayloadChars: composerPendingImageChars,
    });
    const tokens = approxTokensFromChars(chars);
    const frac = tokens / CONTEXT_WINDOW_APPROX_TOKENS;
    return { chars, tokens, frac };
  }, [composerPendingImageChars, input.length, messages, t]);

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

  const addComposerDroppedFiles = useCallback(
    /** @param {FileList | File[] | null | undefined} fileList */
    async (fileList) => {
      if (composerInputLocked) return;
      const files = Array.from(fileList ?? []).filter(Boolean);
      if (files.length === 0) return;

      const getPathForFile = bridge?.getPathForFile;
      const statLocalPath = bridge?.statLocalPath;
      if (typeof getPathForFile !== "function" || typeof statLocalPath !== "function") {
        const imageFiles = files.filter((f) => typeof f.type === "string" && f.type.startsWith("image/"));
        if (imageFiles.length > 0) void addComposerImageFiles(imageFiles);
        else setComposerAttachErrKey("chatLab.fileRefElectronOnly");
        return;
      }

      setComposerAttachErrKey(null);
      const resolved = await resolveDroppedLocalPaths(
        files,
        (file) => String(getPathForFile(file) ?? "").trim(),
        async (p) => {
          try {
            return await statLocalPath(p);
          } catch {
            return null;
          }
        },
      );
      if (resolved.length === 0) {
        setComposerAttachErrKey("chatLab.fileRefPathUnavailable");
        return;
      }

      setComposerFileRefs((prev) => {
        const seen = new Set(prev.map((r) => r.path));
        const merged = [...prev];
        for (const row of resolved) {
          if (seen.has(row.path)) continue;
          seen.add(row.path);
          merged.push(row);
        }
        if (merged.length <= MAX_CHAT_COMPOSER_FILE_REFS) return merged;
        setComposerAttachErrKey("chatLab.maxComposerFileRefs");
        return merged.slice(0, MAX_CHAT_COMPOSER_FILE_REFS);
      });
    },
    [addComposerImageFiles, bridge, composerInputLocked],
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
    const rawRefs =
      typeof payload === "object" && payload && Array.isArray(payload.fileRefs) ? payload.fileRefs : [];
    setComposerFileRefs(
      rawRefs.map((r, i) => ({
        id: `edit_${messageId}_${i}`,
        path: String(r?.path ?? ""),
        name: String(r?.name ?? ""),
        kind: r?.kind === "directory" ? /** @type {const} */ ("directory") : /** @type {const} */ ("file"),
      })).filter((r) => r.path && r.name),
    );
    setComposerFollowUpRef(
      typeof payload === "object" && payload && payload.followUpRef ? payload.followUpRef : null,
    );
    setInput(content);
    autoScrollRef.current = true;
  }, [skillPickList]);

  const prefillComposerFollowUp = useCallback(
    /** @param {{ quoteText: string; sourceMessageId: string; sourceRole: "user" | "assistant"; sourceAgentId?: string | null }} payload */
    (payload) => {
      const quoteText = String(payload?.quoteText ?? "").trim();
      if (!quoteText || !payload?.sourceMessageId) return;

      let agentName = mainAgent ? agentDisplayLabel(mainAgent) : mainAgentLabel;
      if (payload.sourceRole === "assistant" && payload.sourceAgentId && agentById.has(payload.sourceAgentId)) {
        agentName = agentDisplayLabel(agentById.get(payload.sourceAgentId));
      } else if (payload.sourceRole === "user") {
        agentName = t("chatLab.followUpSourceUser");
      }

      setPendingEditMessageId(null);
      setComposerFollowUpRef({
        sourceMessageId: payload.sourceMessageId,
        sourceRole: payload.sourceRole,
        ...(payload.sourceAgentId ? { sourceAgentId: payload.sourceAgentId } : {}),
        agentName,
        quoteText,
      });
      autoScrollRef.current = true;
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [agentById, mainAgent, mainAgentLabel, t],
  );

  const navigateFollowUpRef = useCallback(
    /** @param {import("../chat/chatSessionsStore.js").MessageFollowUpRef} ref */
    (ref) => {
      navigateToFollowUpQuote({
        sourceMessageId: ref.sourceMessageId,
        quoteText: ref.quoteText,
        scrollContainer: messagesScrollRef.current,
      });
    },
    [messagesScrollRef],
  );

  const composerResizeSnapHint =
    composerResizeDragging && composerTextareaPx >= composerSnapPx && !composerLongTextMode;

  const showOrchestrationPlanPopover = Boolean(
    orchestrationRun?.status &&
      orchestrationRun.status !== "failed" &&
      (orchestrationInProgress || Boolean(orchestrationRun.plan?.tasks?.length)),
  );

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
            if (e.dataTransfer?.files?.length) void addComposerDroppedFiles(e.dataTransfer.files);
          }}
        >
          {composerFollowUpRef ||
          composerSkillRow ||
          composerSkillRowLeaving ||
          composerFileRefs.length > 0 ||
          composerFileRefsLeaving ? (
            <div
              className={cn(
                "chat-lab__shell-skill-row",
                (composerSkillRowLeaving || composerFileRefsLeaving) && "chat-lab__shell-skill-row--leaving",
              )}
              aria-label={t("chatLab.composerRefsRowLabel")}
            >
              {composerFollowUpRef ?
                <ComposerFollowUpChip
                  agentName={composerFollowUpRef.agentName}
                  quoteText={composerFollowUpRef.quoteText}
                  onNavigate={() => navigateFollowUpRef(composerFollowUpRef)}
                  onClear={() => setComposerFollowUpRef(null)}
                  disabled={composerInputLocked}
                  clearLabel={t("chatLab.followUpChipClose")}
                />
              : null}
              {composerSkillRow ? (
                <ComposerSkillChip
                  row={composerSkillRow}
                  disabled={composerSkillUiLocked}
                  onClear={clearComposerSkillRow}
                  t={t}
                />
              ) : null}
              {composerFileRefs.map((row) => (
                <ComposerFileRefChip
                  key={row.id}
                  row={row}
                  disabled={composerInputLocked}
                  onClear={() => setComposerFileRefs((prev) => prev.filter((x) => x.id !== row.id))}
                  t={t}
                />
              ))}
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
                : composerAttachErrKey === "chatLab.maxComposerFileRefs"
                  ? t(composerAttachErrKey, { max: MAX_CHAT_COMPOSER_FILE_REFS })
                  : t(composerAttachErrKey)}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className={cn(
              "chat-lab__shell-textarea",
              (composerFollowUpRef || composerSkillRow || composerFileRefs.length > 0) &&
                "chat-lab__shell-textarea--with-chip",
              composerAttachments.length > 0 && "chat-lab__shell-textarea--with-attachments",
            )}
            style={{
              height: composerTextareaPx,
              maxHeight: composerMaxPx,
            }}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setMentionCaret(e.target.selectionStart ?? 0);
            }}
            onSelect={(e) => setMentionCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyUp={(e) => setMentionCaret(e.currentTarget.selectionStart ?? 0)}
            onCompositionEnd={(e) => setMentionCaret(e.currentTarget.selectionStart ?? 0)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
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
          open={slashSkillMenuOpen}
          textareaRef={textareaRef}
          filterQuery={slashFilterQuery}
          skills={skillPickList}
          highlightIndex={slashHighlightIndex}
          onHighlightIndexChange={setSlashHighlightIndex}
          onPick={pickSlashSkill}
          onClose={() => {}}
          t={t}
        />
        <ChatLabAgentMentionPopover
          open={Boolean(mentionActive)}
          textareaRef={textareaRef}
          agents={mentionEligible}
          query={mentionActive?.query ?? ""}
          highlightIndex={mentionHighlightIndex}
          onHighlightIndexChange={setMentionHighlightIndex}
          everyoneLabel={mentionEveryoneLabel}
          showEveryone={mentionEveryoneEnabled}
          onPickEveryone={pickMentionEveryone}
          onPick={pickMentionAgent}
          onClose={() => {}}
        />
        <div className="chat-lab__shell-toolbar">
          <ChatLabToolbarScroll>
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
              className="chat-lab__pill-model"
            />
            <Checkbox
              id="chat-toolbar-orch-toggle"
              className="chat-lab__orch-check"
              tone="toolbar"
              checked={orchestrationMode}
              disabled={composerInputLocked || orchestrationInProgress}
              label={t("orchestration.modeToggle")}
              title={t("orchestration.modeToggleHint")}
              onCheckedChange={(on) => {
                setOrchestrationMode(on);
                if (paramC) setSessionOrchestrationMode(paramC, on);
              }}
            />
            {orchestrationMode ? (
              <Checkbox
                id="chat-toolbar-orch-fast-toggle"
                className="chat-lab__orch-check"
                tone="toolbar"
                checked={orchestrationFastMode}
                disabled={composerInputLocked || orchestrationInProgress}
                label={t("orchestration.fastModeToggle")}
                title={t("orchestration.fastModeToggleHint")}
                onCheckedChange={(on) => {
                  setOrchestrationFastMode(on);
                  if (paramC) setSessionOrchestrationFastMode(paramC, on);
                }}
              />
            ) : null}
            {showOrchestrationPlanPopover && orchestrationRun ? (
              <ChatLabOrchestrationPlanPopover
                plan={orchestrationRun.plan}
                run={orchestrationRun}
                agents={participantPool}
                actionsDisabled={orchestrationStreamBusy}
                onApprove={() => orchestrationRunner.approvePlan(conversationId)}
                onReject={() => orchestrationRunner.rejectPlan(conversationId)}
                onRevise={(notes) => orchestrationRunner.revisePlan(conversationId, notes)}
                onResume={() => orchestrationRunner.resumeOrchestration(conversationId)}
                t={t}
              />
            ) : null}
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
          </ChatLabToolbarScroll>
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
                gatewayStreaming || orchestrationStreamBusy ? "chat-lab__send-round--stop" : "chat-lab__send-round--send",
                !gatewayStreaming && !orchestrationStreamBusy && canSend && !orchestrationAwaitingPlan && "chat-lab__send-round--active",
              )}
              disabled={!gatewayStreaming && !orchestrationStreamBusy && (!canSend || orchestrationAwaitingPlan)}
              onClick={gatewayStreaming || orchestrationStreamBusy ? stop : send}
              title={
                gatewayStreaming || orchestrationStreamBusy
                  ? t("chatLab.stop")
                  : orchestrationAwaitingPlan
                    ? t("orchestration.awaitingPlanComposerHint")
                    : sendButtonTitle
              }
              aria-label={gatewayStreaming || orchestrationStreamBusy ? t("chatLab.stop") : t("chatLab.send")}
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
    <ChatLabWorkspaceProvider key={conversationId} conversationId={conversationId} isEmptySession={isLanding}>
    <ChatLabPreviewProvider>
      <ImageViewProvider>
      <ChatLabWorkspaceActiveRootBridge activeRootRef={activeRootRef} />
      <ChatLabAutoHtmlPreview conversationId={conversationId} messages={messages} />
      <ChatLabAutoLinkPreview conversationId={conversationId} messages={messages} />
      <ChatLabSessionScopeReset conversationId={conversationId} isEmptySession={isLanding} />
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
                <ChatLabConvHeader
                  headerTitle={headerTitle}
                  conversationId={conversationId}
                  messages={messages}
                  messagesScrollRef={messagesScrollRef}
                  autoScrollRef={autoScrollRef}
                  threadScrollApiRef={threadScrollApiRef}
                  agents={agents}
                  participantIds={[
                    ...(mainAgent ? [mainAgent.id] : []),
                    ...participantIds.filter((id) => id !== mainAgent?.id),
                  ]}
                  onParticipantsChange={handleParticipantsChange}
                  participantsDisabled={composerInputLocked || gatewayStreaming}
                />
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
                <ChatLabThreadNav
                  headerTitle={headerTitle}
                  conversationId={conversationId}
                  messages={messages}
                  messagesScrollRef={messagesScrollRef}
                  autoScrollRef={autoScrollRef}
                  threadScrollApiRef={threadScrollApiRef}
                  agents={agents}
                  participantIds={[
                    ...(mainAgent ? [mainAgent.id] : []),
                    ...participantIds.filter((id) => id !== mainAgent?.id),
                  ]}
                  onParticipantsChange={handleParticipantsChange}
                  participantsDisabled={composerInputLocked || gatewayStreaming}
                >
                  <ChatLabMessageList
                    key={conversationId}
                    conversationId={conversationId}
                    messages={messages}
                    sessionArtifacts={sessionArtifacts}
                    agentById={agentById}
                    agents={agents}
                    messagesScrollRef={messagesScrollRef}
                    autoScrollRef={autoScrollRef}
                    threadScrollApiRef={threadScrollApiRef}
                    gatewayStreaming={gatewayStreaming}
                    gatewayStreamSlices={gatewaySlicesForConv}
                    streamLocked={streamLocked}
                    userBubbleEnterMessageId={userBubbleEnterMessageId}
                    onUserBubbleEnterAnimEnd={clearUserBubbleEnterAnim}
                    onBeginUserEdit={beginComposerEdit}
                    onFollowUpNavigate={navigateFollowUpRef}
                    onQuickReply={quickReplySend}
                    quickReplyDisabled={streamLocked || Boolean(pendingEditMessageId)}
                    remeasureKey={location.key}
                    t={t}
                    locale={locale}
                    threadLabel={t("chatLab.title")}
                    mainAgentLabel={mainAgentLabel}
                    mentionEveryoneLabel={mentionEveryoneLabel}
                    mainAgent={mainAgent}
                    participantIds={participantIds}
                    collapseTracePanels={parallelReplyActive}
                    orchestrationMode={orchestrationMode}
                    orchestrationUiMessages={orchestrationUiMessages}
                    orchestrationRun={orchestrationRun}
                    orchestrationBusy={orchestrationRunnerActive || gatewayStreaming}
                    onApprovePlan={() => orchestrationRunner.approvePlan(conversationId)}
                    onRejectPlan={() => orchestrationRunner.rejectPlan(conversationId)}
                    onRevisePlan={(notes) => orchestrationRunner.revisePlan(conversationId, notes)}
                    onOpenOrchestrationFlow={() => setOrchestrationSideMode("timeline")}
                  />
                </ChatLabThreadNav>
                <ChatLabSelectionToolbar
                  scrollContainerRef={messagesScrollRef}
                  onFollowUp={prefillComposerFollowUp}
                  followUpDisabled={streamLocked || Boolean(pendingEditMessageId)}
                />
              </div>
            )}
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
                      <p className="chat-lab__gate-progress-step">{gateStepLabel}</p>
                    </div>
                  </div>,
                  gatePortalTarget,
                )
              : null}
            <ChatLabComposerSlot
              className={gatePending ? "chat-lab__composer-slot--gate-pending" : undefined}
            >
              <ChatLabContextBar />
              {composer}
            </ChatLabComposerSlot>
          </div>
        </div>
        <ChatLabPreviewDock
          extension={
            orchestrationMode &&
            orchestrationRun?.status &&
            orchestrationRun.status !== "failed" &&
            (orchestrationInProgress || orchestrationSideMode === "timeline")
              ? {
                  title: t("orchestration.dock.title"),
                  meta:
                    orchestrationSideMode === "live"
                      ? t("orchestration.dock.activeWorkers", {
                          count: Array.isArray(orchestrationRun.activeTaskIds)
                            ? orchestrationRun.activeTaskIds.length
                            : 0,
                        })
                      : undefined,
                  body: (
                    <ChatLabOrchestrationSidePanel
                      mode={orchestrationSideMode}
                      run={orchestrationRun}
                      mainAgent={mainAgent}
                      agents={agents}
                      messages={orchestrationUiMessages}
                      gatewaySlices={gatewaySlicesForConv}
                      busy={Boolean(orchestrationRunnerActive || gatewayStreaming)}
                      currentStepTitle={orchestrationCurrentStepTitle}
                      t={t}
                      renderWorkerMessage={(message) => (
                        <OrchestrationWorkerMessageBubble
                          message={message}
                          agentById={agentById}
                          mainAgentLabel={mainAgentLabel}
                          t={t}
                          locale={locale}
                          streamLocked={streamLocked}
                          orchestrationBusy={Boolean(orchestrationRunnerActive || gatewayStreaming)}
                        />
                      )}
                    />
                  ),
                }
              : null
          }
        />
      </div>
      </ImageViewProvider>
    </ChatLabPreviewProvider>
    </ChatLabWorkspaceProvider>
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

/**
 * When link open mode is sidebar, auto-load the first https link in a finished assistant reply.
 * @param {{ conversationId: string; messages: Array<{ id: string; role: string; content?: string; streaming?: boolean; error?: string }> }} props
 */
function ChatLabAutoLinkPreview({ conversationId, messages }) {
  const preview = useChatLabPreview();
  const handledTailIdRef = useRef(/** @type {string | null} */ (null));

  useEffect(() => {
    handledTailIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (!preview?.openFromHref) return;
    if (readLinkOpenModeLocal() === "external") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.streaming || last.error) return;
    if (handledTailIdRef.current === last.id) return;
    handledTailIdRef.current = last.id;
    if (lastHtmlFenceAsSrcDocDocument(String(last.content ?? ""))) return;
    const url = extractFirstWebMarkdownLink(String(last.content ?? ""));
    if (!url) return;
    preview.openFromHref(url, url);
  }, [messages, preview]);

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
function GapToolActivityPanel({
  segments,
  toolMap,
  activityMap,
  t,
  streaming,
  keepCollapsed = false,
  nested = false,
  collapseWhenIdle = true,
}) {
  const [open, setOpen] = useState(() => !keepCollapsed && Boolean(streaming));
  const enterRegistryRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (keepCollapsed) {
      setOpen(false);
      return;
    }
    if (streaming) setOpen(true);
    else if (collapseWhenIdle) setOpen(false);
  }, [streaming, keepCollapsed, collapseWhenIdle]);

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

  const disableEnterAnim = shouldDisableTraceRowEnterAnim(streaming, segments.length);

  return (
    <TraceDisclosure
      className={cn(
        "chat-lab__tool-chain chat-lab__timeline-gap-chain",
        nested && "chat-lab__tool-chain--orch-nested",
      )}
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
                disableEnterAnim={disableEnterAnim}
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
              disableEnterAnim={disableEnterAnim}
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
 *   keepTraceCollapsed?: boolean;
 *   nested?: boolean;
 *   plainText?: boolean;
 * }} props
 */
const AssistantInterleavedBody = memo(function AssistantInterleavedBody({
  timeline,
  toolRows,
  activityRows,
  mdComponents = {},
  t,
  streaming,
  tailBusy,
  tailBusyLabel,
  keepTraceCollapsed = false,
  nested = false,
  plainText = false,
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
    return coalesceImageOnlyTextParts(out);
  }, [timeline]);

  const visibleParts = renderParts;

  const lastGapPartIdx = useMemo(() => {
    let last = -1;
    visibleParts.forEach((p, idx) => {
      if (p.kind === "toolActivityGap") last = idx;
    });
    return last;
  }, [visibleParts]);

  const lastThinkingPartIdx = useMemo(() => {
    let last = -1;
    visibleParts.forEach((p, idx) => {
      if (p.kind === "thinking") last = idx;
    });
    return last;
  }, [visibleParts]);

  return (
    <div className="chat-lab__assistant-timeline">
      {visibleParts.map((p, ri) => {
        if (p.kind === "text") {
          if (!String(p.body ?? "").trim()) return null;
          if (plainText) {
            return (
              <div
                key={p.key}
                className="chat-lab__timeline-block chat-lab__timeline-block--text chat-lab__timeline-block--plain"
              >
                {p.body}
              </div>
            );
          }
          return (
            <div key={p.key} className="chat-lab__timeline-block chat-lab__timeline-block--text chat-lab__md">
              <ChatLabMarkdownContent source={String(p.body ?? "")} components={mdComponents} />
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
              keepCollapsed={keepTraceCollapsed}
              nested={nested}
              collapseWhenIdle={!nested}
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

function isCompletedActivityPhase(rawPhase) {
  const phase = String(rawPhase ?? "").trim().toLowerCase();
  if (!phase) return false;
  return (
    phase === "end" ||
    phase === "done" ||
    phase === "complete" ||
    phase === "completed" ||
    phase === "ok" ||
    phase === "success" ||
    phase === "lifecycle-end" ||
    phase === "lifecycle_end"
  );
}

/** @param {string | undefined} refId */
function isTerminalLifecycleRef(refId) {
  const ref = String(refId ?? "");
  return /^lifecycle:[^:]*:(end|error|failed|cancelled|canceled|complete|completed|ok)$/i.test(ref);
}

/** @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} nestedActivity */
function orchestrationNestedLifecycleEnded(nestedActivity) {
  if (!Array.isArray(nestedActivity) || !nestedActivity.length) return false;
  return nestedActivity.some(
    (r) =>
      String(r.stream ?? "").toLowerCase() === "lifecycle" &&
      isCompletedActivityPhase(r.phase),
  );
}

/** @param {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[] | undefined} timeline */
function orchestrationTimelineLifecycleEnded(timeline) {
  if (!Array.isArray(timeline) || !timeline.length) return false;
  return timeline.some((seg) => seg?.kind === "activity" && isTerminalLifecycleRef(seg.refId));
}

/** @param {import("../chat/toolTraceMerge.js").ActivityRow} row */
function orchestrationRowLifecycleEnded(row) {
  return (
    orchestrationNestedLifecycleEnded(row.nestedActivity) ||
    orchestrationTimelineLifecycleEnded(row.assistantTimeline)
  );
}

/** @returns {"ok"|"run"|"fail"} */
function activityGlyphState(row, streaming, isTailRow) {
  const phase = String(row.phase ?? "").toLowerCase();
  const hay = `${String(row.title ?? "")}\n${String(row.text ?? "").slice(0, 480)}`;
  const looksFail =
    /^(error|failed|fatal|abort|timeout)\b|\berror\b|exception|not found\b/i.test(phase) ||
    /\bfail(ed|ure)?\b|fatal|unable to|ECONN|\b\d{3}\s+error\b/i.test(hay);
  if (looksFail) return "fail";
  if (isCompletedActivityPhase(phase)) return "ok";
  if (streaming && isTailRow) return "run";
  return "ok";
}

/** Completed trace panels with more than this many rows skip per-row enter animations. */
const TRACE_ROW_ENTER_ANIM_MAX = 10;

/**
 * @param {boolean} streaming
 * @param {number} childCount
 */
function shouldDisableTraceRowEnterAnim(streaming, childCount) {
  return !streaming && childCount > TRACE_ROW_ENTER_ANIM_MAX;
}

/**
 * Claim a one-time enter animation when this row instance mounts (not when parent merely sees the id).
 * @param {string} rowId
 * @param {import("react").MutableRefObject<Set<string>>} enterRegistryRef
 * @param {boolean} [enterAnimDisabled]
 */
function useTraceRowEnterOnMount(rowId, enterRegistryRef, enterAnimDisabled = false) {
  const showRef = useRef(false);
  if (enterAnimDisabled) return false;
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
 *   disableEnterAnim?: boolean;
 * }} props
 */
function ToolRow({ row, t, enterRegistryRef, disableEnterAnim = false }) {
  const showEnterAnim = useTraceRowEnterOnMount(row.id, enterRegistryRef, disableEnterAnim);
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
function ToolChainPanel({ rows, t, streaming, keepCollapsed = false }) {
  const [open, setOpen] = useState(() => !keepCollapsed && Boolean(streaming));
  const enterRegistryRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (keepCollapsed) {
      setOpen(false);
      return;
    }
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming, keepCollapsed]);
  if (!rows?.length) return null;
  const disableEnterAnim = shouldDisableTraceRowEnterAnim(streaming, rows.length);
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
          <ToolRow
            key={row.id}
            row={row}
            t={t}
            enterRegistryRef={enterRegistryRef}
            disableEnterAnim={disableEnterAnim}
          />
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
 *   disableEnterAnim?: boolean;
 * }} props
 */
function ActivityRow({
  row,
  t,
  streaming,
  isTail,
  enterRegistryRef,
  autoExpandOnContent = false,
  stepTitleOnly = false,
  mdComponents,
  disableEnterAnim = false,
}) {
  const showEnterAnimRaw = useTraceRowEnterOnMount(row.id, enterRegistryRef, disableEnterAnim);
  const stream = truncateOneLine(String(row.stream ?? "").trim(), 64);
  const isOrchRow = stream.toLowerCase() === "orchestration";
  const orchEventKey =
    typeof row.orchestrationEventKey === "string" ? row.orchestrationEventKey.trim() : "";
  const isOrchAssignment =
    Boolean(row.orchestrationAssignment) ||
    orchEventKey === "pre_task_start" ||
    orchEventKey === "task_assigned";
  const showEnterAnim = isOrchRow ? false : showEnterAnimRaw;
  const titleRaw = String(row.title ?? "").trim();
  const phase = String(row.phase ?? "").trim();
  const headline =
    stream.toLowerCase() === "lifecycle" && phase
      ? `${titleRaw || stream} · ${phase}`
      : titleRaw || stream || "—";
  const title = truncateOneLine(headline, 104);
  const textRaw = typeof row.text === "string" ? row.text.trim() : "";
  const truncatedText = textRaw.length > 2000 ? `${textRaw.slice(0, 2000)}…` : textRaw;
  const nestedToolRows = Array.isArray(row.toolTrace) ? row.toolTrace : [];
  const nestedActivityRows = Array.isArray(row.nestedActivity) ? row.nestedActivity : [];
  const workerTimeline = Array.isArray(row.assistantTimeline) ? row.assistantTimeline : [];
  const workerStreaming = isOrchAssignment ? false : Boolean(row.workerStreaming);
  const rowPhase = String(row.phase ?? "").trim();
  const rowInterrupted = Boolean(row.orchestrationInterrupted);
  const isOrchLeadStep = Boolean(row.orchestrationLeadStep);
  const agentLifecycleEnded =
    isOrchRow &&
    !rowInterrupted &&
    (orchestrationNestedLifecycleEnded(nestedActivityRows) ||
      orchestrationTimelineLifecycleEnded(workerTimeline));
  const rowDone =
    !rowInterrupted &&
    (isOrchAssignment || isCompletedActivityPhase(rowPhase) || agentLifecycleEnded);
  const rowActive = !rowDone && !rowInterrupted && (workerStreaming || rowPhase === "running");

  const titleOnly =
    stepTitleOnly || (Boolean(row.orchestrationStepTitleOnly) && !isOrchLeadStep);
  const hasDetail = titleOnly
    ? false
    : isOrchAssignment
      ? false
      : Boolean(
          isOrchRow
            ? isOrchLeadStep
              ? truncatedText.length > 0 ||
                workerTimeline.length > 0 ||
                nestedToolRows.length > 0 ||
                nestedActivityRows.length > 0 ||
                rowActive
              : rowActive ||
                workerTimeline.length > 0 ||
                truncatedText.length > 0 ||
                nestedToolRows.length > 0 ||
                nestedActivityRows.length > 0
            : phase ||
              truncatedText.length > 0 ||
              stream ||
              nestedToolRows.length > 0 ||
              nestedActivityRows.length > 0,
        );

  const ariaPieces = [stream, titleRaw || undefined, phase || undefined].filter(Boolean);
  const aria = ariaPieces.length ? ariaPieces.join(" · ") : title;
  const gState = rowInterrupted
    ? "fail"
    : rowDone
      ? "ok"
      : activityGlyphState(
          row,
          Boolean(streaming || workerStreaming),
          Boolean(isOrchRow ? rowActive : isTail || workerStreaming),
        );

  const [rowOpen, setRowOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (!autoExpandOnContent || titleOnly) return;
    const active = isOrchRow
      ? rowActive
      : !rowDone &&
        (workerStreaming ||
          rowPhase === "running" ||
          (Boolean(streaming) && Boolean(isTail) && rowPhase === "running"));
    if (active) {
      autoOpenedRef.current = true;
      if (!rowOpen) setRowOpen(true);
      return;
    }
    if (autoOpenedRef.current && !userInteractedRef.current && rowOpen) {
      setRowOpen(false);
    }
  }, [autoExpandOnContent, isOrchRow, rowActive, rowDone, workerStreaming, streaming, isTail, rowPhase]);

  const nestedScrollDigest = useMemo(
    () =>
      [
        nestedActivityRows
          .map((r) =>
            [
              r.id,
              String(r.stream ?? ""),
              String(r.phase ?? ""),
              String(r.text ?? "").length,
              timelineContentDigest(r.assistantTimeline),
              toolTraceContentDigest(r.toolTrace),
              r.workerStreaming ? 1 : 0,
            ].join("."),
          )
          .join("|"),
        toolTraceContentDigest(nestedToolRows),
        timelineContentDigest(workerTimeline),
        truncatedText.length,
        workerStreaming ? 1 : 0,
        agentLifecycleEnded ? 1 : 0,
      ].join(":"),
    [
      nestedActivityRows,
      nestedToolRows,
      workerTimeline,
      truncatedText,
      workerStreaming,
      agentLifecycleEnded,
    ],
  );
  const nestedScrollPinActive = isOrchRow && rowActive;

  return (
    <TraceDisclosure
      variant="row"
      expandable={hasDetail}
      {...(autoExpandOnContent
        ? {
            open: rowOpen,
            onOpenChange: (next) => {
              userInteractedRef.current = true;
              setRowOpen(next);
            },
          }
        : { defaultOpen: false })}
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
        <TraceNestedScrollBody
          className={cn("chat-lab__tool-nested-body", isOrchRow && "chat-lab__tool-nested-body--orch")}
          pinActive={nestedScrollPinActive}
          contentDigest={nestedScrollDigest}
        >
          {isOrchRow ? (
            isOrchLeadStep ? (
              truncatedText ? (
                <div className="chat-lab__activity-text chat-lab__activity-text--orch chat-lab__activity-text--plain">
                  {truncatedText}
                </div>
              ) : workerTimeline.length > 0 || nestedToolRows.length > 0 || nestedActivityRows.length > 0 ? (
                <div className="chat-lab__orch-nested-traces chat-lab__orch-nested-traces--interleaved">
                  <AssistantInterleavedBody
                    timeline={workerTimeline}
                    toolRows={nestedToolRows}
                    activityRows={nestedActivityRows}
                    mdComponents={{}}
                    t={t}
                    streaming={workerStreaming}
                    tailBusy={false}
                    tailBusyLabel={t("chatLab.streaming")}
                    keepTraceCollapsed={false}
                    nested
                    plainText
                  />
                </div>
              ) : null
            ) : workerTimeline.length > 0 || nestedToolRows.length > 0 || nestedActivityRows.length > 0 ? (
              <div className="chat-lab__orch-nested-traces chat-lab__orch-nested-traces--interleaved">
                <AssistantInterleavedBody
                  timeline={workerTimeline}
                  toolRows={nestedToolRows}
                  activityRows={nestedActivityRows}
                  mdComponents={mdComponents ?? {}}
                  t={t}
                  streaming={workerStreaming}
                  tailBusy={false}
                  tailBusyLabel={t("chatLab.streaming")}
                  keepTraceCollapsed={false}
                  nested={!mdComponents}
                  plainText={!mdComponents}
                />
              </div>
            ) : truncatedText ? (
              <div className="chat-lab__activity-text chat-lab__activity-text--orch">{truncatedText}</div>
            ) : null
          ) : (
            <>
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
            </>
          )}
        </TraceNestedScrollBody>
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
function ActivityChainPanel({
  rows,
  t,
  streaming,
  keepCollapsed = false,
  orchestrationMode = false,
  stepTitleOnly = false,
  mdComponents,
}) {
  const [open, setOpen] = useState(() => !keepCollapsed && Boolean(streaming));
  const enterRegistryRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (keepCollapsed) {
      setOpen(false);
      return;
    }
    if (orchestrationMode) {
      setOpen(Boolean(streaming));
      return;
    }
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming, keepCollapsed, orchestrationMode]);
  if (!rows?.length) return null;
  const disableEnterAnim = shouldDisableTraceRowEnterAnim(streaming, rows.length);
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
            isTail={
              Boolean(streaming) &&
              !r.orchestrationInterrupted &&
              (Boolean(r.workerStreaming) ||
                (String(r.phase ?? "") === "running" && !orchestrationRowLifecycleEnded(r)))
            }
            enterRegistryRef={enterRegistryRef}
            autoExpandOnContent={orchestrationMode}
            stepTitleOnly={stepTitleOnly}
            mdComponents={mdComponents}
            disableEnterAnim={disableEnterAnim}
          />
        ))}
      </div>
    </TraceDisclosure>
  );
}

/**
 * @param {string} eventKey
 */
function isOrchestrationStepOnlyEvent(eventKey) {
  return (
    eventKey === "task_assigned" ||
    eventKey === "task_start" ||
    eventKey === "task_done" ||
    eventKey === "pre_task_start" ||
    eventKey === "pre_task_running" ||
    eventKey === "pre_task_done" ||
    eventKey === "review_passed" ||
    eventKey === "review_rework" ||
    eventKey === "review_blocked" ||
    eventKey === "synthesizing_plan" ||
    eventKey === "awaiting_approval" ||
    eventKey === "plan_approved" ||
    eventKey === "plan_rejected"
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

function MessageMetaCopiedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 12.5 10 16l7.5-9"
        stroke="currentColor"
        strokeWidth="1.85"
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

  const userMdSource = String(message.content ?? "");

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
            <ChatLabMarkdownContent source={userMdSource} components={mdComponents} />
          </div>
        ) : null}
        {Array.isArray(message.imageAttachments) && message.imageAttachments.length > 0 ? (
          <div className="chat-lab__user-images">
            {message.imageAttachments.map((att, idx) => (
              <Image
                key={`${message.id}-img-${idx}`}
                src={att.dataUrl}
                alt=""
                className="chat-lab__user-image-link"
                imgClassName="chat-lab__user-image"
                fit="contain"
                loading="lazy"
                previewable
                previewGroup={message.imageAttachments.map((item) => ({
                  src: item.dataUrl,
                  alt: "",
                }))}
                previewIndex={idx}
              />
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
 *     mentions?: string[];
 *     messageKind?: "orchestration_event" | "orchestration_plan";
 *     orchestrationPlan?: import("../studio/orchestration.js").OrchestrationPlan;
 *   };
 *   agents?: import("../studio/agents.js").LobsterAgent[];
 *   orchestrationRun?: import("../studio/orchestration.js").OrchestrationRun | null;
 *   orchestrationBusy?: boolean;
 *   onApprovePlan?: () => void;
 *   onRejectPlan?: () => void;
 *   onRevisePlan?: (notes: string) => void;
 *   showOrchestrationFlowEntry?: boolean;
 *   onOpenOrchestrationFlow?: () => void;
 *   mentionAgents?: Array<{ label: string; glyph: string }>;
 *   collapseTracePanels?: boolean;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   locale: import("../i18n/messages.js").LocaleId;
 *   streamLocked: boolean;
 *   allowAssistantQuickReply: boolean;
 *   quickReplyDisabled: boolean;
 *   onQuickReply?: (text: string) => void | Promise<void>;
 *   animateUserEnter?: boolean;
 *   onUserEnterAnimEnd?: (messageId: string) => void;
 *   agentGlyph?: string;
 *   agentName?: string;
 *   onBeginUserEdit: (
 *     messageId: string,
 *     payload: {
 *       content: string;
 *       skillMeta?: { kind: "openclaw" | "user"; slug?: string; userSkillId?: string; label: string; emoji: string };
 *       followUpRef?: import("../chat/chatSessionsStore.js").MessageFollowUpRef;
 *     },
 *   ) => void;
 *   onFollowUpNavigate?: (ref: import("../chat/chatSessionsStore.js").MessageFollowUpRef) => void;
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
  onFollowUpNavigate,
  agentGlyph,
  agentName,
  mentionAgents = [],
  collapseTracePanels = false,
  orchestrationSidePanel = false,
  agents = [],
  orchestrationMode = false,
  orchestrationRun = null,
  orchestrationBusy = false,
  onApprovePlan,
  onRejectPlan,
  onRevisePlan,
  showOrchestrationFlowEntry = false,
  onOpenOrchestrationFlow,
}) {
  const isUser = message.role === "user";
  if (message.messageKind === "group_member_event") {
    return (
      <div className="chat-lab__msg chat-lab__msg--group-event" data-message-id={message.id} role="status">
        <p className="chat-lab__group-event-text">{message.content}</p>
      </div>
    );
  }
  if (message.messageKind === "orchestration_internal") return null;

  const orchTimelineActive = Boolean(orchestrationRun?.status);
  if (
    orchTimelineActive &&
    isOrchestrationTuckedMessage(message, { orchestrationRun, orchestrationMode })
  ) {
    return null;
  }

  const isOrchEvent = message.messageKind === "orchestration_event";
  const orchEventKey = typeof message.orchestrationEventKey === "string" ? message.orchestrationEventKey : "";
  if (isOrchEvent && orchTimelineActive) return null;
  const isOrchAnchor = message.messageKind === "orchestration_anchor";
  const isOrchPlan =
    !isOrchAnchor && message.messageKind === "orchestration_plan" && message.orchestrationPlan;
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
  const anchorActivityRows = isOrchAnchor && Array.isArray(message.activityLog) ? message.activityLog : [];
  const anchorStepRows = anchorActivityRows;
  const showTyping =
    !isUser &&
    message.streaming &&
    !message.content &&
    !message.thinking &&
    !message.error &&
    !interleavedAssistant &&
    !(isOrchAnchor && anchorActivityRows.length > 0);

  const interleavedTailBusy =
    interleavedAssistant && Boolean(message.streaming) && !message.error;

  const previewApi = useContext(ChatLabPreviewContext);

  const mdComponents = useMemo(
    () => createChatLabMarkdownComponents(t, { streaming: Boolean(message.streaming) }),
    [t, message.streaming],
  );

  const [thinkOpen, setThinkOpen] = useState(() => Boolean(message.streaming));

  useEffect(() => {
    if (message.streaming) setThinkOpen(true);
  }, [message.streaming]);

  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const activityRows = Array.isArray(message.activityLog) ? message.activityLog : [];

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
      const refs = Array.isArray(message.fileRefs) ? message.fileRefs : [];
      const parts = /** @type {string[]} */ ([]);
      if (base) parts.push(base);
      if (n > 0) parts.push(t("chatLab.messageImagesCopyNote", { count: n }));
      if (refs.length > 0) {
        parts.push(refs.map((r) => r.path).join("\n"));
      }
      if (parts.length) return parts.join("\n");
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
  }, [isUser, message.content, message.error, message.fileRefs, message.imageAttachments, message.thinking, t]);

  const [copiedPulse, setCopiedPulse] = useState(false);

  const fileRefs = Array.isArray(message.fileRefs) ? message.fileRefs : [];

  const handleOpenFileRef = useCallback(
    /** @param {{ path?: string; name?: string }} ref */
    (ref) => {
      const path = String(ref?.path ?? "").trim();
      if (!path || !previewApi?.openFromWorkspacePath) return;
      void previewApi.openFromWorkspacePath(path, ref?.name);
    },
    [previewApi],
  );

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
      ...(message.followUpRef ? { followUpRef: message.followUpRef } : {}),
      ...(Array.isArray(message.fileRefs) && message.fileRefs.length ? { fileRefs: message.fileRefs } : {}),
    });
  }, [message.content, message.fileRefs, message.followUpRef, message.id, message.skillMeta, onBeginUserEdit]);

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
        orchestrationSidePanel && "chat-lab__msg--orch-side",
        shouldEnterAnim && "chat-lab__msg--user-enter chat-lab__reveal-enter",
      )}
      data-message-id={message.id}
      data-message-role={message.role}
      {...(typeof message.agentId === "string" && message.agentId
        ? { "data-message-agent-id": message.agentId }
        : {})}
      onAnimationEnd={shouldEnterAnim ? handleUserEnterAnimEnd : undefined}
    >
      {isUser && (message.followUpRef || message.skillMeta) ?
        <div className="chat-lab__msg-meta-tags">
          {message.followUpRef && onFollowUpNavigate ?
            <MessageFollowUpTag
              followUpRef={message.followUpRef}
              onNavigate={() => onFollowUpNavigate(message.followUpRef)}
            />
          : null}
          {message.skillMeta ?
            <div className="chat-lab__msg-skill-pill" title={`${message.skillMeta.emoji} ${message.skillMeta.label}`}>
              <span className="chat-lab__msg-skill-emoji" aria-hidden>
                {message.skillMeta.emoji}
              </span>
              <span className="chat-lab__msg-skill-label">{message.skillMeta.label}</span>
            </div>
          : null}
        </div>
      : null}
      {!isUser && agentName && !orchestrationSidePanel ? (
        <div className="chat-lab__msg-agent-head">
          {agentGlyph ? (
            <span className="chat-lab__msg-agent-avatar" aria-hidden>
              {agentGlyph}
            </span>
          ) : null}
          <span className="chat-lab__msg-agent-name">{agentName}</span>
        </div>
      ) : null}
      <article
        className={cn(
          "chat-lab__bubble",
          isUser && "chat-lab__bubble--user",
          orchestrationSidePanel && "chat-lab__bubble--orch-side",
          shouldEnterAnim && "chat-lab__reveal-blur-host",
        )}
        data-role={message.role}
      >
        {shouldEnterAnim ? <span className="chat-lab__reveal-blur-veil" aria-hidden /> : null}
        {isOrchAnchor && anchorStepRows.length > 0 ? (
          <ActivityChainPanel
            rows={anchorStepRows}
            t={t}
            streaming={Boolean(message.streaming)}
            keepCollapsed={false}
            orchestrationMode
            mdComponents={mdComponents}
          />
        ) : null}
        {isOrchAnchor && message.streaming ? (
          <div className="chat-lab__orch-streaming-tail">
            <ChatStreamingIndicator label={t("chatLab.streaming")} />
          </div>
        ) : null}
        {isOrchAnchor && message.error ? (
          <div className="mt-1 text-[0.78rem]" style={{ color: "#d84b4b" }}>
            {message.error}
          </div>
        ) : null}
        {!isOrchPlan &&
        !isOrchAnchor &&
        !isUser &&
        !isOrchEvent &&
        !interleavedAssistant &&
        toolRows.length > 0 ? (
          <ToolChainPanel
            rows={toolRows}
            t={t}
            streaming={Boolean(message.streaming)}
            keepCollapsed={collapseTracePanels}
          />
        ) : null}
        {!isOrchPlan &&
        !isOrchAnchor &&
        !isUser &&
        !isOrchEvent &&
        !interleavedAssistant &&
        activityRows.length > 0 ? (
          <ActivityChainPanel
            rows={activityRows}
            t={t}
            streaming={Boolean(message.streaming)}
            keepCollapsed={collapseTracePanels}
          />
        ) : null}
        {!isOrchPlan && !isUser && !interleavedAssistant && message.thinking ? (
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
        {isOrchPlan || (isOrchAnchor && !message.content) || (isOrchEvent && isOrchestrationStepOnlyEvent(orchEventKey))
          ? null
          : isUser ? (
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
              keepTraceCollapsed={collapseTracePanels}
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
              <ChatLabMarkdownContent source={String(message.content ?? "")} components={mdComponents} />
            ) : showTyping ? (
              <ChatStreamingIndicator label={t("chatLab.streaming")} />
            ) : !message.thinking &&
              !message.error &&
              toolRows.length === 0 &&
              activityRows.length === 0 &&
              !fileRefs.length ? (
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
      {mentionAgents.length > 0 ? (
        <div
          className={cn(
            "chat-lab__msg-mentions",
            !isUser && "chat-lab__msg-mentions--assistant",
          )}
          aria-label={t("chatLab.messageMentionsAria")}
        >
          {mentionAgents.map((a) => (
            <span key={a.label} className="chat-lab__msg-mention-pill">
              <span className="chat-lab__msg-mention-glyph" aria-hidden>
                {a.glyph}
              </span>
              <span className="chat-lab__msg-mention-label">@{a.label}</span>
            </span>
          ))}
        </div>
      ) : null}
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
          <div
            className={cn("chat-lab__msg-actions", fileRefs.length > 0 && "chat-lab__msg-actions--with-files")}
            aria-label={fileRefs.length > 0 ? t("chatLab.messageFileRefsLabel") : undefined}
          >
            <button
              type="button"
              className={cn("chat-lab__msg-action-btn", copiedPulse && "chat-lab__msg-action-btn--copied")}
              onClick={handleCopy}
              disabled={!copyPlain.trim()}
              title={copiedPulse ? t("chatLab.messageCopied") : t("chatLab.messageCopy")}
              aria-label={copiedPulse ? t("chatLab.messageCopied") : t("chatLab.messageCopy")}
            >
              {copiedPulse ? <MessageMetaCopiedIcon /> : <MessageMetaCopyIcon />}
            </button>
            {!isUser && showOrchestrationFlowEntry && onOpenOrchestrationFlow ? (
              <button
                type="button"
                className="chat-lab__msg-action-btn chat-lab__msg-action-btn--flow"
                onClick={onOpenOrchestrationFlow}
                title={t("orchestration.dock.viewFlow")}
                aria-label={t("orchestration.dock.viewFlow")}
              >
                {t("orchestration.dock.title")}
              </button>
            ) : null}
            {fileRefs.map((ref, idx) => (
              <button
                key={`${message.id}-fref-${idx}`}
                type="button"
                className="chat-lab__msg-file-ref"
                onClick={() => handleOpenFileRef(ref)}
                title={`${t("chatLab.messageFileRefOpen")}\n${ref.path}`}
                aria-label={t("chatLab.messageFileRefOpenNamed", { name: ref.name })}
              >
                <span className="chat-lab__msg-file-ref-emoji" aria-hidden>
                  {emojiForFileRefKind(ref.kind === "directory" ? "directory" : "file")}
                </span>
                <span className="chat-lab__msg-file-ref-label">{ref.name}</span>
              </button>
            ))}
            {isUser ? (
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
            ) : null}
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
 * Worker output inside orchestration preview dock — identical to main chat MessageBubble.
 * @param {{
 *   message: Record<string, unknown> & {
 *     id: string;
 *     role: "user" | "assistant";
 *     content?: string;
 *     thinking?: string;
 *     streaming?: boolean;
 *     error?: string;
 *     agentId?: string;
 *     toolTrace?: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *     activityLog?: import("../chat/toolTraceMerge.js").ActivityRow[];
 *     assistantTimeline?: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *   };
 *   agentById: Map<string, import("../studio/agents.js").LobsterAgent>;
 *   mainAgentLabel: string;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   locale: import("../i18n/messages.js").LocaleId;
 *   streamLocked: boolean;
 *   orchestrationBusy?: boolean;
 * }} props
 */
function OrchestrationWorkerMessageBubble({
  message,
  agentById,
  mainAgentLabel,
  t,
  locale,
  streamLocked,
  orchestrationBusy = false,
}) {
  const agent = message.agentId ? agentById.get(message.agentId) : undefined;
  return (
    <MessageBubble
      message={message}
      t={t}
      locale={locale}
      streamLocked={streamLocked}
      allowAssistantQuickReply={false}
      quickReplyDisabled
      onBeginUserEdit={() => {}}
      agentGlyph={agent ? agentAvatarGlyph(agent) : undefined}
      agentName={agent ? agentDisplayLabel(agent) : undefined}
      mentionAgents={mentionAgentsForMessage(message, agentById, mainAgentLabel)}
      collapseTracePanels={false}
      orchestrationSidePanel
      orchestrationMode={false}
      orchestrationRun={null}
      orchestrationBusy={orchestrationBusy}
    />
  );
}

/**
 * @param {{
 *   content?: string;
 *   thinking?: string;
 *   streaming?: boolean;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }} m
 */
function estimateAssistantRowHeight(m) {
  let h = 132;
  const contentLen = String(m?.content ?? "").length;
  const thinkingLen = String(m?.thinking ?? "").length;
  h += Math.min(3600, Math.ceil(contentLen / 2.6));
  h += Math.min(720, Math.ceil(thinkingLen / 3));
  const tools = Array.isArray(m?.toolTrace) ? m.toolTrace.length : 0;
  const activities = Array.isArray(m?.activityLog) ? m.activityLog.length : 0;
  const timeline = Array.isArray(m?.assistantTimeline) ? m.assistantTimeline.length : 0;
  h += tools * 40 + activities * 32 + timeline * 28;
  if (m?.streaming) h += 56;
  return Math.max(228, Math.min(h, 5200));
}

/**
 * @param {Array<{
 *   id: string;
 *   role: string;
 *   content?: string;
 *   thinking?: string;
 *   streaming?: boolean;
 *   toolTrace?: unknown[];
 *   activityLog?: unknown[];
 *   assistantTimeline?: unknown[];
 * }>} messages
 */
/** @param {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[] | undefined} timeline */
function timelineContentDigest(timeline) {
  if (!Array.isArray(timeline)) return "";
  return timeline
    .map((seg) => {
      if (seg.kind === "text" || seg.kind === "thinking") return String(seg.body ?? "").length;
      if (seg.kind === "tool" || seg.kind === "activity") return String(seg.refId ?? "");
      return "";
    })
    .join(",");
}

/** @param {import("../chat/toolTraceMerge.js").ToolTraceRow[] | undefined} toolTrace */
function toolTraceContentDigest(toolTrace) {
  if (!Array.isArray(toolTrace)) return "";
  return toolTrace
    .map((row) =>
      ["result", "partialResult", "summary", "label"]
        .map((k) => String(row[k] ?? "").length)
        .join("."),
    )
    .join(",");
}

function buildMessagesMeasureDigest(messages) {
  return messages
    .map((m) =>
      [
        m.id,
        m.role,
        String(m.content ?? "").length,
        String(m.thinking ?? "").length,
        m.streaming ? 1 : 0,
        Array.isArray(m.toolTrace) ? m.toolTrace.length : 0,
        toolTraceContentDigest(m.toolTrace),
        Array.isArray(m.activityLog) ? m.activityLog.length : 0,
        Array.isArray(m.assistantTimeline) ? m.assistantTimeline.length : 0,
        timelineContentDigest(m.assistantTimeline),
      ].join(":"),
    )
    .join("|");
}

function buildGatewaySlicesDigest(slices) {
  if (!Array.isArray(slices) || !slices.length) return "";
  return slices
    .map((s) =>
      [
        s.assistantMessageId,
        String(s.content ?? "").length,
        String(s.thinking ?? "").length,
        timelineContentDigest(s.assistantTimeline),
        s.active ? 1 : 0,
      ].join(":"),
    )
    .join("|");
}

/** @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} activityLog */
function buildOrchestrationActivityDigest(activityLog) {
  if (!Array.isArray(activityLog) || !activityLog.length) return "";
  return activityLog
    .map((r) =>
      [
        r.id,
        String(r.text ?? "").length,
        r.phase ?? "",
        Array.isArray(r.toolTrace) ? r.toolTrace.length : 0,
        toolTraceContentDigest(r.toolTrace),
        timelineContentDigest(r.assistantTimeline),
        r.workerStreaming ? 1 : 0,
      ].join(":"),
    )
    .join("|");
}

/**
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} activityLog
 */
function buildOrchestrationActiveWorkerCount(activityLog) {
  if (!Array.isArray(activityLog) || !activityLog.length) return 0;
  const activeKeys = new Set(["task_start", "pre_task_running", "review_rework"]);
  const doneKeys = new Set(["task_done", "pre_task_done", "review_passed", "review_blocked"]);
  const open = new Set();
  for (const row of activityLog) {
    if (!row || typeof row !== "object") continue;
    const key = String(row.orchestrationEventKey ?? "").trim();
    const workerId = String(row.orchestrationWorkerId ?? "").trim();
    if (!key || !workerId) continue;
    if (activeKeys.has(key)) open.add(workerId);
    if (doneKeys.has(key)) open.delete(workerId);
  }
  return open.size;
}

/**
 * @param {{ mentions?: string[]; content?: string; role?: string; agentId?: string }} message
 * @param {Map<string, import("../studio/agents.js").LobsterAgent>} agentById
 * @param {string} mainAgentLabel
 * @param {{ everyoneLabel?: string; mainAgent?: import("../studio/agents.js").LobsterAgent | null; participantIds?: string[] }} [opts]
 */
function mentionAgentsForMessage(message, agentById, mainAgentLabel, opts = {}) {
  let ids = Array.isArray(message.mentions) ? message.mentions : [];
  const content = typeof message.content === "string" ? message.content : "";
  if (!ids.length && content.includes("@")) {
    const pool = [...agentById.values()];
    const parseOpts = {
      mainAgent: opts.mainAgent ?? null,
      participantIds: opts.participantIds ?? [],
      mainFallback: mainAgentLabel,
      everyoneLabel: opts.everyoneLabel,
    };
    if (message.role === "user") {
      ids = parseAgentMentions(content, pool, parseOpts).mentionIds;
    } else if (message.role === "assistant" && message.agentId) {
      ids = parseAgentDelegateMention(content, pool, {
        ...parseOpts,
        speakerAgentId: message.agentId,
      }).mentionIds;
    }
  }
  if (!ids.length) return [];
  const agents = [...agentById.values()];
  const everyoneIds = mentionEveryoneAgents(agents, {
    mainAgent: opts.mainAgent ?? null,
    participantIds: opts.participantIds ?? [],
  }).map((a) => a.id);
  if (isEveryoneMention(ids, everyoneIds)) {
    return [{ label: opts.everyoneLabel || "所有人", glyph: "👥" }];
  }
  return ids
    .map((id) => agentById.get(id))
    .filter(Boolean)
    .map((a) => ({
      label: agentMentionLabel(a, mainAgentLabel),
      glyph: agentAvatarGlyph(a),
    }));
}

/** @typedef {Parameters<typeof ChatLabVirtualMessageList>[0]} ChatLabMessageListProps */

/**
 * @param {ChatLabMessageListProps} props
 */
function ChatLabMessageList(props) {
  const orchActive = Boolean(props.orchestrationRun?.status);
  const orchSource = props.orchestrationUiMessages ?? props.messages;
  const orchMessages = hasOrchestrationTimelineMessages(orchSource, props.mainAgent?.id ?? null);
  // Orchestration tucking + anchor bubble require the plain list (virtual rows skip it).
  if (
    props.orchestrationMode ||
    orchActive ||
    orchMessages ||
    props.messages.length <= CHAT_LAB_PLAIN_MESSAGE_MAX
  ) {
    return <ChatLabPlainMessageList {...props} />;
  }
  return <ChatLabVirtualMessageList {...props} />;
}

/**
 * Direct flex column for short threads — no absolute virtual rows (overlap-safe).
 * @param {ChatLabMessageListProps} props
 */
function ChatLabPlainMessageList({
  conversationId,
  messages,
  sessionArtifacts,
  agentById,
  agents = [],
  messagesScrollRef,
  autoScrollRef,
  threadScrollApiRef,
  gatewayStreaming,
  gatewayStreamSlices = [],
  streamLocked,
  userBubbleEnterMessageId,
  onUserBubbleEnterAnimEnd,
  onBeginUserEdit,
  onFollowUpNavigate,
  onQuickReply,
  quickReplyDisabled,
  t,
  locale,
  threadLabel,
  mainAgentLabel,
  mentionEveryoneLabel,
  mainAgent,
  participantIds,
  collapseTracePanels = false,
  orchestrationMode = false,
  orchestrationUiMessages,
  orchestrationRun = null,
  orchestrationBusy = false,
  onApprovePlan,
  onRejectPlan,
  onRevisePlan,
  onOpenOrchestrationFlow,
}) {
  const orchSource = orchestrationUiMessages ?? messages;
  const gatewaySlicesDigest = useMemo(
    () => buildGatewaySlicesDigest(gatewayStreamSlices),
    [gatewayStreamSlices],
  );
  const mentionDisplayOpts = useMemo(
    () => ({ everyoneLabel: mentionEveryoneLabel, mainAgent, participantIds }),
    [mentionEveryoneLabel, mainAgent, participantIds],
  );
  const messagesMeasureDigest = useMemo(() => buildMessagesMeasureDigest(messages), [messages]);
  const showOrchestrationTimeline = Boolean(orchestrationRun?.status);
  const tuckCtx = useMemo(
    () => ({ orchestrationRun, mainAgentId: mainAgent?.id ?? null, orchestrationMode }),
    [orchestrationRun, mainAgent?.id, orchestrationMode],
  );
  const tuckedMessageIds = useMemo(() => {
    if (!showOrchestrationTimeline) return new Set();
    return new Set(orchSource.filter((m) => isOrchestrationTuckedMessage(m, tuckCtx)).map((m) => m.id));
  }, [orchSource, showOrchestrationTimeline, tuckCtx]);

  const orchestrationAnchorMessage = useMemo(() => {
    if (!showOrchestrationTimeline || !orchestrationRun || !mainAgent) return null;
    const agentLabels = new Map(
      agents.map((a) => [a.id, agentDisplayLabel(a)]),
    );
    return buildOrchestrationAnchorMessage(orchSource, orchestrationRun, mainAgent, {
      streaming: orchestrationBusy,
      t,
      agentLabels,
      liveSlices: gatewayStreamSlices,
    });
  }, [
    showOrchestrationTimeline,
    orchestrationRun,
    orchestrationRun?.activeTaskIds,
    orchestrationRun?.updatedAt,
    orchestrationRun?.plan,
    mainAgent,
    orchSource,
    orchestrationBusy,
    agents,
    t,
    gatewaySlicesDigest,
    gatewayStreamSlices,
  ]);
  const orchestrationActivityDigest = useMemo(
    () => buildOrchestrationActivityDigest(orchestrationAnchorMessage?.activityLog),
    [orchestrationAnchorMessage],
  );
  const scrollPinKey = messages.length
    ? `${conversationId}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}:${gatewayStreaming ? 1 : 0}:${orchestrationBusy ? 1 : 0}:${orchestrationActivityDigest}`
    : "";

  const handleScroll = useCallback(() => {
    syncChatAutoScrollFromEl(messagesScrollRef.current, autoScrollRef);
  }, [messagesScrollRef, autoScrollRef]);

  const onUserScrollIntent = useCallback(() => {
    autoScrollRef.current = false;
  }, [autoScrollRef]);

  const pinScrollRafRef = useRef(/** @type {number | null} */ (null));
  const pinScrollToBottom = useCallback(() => {
    if (messages.length === 0) return;
    if (orchestrationBusy) autoScrollRef.current = true;
    schedulePinChatScroll(messagesScrollRef.current, autoScrollRef, pinScrollRafRef);
  }, [autoScrollRef, messages.length, messagesScrollRef, orchestrationBusy]);

  useLayoutEffect(() => {
    if (!conversationId || messages.length === 0) return;
    autoScrollRef.current = true;
    forcePinChatScroll(messagesScrollRef.current);
  }, [autoScrollRef, conversationId, messages.length, messagesScrollRef]);

  useEffect(() => {
    if (orchestrationBusy) autoScrollRef.current = true;
  }, [orchestrationBusy, orchestrationActivityDigest, autoScrollRef]);

  useLayoutEffect(() => {
    if (!orchestrationBusy || messages.length === 0) return;
    autoScrollRef.current = true;
    const el = messagesScrollRef.current;
    if (!el) return;
    const pin = () => {
      if (!autoScrollRef.current) return;
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(pin) : null;
    for (const child of el.children) ro?.observe(child);
    return () => ro?.disconnect();
  }, [orchestrationBusy, orchestrationActivityDigest, messages.length, autoScrollRef, messagesScrollRef]);

  useLayoutEffect(() => {
    pinScrollToBottom();
  }, [scrollPinKey, pinScrollToBottom]);

  useLayoutEffect(() => {
    pinScrollToBottom();
  }, [messagesMeasureDigest, pinScrollToBottom]);

  useEffect(
    () => () => {
      if (pinScrollRafRef.current != null) cancelAnimationFrame(pinScrollRafRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!threadScrollApiRef) return undefined;
    threadScrollApiRef.current = {
      mode: "plain",
      messageCount: messages.length,
      scrollToIndex: (index, opts) => {
        const msg = messages[index];
        if (!msg) return;
        scrollThreadToMessage({
          messageId: String(msg.id ?? ""),
          messageIndex: index,
          scrollContainer: messagesScrollRef.current,
          scrollApi: null,
        });
      },
      pinToBottom: () => {
        autoScrollRef.current = true;
        forcePinChatScroll(messagesScrollRef.current);
      },
      scrollToBottom: ({ animated = true } = {}) => {
        autoScrollRef.current = true;
        const el = messagesScrollRef.current;
        if (!el) return;
        if (animated) {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          return;
        }
        forcePinChatScroll(el);
      },
      getActiveUserMessageId: () => findActiveUserMessageId(messages, messagesScrollRef.current),
    };
    return () => {
      if (threadScrollApiRef.current?.mode === "plain") {
        threadScrollApiRef.current = null;
      }
    };
  }, [messages, messagesScrollRef, threadScrollApiRef]);

  let orchestrationAnchorRendered = false;

  return (
    <div
      className="chat-lab__messages"
      ref={messagesScrollRef}
      onScroll={handleScroll}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest("a,button,input,textarea,select,[role='button'],[contenteditable='true']")) return;
        onUserScrollIntent();
      }}
      onTouchStart={onUserScrollIntent}
      onWheel={(e) => {
        if (e.deltaY < 0) onUserScrollIntent();
      }}
      role="log"
      aria-live="polite"
      aria-label={threadLabel}
    >
      {messages.map((m, index) => {
        if (tuckedMessageIds.has(m.id)) {
          if (!orchestrationAnchorRendered && orchestrationAnchorMessage) {
            orchestrationAnchorRendered = true;
            const anchorAgent = mainAgent;
            return (
              <MessageBubble
                key={orchestrationAnchorMessage.id}
                message={orchestrationAnchorMessage}
                t={t}
                locale={locale}
                streamLocked={streamLocked}
                animateUserEnter={false}
                onUserEnterAnimEnd={onUserBubbleEnterAnimEnd}
                allowAssistantQuickReply={false}
                quickReplyDisabled={quickReplyDisabled}
                onQuickReply={onQuickReply}
                onBeginUserEdit={onBeginUserEdit}
                onFollowUpNavigate={onFollowUpNavigate}
                agentGlyph={anchorAgent ? agentAvatarGlyph(anchorAgent) : undefined}
                agentName={anchorAgent ? agentDisplayLabel(anchorAgent) : undefined}
                mentionAgents={[]}
                collapseTracePanels={false}
                orchestrationMode={orchestrationMode}
                orchestrationRun={orchestrationRun}
                orchestrationBusy={orchestrationBusy}
                onApprovePlan={onApprovePlan}
                onRejectPlan={onRejectPlan}
                onRevisePlan={onRevisePlan}
                agents={agents}
                showOrchestrationFlowEntry={Boolean(
                  orchestrationMode &&
                    (orchestrationRun?.status === "completed" || orchestrationRun?.status === "failed"),
                )}
                onOpenOrchestrationFlow={onOpenOrchestrationFlow}
              />
            );
          }
          return null;
        }
        const agent = m.agentId ? agentById.get(m.agentId) : null;
        return (
          <MessageBubble
            key={m.id}
            message={m}
            t={t}
            locale={locale}
            streamLocked={streamLocked}
            animateUserEnter={m.role === "user" && m.id === userBubbleEnterMessageId}
            onUserEnterAnimEnd={onUserBubbleEnterAnimEnd}
            allowAssistantQuickReply={index === messages.length - 1 && m.role === "assistant"}
            quickReplyDisabled={quickReplyDisabled}
            onQuickReply={onQuickReply}
            onBeginUserEdit={onBeginUserEdit}
            onFollowUpNavigate={onFollowUpNavigate}
            agentGlyph={agent ? agentAvatarGlyph(agent) : undefined}
            agentName={agent ? agentDisplayLabel(agent) : undefined}
            mentionAgents={mentionAgentsForMessage(m, agentById, mainAgentLabel, mentionDisplayOpts)}
            collapseTracePanels={collapseTracePanels}
            orchestrationMode={orchestrationMode}
            orchestrationRun={orchestrationRun}
            orchestrationBusy={orchestrationBusy}
            onApprovePlan={onApprovePlan}
            onRejectPlan={onRejectPlan}
            onRevisePlan={onRevisePlan}
            agents={agents}
            showOrchestrationFlowEntry={Boolean(
              orchestrationMode &&
                (orchestrationRun?.status === "completed" || orchestrationRun?.status === "failed"),
            )}
            onOpenOrchestrationFlow={onOpenOrchestrationFlow}
          />
        );
      })}
      {showOrchestrationTimeline && !orchestrationAnchorRendered && orchestrationAnchorMessage ? (
        <MessageBubble
          key={`${orchestrationAnchorMessage.id}-tail`}
          message={orchestrationAnchorMessage}
          t={t}
          locale={locale}
          streamLocked={streamLocked}
          animateUserEnter={false}
          onUserEnterAnimEnd={onUserBubbleEnterAnimEnd}
          allowAssistantQuickReply={false}
          quickReplyDisabled={quickReplyDisabled}
          onQuickReply={onQuickReply}
          onBeginUserEdit={onBeginUserEdit}
          onFollowUpNavigate={onFollowUpNavigate}
          agentGlyph={mainAgent ? agentAvatarGlyph(mainAgent) : undefined}
          agentName={mainAgent ? agentDisplayLabel(mainAgent) : undefined}
          mentionAgents={[]}
          collapseTracePanels={false}
          orchestrationMode={orchestrationMode}
          orchestrationRun={orchestrationRun}
          orchestrationBusy={orchestrationBusy}
          onApprovePlan={onApprovePlan}
          onRejectPlan={onRejectPlan}
          onRevisePlan={onRevisePlan}
          agents={agents}
          showOrchestrationFlowEntry={Boolean(
            orchestrationMode &&
              (orchestrationRun?.status === "completed" || orchestrationRun?.status === "failed"),
          )}
          onOpenOrchestrationFlow={onOpenOrchestrationFlow}
        />
      ) : null}
      {sessionArtifacts?.length && !gatewayStreaming && !orchestrationBusy ? (
        <ChatLabArtifactsBar artifacts={sessionArtifacts} />
      ) : null}
    </div>
  );
}

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
 *     mentions?: string[];
 *   }>;
 *   mainAgentLabel: string;
 *   mentionEveryoneLabel: string;
 *   mainAgent: import("../studio/agents.js").LobsterAgent | null;
 *   participantIds: string[];
 *   collapseTracePanels?: boolean;
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
 *   remeasureKey?: string;
 * }} props
 */
function ChatLabVirtualMessageList({
  conversationId,
  messages,
  sessionArtifacts,
  agentById,
  agents = [],
  messagesScrollRef,
  autoScrollRef,
  threadScrollApiRef,
  gatewayStreaming,
  streamLocked,
  userBubbleEnterMessageId,
  onUserBubbleEnterAnimEnd,
  onBeginUserEdit,
  onFollowUpNavigate,
  onQuickReply,
  quickReplyDisabled,
  remeasureKey,
  t,
  locale,
  threadLabel,
  mainAgentLabel,
  mentionEveryoneLabel,
  mainAgent,
  participantIds,
  collapseTracePanels = false,
  orchestrationMode = false,
  orchestrationRun = null,
  orchestrationBusy = false,
  onApprovePlan,
  onRejectPlan,
  onRevisePlan,
}) {
  const mentionDisplayOpts = useMemo(
    () => ({ everyoneLabel: mentionEveryoneLabel, mainAgent, participantIds }),
    [mentionEveryoneLabel, mainAgent, participantIds],
  );
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
      let h = m.skillMeta || m.followUpRef ? 118 : 96;
      const textLen = String(m.content ?? "").length;
      h += Math.min(480, Math.ceil(textLen / 3.2));
      const n = Array.isArray(m.imageAttachments) ? m.imageAttachments.length : 0;
      if (n > 0) h += 56 + Math.min(n, 8) * 56;
      const mentionN = Array.isArray(m.mentions) ? m.mentions.length : 0;
      if (mentionN > 0) h += 30 + Math.min(mentionN - 1, 3) * 8;
      return h;
    }
    return estimateAssistantRowHeight(m);
  }, []);

  const messagesMeasureDigest = useMemo(() => buildMessagesMeasureDigest(messages), [messages]);
  const prevGatewayStreamingRef = useRef(gatewayStreaming);

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

  const onUserScrollIntent = useCallback(() => {
    autoScrollRef.current = false;
  }, [autoScrollRef]);

  const handleScroll = useCallback(() => {
    syncChatAutoScrollFromEl(messagesScrollRef.current, autoScrollRef);
    syncScrollbarMetrics();
    setScrollbarVisible(true);
    scheduleScrollbarHide();
  }, [messagesScrollRef, autoScrollRef, scheduleScrollbarHide, syncScrollbarMetrics]);

  const scrollPinKey = messages.length
    ? `${conversationId}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}:${gatewayStreaming ? 1 : 0}`
    : "";

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

  const pinVirtualToBottom = useCallback(() => {
    if (!autoScrollRef.current || messages.length === 0) return;
    vInstRef.current.measure();
    vInstRef.current.scrollToIndex(messages.length - 1, { align: "end", behavior: "instant" });
  }, [autoScrollRef, messages.length]);

  const forcePinVirtualToBottom = useCallback(() => {
    if (messages.length === 0) return;
    const run = () => {
      vInstRef.current.measure();
      vInstRef.current.scrollToIndex(messages.length - 1, { align: "end", behavior: "instant" });
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
  }, [messages.length]);

  useLayoutEffect(() => {
    if (!conversationId || messages.length === 0) return;
    autoScrollRef.current = true;
    forcePinVirtualToBottom();
  }, [autoScrollRef, conversationId, forcePinVirtualToBottom, messages.length]);

  /** Pin when a new turn starts — not on every streaming token (messages reference churn). */
  useLayoutEffect(() => {
    pinVirtualToBottom();
  }, [scrollPinKey, pinVirtualToBottom]);

  /** Follow streaming growth only while the reader is already at the bottom. */
  useLayoutEffect(() => {
    pinVirtualToBottom();
  }, [messagesMeasureDigest, pinVirtualToBottom]);

  /** User-bubble enter anim + streaming row growth need a remeasure or the first turn can clip. */
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    vInstRef.current.measure();
  }, [messages.length, userBubbleEnterMessageId, gatewayStreaming]);

  /** Content/tool growth during streaming and collapse after `streaming:false` must refresh row offsets. */
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    vInstRef.current.measure();
  }, [messagesMeasureDigest]);

  useLayoutEffect(() => {
    const prev = prevGatewayStreamingRef.current;
    prevGatewayStreamingRef.current = gatewayStreaming;
    if (!prev || gatewayStreaming) return;
    vInstRef.current.measure();
    const raf = requestAnimationFrame(() => {
      vInstRef.current.measure();
      if (autoScrollRef.current && messages.length > 0) {
        vInstRef.current.scrollToIndex(messages.length - 1, { align: "end", behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [gatewayStreaming, messages.length, autoScrollRef]);

  useLayoutEffect(() => {
    if (!remeasureKey || messages.length === 0) return;
    vInstRef.current.measure();
  }, [remeasureKey, messages.length]);

  useEffect(() => {
    const remeasure = () => {
      if (messagesEstRef.current.length === 0) return;
      vInstRef.current.measure();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") remeasure();
    };
    window.addEventListener("focus", remeasure);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", remeasure);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useLayoutEffect(() => {
    if (!threadScrollApiRef) return undefined;
    threadScrollApiRef.current = {
      mode: "virtual",
      messageCount: messages.length,
      scrollToIndex: (index, opts) => {
        vInstRef.current.scrollToIndex(index, {
          align: opts?.align ?? "start",
          behavior: opts?.behavior ?? "smooth",
        });
      },
      pinToBottom: () => {
        autoScrollRef.current = true;
        forcePinVirtualToBottom();
      },
      scrollToBottom: ({ animated = true } = {}) => {
        autoScrollRef.current = true;
        if (messages.length === 0) return;
        const el = messagesScrollRef.current;
        vInstRef.current.measure();
        if (!animated || !el) {
          forcePinVirtualToBottom();
          return;
        }
        vInstRef.current.scrollToIndex(messages.length - 1, { align: "end", behavior: "instant" });
        requestAnimationFrame(() => {
          const target = Math.max(0, el.scrollHeight - el.clientHeight);
          animateScrollTop(el, target);
        });
      },
      getActiveUserMessageId: () =>
        findActiveUserMessageIdVirtual(messages, messagesScrollRef.current, vInstRef.current),
    };
    return () => {
      if (threadScrollApiRef.current?.mode === "virtual") {
        threadScrollApiRef.current = null;
      }
    };
  }, [messages, messagesScrollRef, threadScrollApiRef]);

  return (
    <>
      <div
        className="chat-lab__messages chat-lab__messages--virtual"
        ref={messagesScrollRef}
        onScroll={handleScroll}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const target = /** @type {HTMLElement} */ (e.target);
          if (target.closest("a,button,input,textarea,select,[role='button'],[contenteditable='true']")) return;
          onUserScrollIntent();
        }}
        onTouchStart={onUserScrollIntent}
        onWheel={(e) => {
          if (e.deltaY < 0) onUserScrollIntent();
        }}
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
                  onFollowUpNavigate={onFollowUpNavigate}
                  agentGlyph={
                    m.agentId && agentById?.has(m.agentId)
                      ? agentAvatarGlyph(agentById.get(m.agentId))
                      : undefined
                  }
                  agentName={
                    m.agentId && agentById?.has(m.agentId)
                      ? agentDisplayLabel(agentById.get(m.agentId))
                      : undefined
                  }
                  mentionAgents={mentionAgentsForMessage(m, agentById, mainAgentLabel, mentionDisplayOpts)}
                  collapseTracePanels={collapseTracePanels}
                  orchestrationMode={orchestrationMode}
                  orchestrationRun={orchestrationRun}
                  orchestrationBusy={orchestrationBusy}
                  onApprovePlan={onApprovePlan}
                  onRejectPlan={onRejectPlan}
                  onRevisePlan={onRevisePlan}
                  agents={agents}
                />
              </div>
            );
          })}
        </div>
        {sessionArtifacts?.length && !gatewayStreaming && !orchestrationBusy ? (
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
