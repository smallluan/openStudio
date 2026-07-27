import { memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import { Radio, RadioGroup, Select as TSelect } from "tdesign-react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Send, Cpu, GitBranch, Timer } from "lucide-react";
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
import { getContextWindowSize, formatContextWindow } from "../chat/modelContextWindow.js";
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
  areSubagentCardsSettled,
  coalesceSubagentActivityRows,
  deriveSubagentRowsFromToolTrace,
  extractLifecycleErrorFromActivityLog,
  isSessionsSpawnToolName,
  pickSubagentProgressLine,
  shortSubagentTitle,
  toolTraceAwaitsSubagent,
} from "../chat/toolTraceMerge.js";
import {
  coalesceImageOnlyTextParts,
} from "../chat/chatLabMarkdownImageGrid.js";
import {
  agentSessionKeysForConversation,
  buildGatewayPayloadRows,
  buildWorkflowHandoffGatewayPriorRows,
  computeThreadSummary,
  filterMessagesForGatewayContext,
  recordAgentGatewaySync,
  resetThreadGatewaySync,
  resolveAgentGatewayContext,
} from "../chat/gatewayContext.js";
import {
  CHAT_SESSION_CHANNEL_WECHAT,
  deriveTitleFromMessages,
  getSession,
  isAutomationTaskSessionRecord,
  loadAllSessions,
  renameSession,
  updateSessionParticipants,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import {
  advanceWorkflowAndCollectHandoffs,
  advanceWorkflowRuntimeByMessages,
  buildWorkflowUserTurnContext,
  getWorkflowById,
  isWorkflowRuntimeExecutionComplete,
  listWorkflowDocuments,
  listWorkflowsForPicker,
  resolveWorkflowAgents,
  resolveWorkflowOrchestrationPlan,
  resolveWorkflowParticipantIds,
  sanitizeWorkflowSessionState,
  workflowPlanRequiresSubagents,
} from "../workflow/workflowRuntimeRegistry.js";
import { resolveWorkflowLiveExecution } from "../workflow/workflowLiveExecution.js";
import { buildGroupMemberChangeEvents } from "../chat/chatLabGroupMemberEvents.js";
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
import {
  isSidebarAutomationCarrierContent,
  isSidebarAutomationCarrierMessage,
  isSidebarAutomationInternalUserMessage,
  stripSidebarActionFences,
  stripSidebarActionFencesFromTimeline,
} from "../chat/chatLabSidebarActionProtocol.js";
import {
  composeChatLabSystemPrompt,
  composeChatLabStudioSuffix,
  composeWebExploreUserTurnAutomationHint,
  fetchChatLabWorkspaceContextBlock,
} from "../chat/chatLabSystemPrompt.js";
import {
  captureSidebarPreviewSnapshot,
  composeChatLabPreviewContextBlock,
} from "../chat/chatLabPreviewSnapshot.js";
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
import ChatLabComposerStack from "../components/chat-lab/ChatLabComposerStack.jsx";
import ChatLabSessionScopeReset from "../components/chat-lab/ChatLabSessionScopeReset.jsx";
import ChatLabWorkspaceActiveRootBridge from "../components/chat-lab/ChatLabWorkspaceActiveRootBridge.jsx";
import ChatLabPreviewContextBridge from "../components/chat-lab/ChatLabPreviewContextBridge.jsx";
import ChatLabSidebarActionRunner from "../components/chat-lab/ChatLabSidebarActionRunner.jsx";
import { ChatLabWorkspaceProvider } from "../context/ChatLabWorkspaceContext.jsx";
import ChatLabRawTraceFloatPanel from "../components/chat-lab/ChatLabRawTraceFloatPanel.jsx";
import ChatLabWorkflowRuntimeFloatPanel from "../components/chat-lab/ChatLabWorkflowRuntimeFloatPanel.jsx";
import {
  ChatLabPreviewContext,
  ChatLabPreviewProvider,
  useChatLabPreview,
} from "../context/ChatLabPreviewContext.jsx";
import { ImageViewProvider } from "../context/ImageViewContext.jsx";
import Image from "../ui/Image.jsx";
import Avatar from "../ui/Avatar.jsx";
import { lastHtmlFenceAsSrcDocDocument } from "../chat/chatLabDocumentPreview.js";
import { collectSessionArtifacts } from "../chat/chatLabSessionArtifacts.js";
import ChatLabArtifactsBar from "../components/chat-lab/ChatLabArtifactsBar.jsx";
import ChatLabMentionAvatarGroup from "../components/chat-lab/ChatLabMentionAvatarGroup.jsx";
import { TraceDisclosure, TraceRowChevron, TraceStepGlyph } from "../components/chat-lab/TraceDisclosure.jsx";
import {
  ComposerSkillToolbarPicker,
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
import {
  buildChatMessageRenderItems,
  resolveWorkflowNodeMetaForAgent,
} from "../chat/chatLabWorkflowMessageLayout.js";
import ChatLabWorkflowReplyTabs from "../components/chat-lab/ChatLabWorkflowReplyTabs.jsx";
import { cn } from "../ui/cn.js";

/** Below this count, skip virtual scroll — avoids row-height drift on some Electron/GPU setups. */
const CHAT_LAB_PLAIN_MESSAGE_MAX = 48;
/** Distance from bottom (px) within which the transcript stays pinned during streaming. */
const CHAT_AUTO_SCROLL_BOTTOM_PX = 96;
const RAW_TRACE_MAX_ROUNDS = 24;
const RAW_TRACE_MAX_EVENTS_PER_ROUND = 240;

/**
 * @param {HTMLElement | null} el
 * @param {import("react").MutableRefObject<boolean>} autoScrollRef
 * @param {import("react").MutableRefObject<boolean>} userOptedOutRef
 * @param {{ streamingActive?: boolean; lastScrollTopRef?: import("react").MutableRefObject<number> }} [opts]
 */
function syncChatAutoScrollFromEl(el, autoScrollRef, userOptedOutRef, opts = {}) {
  if (!el) return;
  if (opts.lastScrollTopRef) {
    const scrolledUp = el.scrollTop < opts.lastScrollTopRef.current - 2;
    opts.lastScrollTopRef.current = el.scrollTop;
    if (opts.streamingActive && scrolledUp) {
      userOptedOutRef.current = true;
    }
  }
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  const threshold = opts.streamingActive
    ? CHAT_AUTO_SCROLL_BOTTOM_PX * 3
    : CHAT_AUTO_SCROLL_BOTTOM_PX;
  if (distFromBottom < threshold) {
    userOptedOutRef.current = false;
    autoScrollRef.current = true;
    return;
  }
  // While streaming, keep pinning unless the user explicitly scrolled away.
  if (!opts.streamingActive || userOptedOutRef.current) {
    autoScrollRef.current = false;
  }
}

/**
 * @param {import("react").MutableRefObject<boolean>} autoScrollRef
 * @param {boolean} streamingActive
 */
function useChatThreadScrollPin(autoScrollRef, streamingActive) {
  const userOptedOutRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const onUserScrollAway = useCallback(() => {
    userOptedOutRef.current = true;
    autoScrollRef.current = false;
  }, [autoScrollRef]);

  const armPin = useCallback(() => {
    userOptedOutRef.current = false;
    autoScrollRef.current = true;
    lastScrollTopRef.current = 0;
  }, [autoScrollRef]);

  const syncFromScroll = useCallback(
    (el) => {
      syncChatAutoScrollFromEl(el, autoScrollRef, userOptedOutRef, {
        streamingActive,
        lastScrollTopRef,
      });
    },
    [autoScrollRef, streamingActive, userOptedOutRef],
  );

  return { userOptedOutRef, onUserScrollAway, armPin, syncFromScroll, lastScrollTopRef };
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

/**
 * Re-pin transcript when bubble layout grows (markdown, images, virtual remeasure).
 * @param {import("react").RefObject<HTMLDivElement | null>} scrollRef
 * @param {import("react").MutableRefObject<boolean>} autoScrollRef
 * @param {unknown} contentDigest
 * @param {() => void} pinNow
 */
function usePinChatOnContentGrowth(scrollRef, autoScrollRef, contentDigest, pinNow) {
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const pin = () => {
      if (!autoScrollRef.current) return;
      pinNow();
    };
    pin();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(pin) : null;
    if (!ro) return undefined;
    const watch = (node) => {
      if (node instanceof Element) ro.observe(node);
    };
    watch(el);
    for (const child of el.children) watch(child);
    el.querySelectorAll(".chat-lab__messages-vtrack, .chat-lab__msg-vrow").forEach(watch);
    return () => ro.disconnect();
  }, [scrollRef, autoScrollRef, contentDigest, pinNow]);
}

/**
 * While the model is still outputting, keep correcting drift from async layout (charts, mermaid).
 * @param {boolean} active
 * @param {import("react").RefObject<HTMLDivElement | null>} scrollRef
 * @param {import("react").MutableRefObject<boolean>} autoScrollRef
 * @param {() => void} pinNow
 */
function useStreamingChatPinLoop(active, scrollRef, autoScrollRef, pinNow) {
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    const tick = () => {
      const el = scrollRef.current;
      if (autoScrollRef.current && el) {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom > 1) pinNow();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, scrollRef, autoScrollRef, pinNow]);
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
 * @param {{ mentionDelegateReply?: boolean; workspaceContext?: string; previewContext?: string; webExploreMode?: boolean; workflowFlowPrompt?: string; workflowFogPrompt?: string }} [extra]
 */
/**
 * Ensure page snapshot reaches the model even if system prompt is truncated by the gateway.
 * @param {Array<{ role: string; content: string; attachments?: unknown[] }>} outgoing
 * @param {string} previewContext
 */
function withWebExplorePreviewOnUserTurn(outgoing, previewContext, t) {
  const automationHint = t ? composeWebExploreUserTurnAutomationHint(t) : "";
  const block = [String(previewContext ?? "").trim(), automationHint].filter(Boolean).join("\n\n");
  if (!block || !Array.isArray(outgoing)) return outgoing;
  const rows = outgoing.map((row) => ({ ...row }));
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.role !== "user") continue;
    const body = String(rows[i].content ?? "");
    if (body.includes(block.slice(0, 48))) break;
    rows[i] = { ...rows[i], content: `${block}\n\n---\n\n${body}` };
    break;
  }
  return rows;
}

/**
 * Ensure workflow constraints reach the model even if the gateway truncates system prompts.
 * @param {Array<{ role: string; content: string; attachments?: unknown[] }>} outgoing
 * @param {import("../workflow/workflowRuntimeRegistry.js").WorkflowOrchestrationPlan | null | undefined} workflowPlan
 */
function withWorkflowContextOnUserTurn(outgoing, workflowPlan) {
  const block = buildWorkflowUserTurnContext(workflowPlan);
  if (!block || !Array.isArray(outgoing)) return outgoing;
  const rows = outgoing.map((row) => ({ ...row }));
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.role !== "user") continue;
    const body = String(rows[i].content ?? "");
    if (body.includes("工作流执行模式（用户已选择")) break;
    rows[i] = { ...rows[i], content: `${block}\n\n---\n\n${body}` };
    break;
  }
  return rows;
}

/**
 * @param {import("../workflow/workflowRuntimeRegistry.js").WorkflowOrchestrationPlan | null | undefined} workflowPlan
 * @param {boolean} preferSubagent
 * @param {(key: string) => string} t
 */
function resolveSubagentModeRow(workflowPlan, preferSubagent, t) {
  if (workflowPlan) {
    return workflowPlanRequiresSubagents(workflowPlan) || preferSubagent ? subagentModeSystemRow(t) : null;
  }
  return preferSubagent ? subagentModeSystemRow(t) : null;
}

/**
 * Apply workflow participant changes and return optional group member UI events.
 * @param {{
 *   participantIds: string[];
 *   mainAgent: import("../studio/agents.js").LobsterAgent | null | undefined;
 *   workflowParticipantIds: string[];
 *   agentById: Map<string, import("../studio/agents.js").LobsterAgent>;
 *   t: (key: string) => string;
 * }} args
 */
function applyWorkflowParticipantIds({ participantIds, mainAgent, workflowParticipantIds, agentById, t }) {
  const sessionParticipantIds = [
    ...new Set([...(mainAgent ? [mainAgent.id] : []), ...participantIds, ...workflowParticipantIds]),
  ];
  const prevNonMain = participantIds.filter((id) => id !== mainAgent?.id);
  const nextNonMain = sessionParticipantIds.filter((id) => id !== mainAgent?.id);
  const memberEvents = buildGroupMemberChangeEvents(
    prevNonMain,
    nextNonMain,
    agentById,
    t,
    t("chatLab.groupMemberActorYou"),
  );
  return { sessionParticipantIds, nextNonMain, memberEvents };
}

function systemRowForGroupAgent(agent, t, groupAgents, extra = {}) {
  const others = groupAgents.filter((a) => a.id !== agent.id);
  const groupDelegateHint =
    others.length > 0
      ? extra.mentionDelegateReply
        ? t("chatLab.groupDelegateReplyHint")
        : t("chatLab.groupDelegateHint")
      : "";
  const contextBlocks = [
    String(extra.workspaceContext ?? "").trim(),
    String(extra.previewContext ?? "").trim(),
    String(extra.workflowFlowPrompt ?? "").trim(),
    String(extra.workflowFogPrompt ?? "").trim(),
  ].filter(Boolean);
  const studioSuffix = [
    ...contextBlocks,
    composeChatLabStudioSuffix(t, { webExploreMode: extra.webExploreMode }),
  ]
    .filter(Boolean)
    .join("\n\n");
  return systemMessageForAgent(agent, t("chatLab.systemPrompt"), {
    groupAgents,
    groupDelegateHint,
    studioSuffix,
    ...extra,
  });
}

/**
 * Per-turn hard hint when user explicitly enables subagent mode in composer.
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
function subagentModeSystemRow(t) {
  const content = String(t("chatLab.subagentForcePrompt") ?? "").trim();
  if (!content) return null;
  return { role: "system", content };
}

/**
 * Hard workflow execution guard to avoid silently falling back to plain chat.
 * @param {import("../workflow/workflowRuntimeRegistry.js").WorkflowOrchestrationPlan | null} workflowPlan
 */
function workflowExecutionSystemRow(workflowPlan) {
  if (!workflowPlan) return null;
  const content = [
    "## 工作流执行模式（强约束）",
    "- 当前对话已选择工作流，必须按工作流节点执行，不要直接忽略流程给最终答案。",
    "- 禁止跳过流程直接回答；禁止用 web_search 等工具代替流程节点。",
    "- 仅执行当前待执行节点；完成后做明确handoff，再继续到下一节点。",
    "- 禁止创建流程图未定义的额外子智能体；若节点无子智能体则不得召唤。",
    workflowPlan.flowFogPrompt,
  ]
    .filter(Boolean)
    .join("\n");
  return { role: "system", content };
}

/**
 * @param {Record<string, unknown> | undefined} msg
 * @param {Set<string>} sessionAgentIds
 */
function isDelegatableGroupAssistantMessage(msg, sessionAgentIds) {
  if (!msg || msg.role !== "assistant" || typeof msg.agentId !== "string" || !msg.agentId || msg.error) {
    return false;
  }
  if (msg.messageKind === "group_member_event") {
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
    ...(m.messageKind === "group_member_event" || m.messageKind === "automation_run"
      ? { messageKind: m.messageKind }
      : {}),
    ...(typeof m.workflowId === "string" && m.workflowId ? { workflowId: m.workflowId } : {}),
    ...(typeof m.workflowName === "string" && m.workflowName ? { workflowName: m.workflowName } : {}),
    ...(typeof m.workflowNodeId === "string" && m.workflowNodeId ? { workflowNodeId: m.workflowNodeId } : {}),
    ...(typeof m.workflowNodeLabel === "string" && m.workflowNodeLabel
      ? { workflowNodeLabel: m.workflowNodeLabel }
      : {}),
    ...(m.workflowHandoffReply ? { workflowHandoffReply: true } : {}),
  };
}

/**
 * @param {Record<string, unknown>} assistantMsg
 * @param {string} workflowId
 * @param {string[]} activeNodeIds
 * @param {Map<string, import("../studio/agents.js").LobsterAgent>} agentById
 */
function withWorkflowAssistantNodeMeta(assistantMsg, workflowId, activeNodeIds, agentById) {
  const agentId = typeof assistantMsg.agentId === "string" ? assistantMsg.agentId : "";
  if (!workflowId || !agentId) return assistantMsg;
  const meta = resolveWorkflowNodeMetaForAgent(workflowId, agentId, agentById, activeNodeIds);
  if (!meta) return assistantMsg;
  return { ...assistantMsg, ...meta };
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
    ...(m.workflowId ? { workflowId: m.workflowId } : {}),
    ...(m.workflowName ? { workflowName: m.workflowName } : {}),
    ...(m.workflowNodeId ? { workflowNodeId: m.workflowNodeId } : {}),
    ...(m.workflowNodeLabel ? { workflowNodeLabel: m.workflowNodeLabel } : {}),
    ...(m.workflowHandoffReply ? { workflowHandoffReply: true } : {}),
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
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[] | unknown} [activityLog]
 */
function formatStreamError(raw, t, activityLog) {
  const fromLog = extractLifecycleErrorFromActivityLog(activityLog);
  const trimmed = String(fromLog || raw || "").trim();
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
  const keepStreaming = extra?.streaming === true;
  const next = { ...m, streaming: keepStreaming, createdAt: Date.now() };
  if (typeof extra?.content === "string") {
    const prev = String(m.content ?? "");
    const incoming = extra.content;
    // Keep raw fences in stored content until the runner stashes steps — display strips separately.
    if (isSidebarAutomationCarrierContent(prev, false) && !isSidebarAutomationCarrierContent(incoming, false)) {
      next.content = incoming;
    } else {
      next.content = preferLongerAssistantText(prev, incoming);
    }
  }
  if (typeof extra?.thinking === "string") {
    next.thinking = preferLongerAssistantText(String(m.thinking ?? ""), extra.thinking);
  }
  if (extra?.error) next.error = extra.error;
  if (Array.isArray(extra?.toolTrace)) {
    const merged = mergePreservingSidebarAutomationToolTrace(m.toolTrace, extra.toolTrace);
    if (merged?.length) next.toolTrace = merged;
    else delete next.toolTrace;
  }
  if (Array.isArray(extra?.activityLog)) {
    if (extra.activityLog.length > 0) next.activityLog = /** @type {typeof m.activityLog} */ (extra.activityLog);
    else delete next.activityLog;
  }
  if (Array.isArray(extra?.assistantTimeline) || Array.isArray(m.assistantTimeline)) {
    const mergedTl = mergePreservingSidebarAutomationTimeline(
      m.assistantTimeline,
      extra?.assistantTimeline,
      typeof next.content === "string" ? next.content : String(m.content ?? ""),
    );
    if (mergedTl?.length) next.assistantTimeline = mergedTl;
    else delete next.assistantTimeline;
  }
  if (Array.isArray(m.sidebarAutomationSteps) && m.sidebarAutomationSteps.length) {
    next.sidebarAutomationSteps = m.sidebarAutomationSteps;
  }
  if (Array.isArray(extra?.mentions)) {
    if (extra.mentions.length > 0) next.mentions = extra.mentions;
    else delete next.mentions;
  }
  if (next.sidebarAutomationHandoff && !isSidebarAutomationCarrierContent(String(next.content ?? ""), false)) {
    delete next.sidebarAutomationHandoff;
  }
  return next;
}

function isBrowserAutomationToolRow(row) {
  const id = String(row?.id ?? "");
  const toolName = String(row?.toolName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (
    id.startsWith("sidebar-auto:") ||
    id.startsWith("browser-auto:") ||
    toolName === "browser_action" ||
    toolName === "sidebar_action" ||
    toolName.endsWith(".browser_action") ||
    toolName.endsWith("/browser_action") ||
    toolName.endsWith(".sidebar_action") ||
    toolName.endsWith("/sidebar_action")
  );
}

/** @deprecated use isBrowserAutomationToolRow */
const isSidebarAutomationToolRow = isBrowserAutomationToolRow;

/**
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow[] | undefined} toolRows
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} activityRows
 */
function collectToolRowsDeep(toolRows, activityRows) {
  /** @type {import("../chat/toolTraceMerge.js").ToolTraceRow[]} */
  const out = [];
  if (Array.isArray(toolRows)) out.push(...toolRows);
  /** @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} rows */
  const walk = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (Array.isArray(row.toolTrace)) out.push(...row.toolTrace);
      walk(row.nestedActivity);
    }
  };
  walk(activityRows);
  return out;
}

/**
 * True only while a sidebar/webview automation tool row is actually in-flight.
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow[] | undefined} toolRows
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} activityRows
 */
function hasRunningSidebarAutomationTool(toolRows, activityRows) {
  return collectToolRowsDeep(toolRows, activityRows).some(
    (row) => isSidebarAutomationToolRow(row) && isRunningToolRow(row),
  );
}

/**
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow[] | undefined} prev
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow[] | undefined} incoming
 */
function mergePreservingSidebarAutomationToolTrace(prev, incoming) {
  const prevList = Array.isArray(prev) ? prev : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const sidebarRows = prevList.filter(isSidebarAutomationToolRow);
  const gatewayRows = incomingList.filter((r) => !isSidebarAutomationToolRow(r));
  const merged = [...gatewayRows, ...sidebarRows];
  return merged.length ? merged : undefined;
}

/**
 * Gateway timeline updates must not wipe client sidebar-auto tool segments, and must
 * not reintroduce ```sidebar-action fences into text segments.
 * @param {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[] | undefined} prev
 * @param {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[] | undefined} incoming
 * @param {string} [canonContent]
 */
function mergePreservingSidebarAutomationTimeline(prev, incoming, canonContent = "") {
  const prevList = Array.isArray(prev) ? prev : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const sidebarSegs = prevList.filter(
    (s) => s?.kind === "tool" && String(s.refId ?? "").startsWith("sidebar-auto:"),
  );
  /** @type {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */
  let tl = incomingList.length ? [...incomingList] : [...prevList];
  const seen = new Set(tl.filter((s) => s.kind === "tool").map((s) => s.refId));
  for (const seg of sidebarSegs) {
    if (!seen.has(seg.refId)) {
      tl.push(seg);
      seen.add(seg.refId);
    }
  }
  // Do not strip fences from stored timeline text — runner may still need them.
  // Display paths call stripSidebarActionFences / markdown hides the fence card.
  const canon = String(canonContent ?? "");
  if (canon.trim().length > 0 && tl.length > 0) {
    tl = reconcileTimelineWithCanonicalText(tl, canon);
  }
  return tl.length ? tl : undefined;
}

/**
 * @param {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[] | undefined} timeline
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow[]} sidebarRows
 * @param {string} cleanContent
 */
function mergeSidebarAutomationTimeline(timeline, sidebarRows, cleanContent) {
  /** @type {import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[]} */
  let tl = Array.isArray(timeline) ? [...timeline] : [];
  tl = /** @type {typeof tl} */ (stripSidebarActionFencesFromTimeline(tl) ?? []);
  const cleaned = stripSidebarActionFences(cleanContent);
  if (cleaned.trim().length > 0 && tl.length > 0) {
    tl = reconcileTimelineWithCanonicalText(tl, cleaned);
    tl = /** @type {typeof tl} */ (stripSidebarActionFencesFromTimeline(tl) ?? []);
  }
  const seen = new Set(tl.filter((s) => s.kind === "tool").map((s) => s.refId));
  for (const row of sidebarRows) {
    if (!seen.has(row.id)) {
      tl.push({ kind: "tool", refId: row.id });
      seen.add(row.id);
    }
  }
  return tl.length ? tl : undefined;
}

function sidebarAutomationStepLabel(req) {
  const action = String(req?.action ?? "step").trim() || "step";
  const ref = typeof req?.ref === "string" ? req.ref.trim() : "";
  const selector = typeof req?.selector === "string" ? req.selector.trim() : "";
  const placeholder = typeof req?.placeholder === "string" ? req.placeholder.trim() : "";
  const label = typeof req?.label === "string" ? req.label.trim() : "";
  const hint = ref || selector || placeholder || label;
  return hint ? `${action} · ${hint}` : action;
}

/**
 * @param {unknown} requested
 * @param {unknown} executed
 * @param {number} index
 * @returns {import("../chat/toolTraceMerge.js").ToolTraceRow}
 */
function sidebarAutomationToolTraceRowFromResult(requested, executed, index) {
  const req = requested && typeof requested === "object" ? requested : {};
  const row = executed && typeof executed === "object" ? executed : {};
  const action = String(row.action ?? req.action ?? "step").trim() || "step";
  const ok = row.ok !== false;
  const err = row.error ? String(row.error) : "";
  const verifyFailed = err === "verify_failed" || String(err).includes("verify") || String(err).includes("mismatch") || String(err).includes("missing");
  const summary = ok
    ? `${action} completed`
    : verifyFailed
      ? `${action} verify failed: ${err}`
      : err
        ? `${action} failed: ${err}`
        : `${action} failed`;
  return {
    id: `sidebar-auto:${index}`,
    toolName: "sidebar-action",
    label: sidebarAutomationStepLabel(req),
    phase: ok ? "completed" : "error",
    status: ok ? "ok" : "error",
    summary,
    seq: index + 1,
    args: req && typeof req === "object" ? req : undefined,
    result: row && typeof row === "object" ? JSON.stringify(row, null, 2) : undefined,
    ...(err ? { error: err } : {}),
    done: true,
  };
}

/**
 * @param {unknown} requested
 * @param {number} index
 * @returns {import("../chat/toolTraceMerge.js").ToolTraceRow}
 */
function sidebarAutomationPendingToolTraceRow(requested, index) {
  const req = requested && typeof requested === "object" ? requested : {};
  const action = String(req.action ?? "step").trim() || "step";
  return {
    id: `sidebar-auto:${index}`,
    toolName: "sidebar-action",
    label: sidebarAutomationStepLabel(req),
    phase: "start",
    status: "running",
    summary: `${action} pending`,
    seq: index + 1,
    args: req && typeof req === "object" ? req : undefined,
    done: false,
  };
}

function sidebarAutomationPendingToolTraceRows(requestedSteps) {
  const requested = Array.isArray(requestedSteps) ? requestedSteps : [];
  return requested.map((step, index) => sidebarAutomationPendingToolTraceRow(step, index));
}

/**
 * @param {unknown[]} requestedSteps
 * @param {unknown} result
 * @returns {import("../chat/toolTraceMerge.js").ToolTraceRow[]}
 */
function sidebarAutomationToolTraceRows(requestedSteps, result) {
  const requested = Array.isArray(requestedSteps) ? requestedSteps : [];
  const executed = Array.isArray(result?.steps) ? result.steps : [];
  const maxLen = Math.max(requested.length, executed.length);
  /** @type {import("../chat/toolTraceMerge.js").ToolTraceRow[]} */
  const out = [];
  for (let i = 0; i < maxLen; i++) {
    out.push(sidebarAutomationToolTraceRowFromResult(requested[i], executed[i], i));
  }
  if (result && typeof result === "object" && result.ok === false && out.length === 0) {
    out.push(
      sidebarAutomationToolTraceRowFromResult(
        { action: "sidebar-automation" },
        {
          ok: false,
          action: "sidebar-automation",
          error: String(result.error ?? "automation_failed"),
        },
        0,
      ),
    );
  }
  return out;
}

/**
 * @param {unknown[]} requestedSteps
 * @param {unknown} result
 * @param {number} [runningIndex]
 * @returns {import("../chat/toolTraceMerge.js").ToolTraceRow[]}
 */
function sidebarAutomationProgressToolTraceRows(requestedSteps, result, runningIndex = -1) {
  const requested = Array.isArray(requestedSteps) ? requestedSteps : [];
  const executed = Array.isArray(result?.steps) ? result.steps : [];
  return requested.map((step, index) => {
    if (index < executed.length) {
      return sidebarAutomationToolTraceRowFromResult(step, executed[index], index);
    }
    if (index === runningIndex) {
      return sidebarAutomationPendingToolTraceRow(step, index);
    }
    return {
      ...sidebarAutomationPendingToolTraceRow(step, index),
      phase: "pending",
      status: "pending",
      summary: `${String(step && typeof step === "object" ? step.action : "step")} pending`,
      done: false,
    };
  });
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
  const [searchParams] = useSearchParams();
  const paramC = searchParams.get("c");
  const draftIdRef = useRef(/** @type {string | null} */ (null));
  if (paramC) {
    draftIdRef.current = null;
  } else if (!draftIdRef.current) {
    draftIdRef.current = newId();
  }
  const conversationId = paramC || draftIdRef.current;
  const [workspaceEmptySession, setWorkspaceEmptySession] = useState(true);

  return (
    <ChatLabWorkspaceProvider conversationId={conversationId} isEmptySession={workspaceEmptySession}>
      <ChatLabPageMain
        conversationId={conversationId}
        onWorkspaceEmptySessionChange={setWorkspaceEmptySession}
      />
    </ChatLabWorkspaceProvider>
  );
}

/**
 * @param {{
 *   conversationId: string;
 *   onWorkspaceEmptySessionChange: (isEmpty: boolean) => void;
 *   embedMode?: {
 *     persistSession?: boolean;
 *     hidePreviewDock?: boolean;
 *     forceThread?: boolean;
 *     webExploreMode?: boolean;
 *     activeUrl?: string;
 *     pageTitle?: string;
 *     webviewRef?: import("react").RefObject<HTMLElement | null>;
 *     iframeRef?: import("react").RefObject<HTMLIFrameElement | null>;
 *     chatFloatOpen?: boolean;
 *     onToggleFloatOpen?: () => void;
 *     onStartFloatDrag?: (e: import("react").PointerEvent<HTMLElement>) => void;
 *     className?: string;
 *   };
 * }} props
 */
export function ChatLabPageMain({ conversationId, onWorkspaceEmptySessionChange, embedMode }) {
  const ephemeralSession = embedMode?.persistSession === false;
  const webExploreEmbed = Boolean(embedMode?.webExploreMode);
  const { theme } = useTheme();
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramC = searchParams.get("c");
  // Outer provider (WebExplore) — available here; normal ChatLab wires via bridge below.
  const previewApi = useChatLabPreview();

  const activeRootRef = useRef(/** @type {string | null} */ (null));
  const previewSnapshotRef = useRef(/** @type {(() => Promise<string>) | null} */ (null));
  const sidebarAutomationContinueCountRef = useRef(0);
  /** @type {import("react").MutableRefObject<string>} */
  const sidebarAutomationContinueAnchorRef = useRef("");
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.startChatStream);

  const resolveWorkspaceContextBlock = useCallback(
    () => fetchChatLabWorkspaceContextBlock(bridge, activeRootRef.current, t),
    [bridge, t],
  );
  const resolvePreviewContextBlock = useCallback(async () => {
    if (webExploreEmbed) {
      const activeUrl = String(embedMode?.activeUrl ?? "").trim();
      const pageTitle = String(embedMode?.pageTitle ?? "").trim();
      const webviewRef = embedMode?.webviewRef;
      const iframeRef = embedMode?.iframeRef;

      /** @param {string} url @param {string} title @param {string} [text] @param {boolean} [partial] */
      const composeFallback = (url, title, text = "", partial = true) => {
        if (!url) return "";
        return composeChatLabPreviewContextBlock(
          t,
          {
            ok: true,
            url,
            title: title || url,
            text,
            tabCount: 1,
            ...(partial ? { partial: true } : {}),
          },
          { webExploreMode: true },
        );
      };

      try {
        if (previewApi?.captureSidebarContextBlock) {
          const fromCtx = String((await previewApi.captureSidebarContextBlock()) ?? "").trim();
          if (fromCtx) return fromCtx;
        }
      } catch {
        /* fall through */
      }

      try {
        const snap = await captureSidebarPreviewSnapshot({
          session: {
            kind: "iframe",
            src: activeUrl,
            title: pageTitle || activeUrl,
            useWebview: Boolean(webviewRef?.current),
          },
          webviewRef,
          iframeRef,
          forceSidebar: true,
        });
        const composed = composeChatLabPreviewContextBlock(t, snap, { webExploreMode: true });
        if (composed) return composed;
      } catch {
        /* fall through */
      }

      return composeFallback(activeUrl, pageTitle);
    }

    const capture = previewSnapshotRef.current ?? previewApi?.captureSidebarContextBlock ?? null;
    if (!capture) return "";
    try {
      return await capture();
    } catch {
      return "";
    }
  }, [
    embedMode?.activeUrl,
    embedMode?.iframeRef,
    embedMode?.pageTitle,
    embedMode?.webviewRef,
    previewApi,
    t,
    webExploreEmbed,
  ]);
  const resolveAgentContextBlocks = useCallback(
    () =>
      Promise.all([resolveWorkspaceContextBlock(), resolvePreviewContextBlock()]).then(
        ([workspaceContext, previewContext]) => ({ workspaceContext, previewContext }),
      ),
    [resolvePreviewContextBlock, resolveWorkspaceContextBlock],
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
  const [composerWorkflowId, setComposerWorkflowId] = useState("");
  const [workflowRuntimeState, setWorkflowRuntimeState] = useState(
    /** @type {import("../workflow/workflowRuntimeRegistry.js").WorkflowSessionRuntimeState | null} */ (null),
  );
  const [workflowFloatRun, setWorkflowFloatRun] = useState(
    /** @type {{ workflowId: string } | null} */ (null),
  );
  const workflowRuntimeRef = useRef(workflowRuntimeState);
  const composerWorkflowIdRef = useRef(composerWorkflowId);
  const workflowHandoffFromMessageRef = useRef(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    workflowRuntimeRef.current = workflowRuntimeState;
  }, [workflowRuntimeState]);
  useEffect(() => {
    composerWorkflowIdRef.current = composerWorkflowId;
  }, [composerWorkflowId]);
  const [composerSkillRowLeaving, setComposerSkillRowLeaving] = useState(false);
  const [composerFollowUpRef, setComposerFollowUpRef] = useState(
    /** @type {import("../chat/chatSessionsStore.js").MessageFollowUpRef | null} */ (null),
  );
  const [composerAttachmentsLeaving, setComposerAttachmentsLeaving] = useState(false);
  const [composerFileRefsLeaving, setComposerFileRefsLeaving] = useState(false);
  
  /** Queued messages (max 3) - sent automatically when stream completes */
  const [queuedMessages, setQueuedMessages] = useState(
    /** @type {Array<{id: string; text: string; attachments: Array<{id: string; name: string; mime: string; dataUrl: string}>; fileRefs: import("../chat/chatLabComposerFileRefs.js").ComposerFileRef[]; modelId: string; skillRow: import("../skills/skillRegistry.js").SkillPickRow | null; workflowId?: string; followUpRef: import("../chat/chatSessionsStore.js").MessageFollowUpRef | null; mentionIds: string[]; preferSubagent?: boolean}>} */
    ([]),
  );
  const queuedMessagesRef = useRef(queuedMessages);
  const queuedAutoSendTokenRef = useRef(0);
  const [queuedSendingId, setQueuedSendingId] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);
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
  // 会话级模型状态：每个会话独立维护自己的模型ID，不受其他会话切换影响
  const [conversationModelIds, setConversationModelIds] = useState(() => new Map());
  const conversationModelIdsRef = useRef(conversationModelIds);
  conversationModelIdsRef.current = conversationModelIds;
  const [toolbarModelId, setToolbarModelId] = useState("");
  const [participantIds, setParticipantIds] = useState(/** @type {string[]} */ ([]));
  const delegatedFromMessageRef = useRef(/** @type {Set<string>} */ (new Set()));
  const delegateAfterAgentReplyRef = useRef(
    /** @type {((assistantMessageId: string, mergedHistory: Array<Record<string, unknown>>) => void) | null} */ (
      null
    ),
  );
  const workflowHandoffAfterAgentReplyRef = useRef(
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
  const chatLabGroupContinuousConversation =
    typeof config?.chatLabGroupContinuousConversation === "boolean"
      ? config.chatLabGroupContinuousConversation
      : true;
  const [workflowPickerBump, setWorkflowPickerBump] = useState(0);
  useEffect(() => {
    const onWorkflowLibChange = () => setWorkflowPickerBump((x) => x + 1);
    window.addEventListener("openstudio-workflow-library-changed", onWorkflowLibChange);
    return () => window.removeEventListener("openstudio-workflow-library-changed", onWorkflowLibChange);
  }, []);
  const workflowPickList = useMemo(() => {
    void workflowPickerBump;
    return listWorkflowsForPicker();
  }, [workflowPickerBump]);
  const workflowPickerOptions = useMemo(
    () =>
      workflowPickList.map((row) => ({
        value: row.id,
        label: row.label || row.id,
      })),
    [workflowPickList],
  );
  const continuousMentionTargetId = useMemo(() => {
    if (!chatLabGroupContinuousConversation) return "";
    const eligibleIds = new Set(mentionEligible.map((a) => a.id));
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const row = messages[i];
      if (row?.role !== "user") continue;
      const mentions = Array.isArray(row.mentions) ? row.mentions.filter(Boolean) : [];
      if (!mentions.length) continue;
      if (mentions.length !== 1) return "";
      return eligibleIds.has(mentions[0]) ? mentions[0] : "";
    }
    return "";
  }, [chatLabGroupContinuousConversation, mentionEligible, messages]);

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
  /** @type {import("react").MutableRefObject<Map<string, {
   *   id: string;
   *   streamId: string;
   *   conversationId: string;
   *   assistantMessageId: string;
   *   startedAt: number;
   *   endedAt?: number;
   *   status: "streaming" | "done" | "aborted" | "error";
   *   omittedEvents?: number;
   *   events: Array<{ id: string; at: number; type: string; seq?: number; raw: Record<string, unknown> }>;
   * }>>} */
  const rawTraceRoundsRef = useRef(new Map());
  const rawTraceFlushTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const rawTraceEventSeqRef = useRef(0);
  const [rawTraceRounds, setRawTraceRounds] = useState(
    /** @type {Array<{
     *   id: string;
     *   streamId: string;
     *   conversationId: string;
     *   assistantMessageId: string;
     *   startedAt: number;
     *   endedAt?: number;
     *   status: "streaming" | "done" | "aborted" | "error";
     *   omittedEvents?: number;
     *   events: Array<{ id: string; at: number; type: string; seq?: number; raw: Record<string, unknown> }>;
     * }>} */
    ([]),
  );
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
    // 切换会话时清空排队消息
    queuedAutoSendTokenRef.current += 1;
    setQueuedSendingId(null);
    setQueuedMessages([]);
  }, [conversationId]);

  const clearRawTraceRounds = useCallback(() => {
    rawTraceRoundsRef.current.clear();
    if (rawTraceFlushTimerRef.current) {
      clearTimeout(rawTraceFlushTimerRef.current);
      rawTraceFlushTimerRef.current = null;
    }
    setRawTraceRounds([]);
  }, []);

  const flushRawTraceRounds = useCallback(() => {
    const snap = [...rawTraceRoundsRef.current.values()]
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
      .slice(0, RAW_TRACE_MAX_ROUNDS)
      .map((round) => ({
        ...round,
        events: Array.isArray(round.events) ? [...round.events] : [],
      }));
    setRawTraceRounds(snap);
  }, []);

  const scheduleRawTraceFlush = useCallback(() => {
    if (rawTraceFlushTimerRef.current) return;
    rawTraceFlushTimerRef.current = setTimeout(() => {
      rawTraceFlushTimerRef.current = null;
      flushRawTraceRounds();
    }, 110);
  }, [flushRawTraceRounds]);

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

  const automationTaskSession = useMemo(() => {
    void sessionTitleBump;
    const id = conversationId;
    if (!id) return false;
    return isAutomationTaskSessionRecord(getSession(id));
  }, [conversationId, sessionTitleBump]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!composerWorkflowId || gatewayStreaming) return;
    const next = advanceWorkflowRuntimeByMessages({
      workflowId: composerWorkflowId,
      sessionState: { selectedWorkflowId: composerWorkflowId, runtime: workflowRuntimeRef.current },
      messages,
      agentById,
    });
    if (!next) return;
    const cur = workflowRuntimeRef.current;
    if (JSON.stringify(cur ?? null) === JSON.stringify(next ?? null)) return;
    setWorkflowRuntimeState(next);
  }, [agentById, composerWorkflowId, gatewayStreaming, messages]);

  useEffect(() => {
    if (!workflowFloatRun) return;
    const wfId = workflowFloatRun.workflowId;
    if (!composerWorkflowId || composerWorkflowId !== wfId) {
      setWorkflowFloatRun(null);
      return;
    }
    if (gatewayStreaming) return;
    if (isWorkflowRuntimeExecutionComplete(workflowRuntimeState)) {
      setWorkflowFloatRun(null);
    }
  }, [workflowFloatRun, composerWorkflowId, workflowRuntimeState, gatewayStreaming]);

  const workflowLibraryDocs = useMemo(() => listWorkflowDocuments(), []);

  const workflowLiveExecution = useMemo(
    () =>
      workflowFloatRun
        ? resolveWorkflowLiveExecution({
            workflowId: workflowFloatRun.workflowId,
            runtime: workflowRuntimeState,
            messages,
            agentById,
          })
        : null,
    [workflowFloatRun, workflowRuntimeState, messages, agentById],
  );

  const prevParamCRef = useRef(/** @type {string | null} */ (null));

  useLayoutEffect(() => {
    const prev = prevParamCRef.current;
    prevParamCRef.current = paramC;

    if (!paramC) {
      if (prev != null) {
        autoScrollRef.current = true;
        setMessages([]);
        setParticipantIds([]);
        setComposerWorkflowId("");
        setWorkflowRuntimeState(null);
        setWorkflowFloatRun(null);
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
      const workflowState = sanitizeWorkflowSessionState(rec.workflowState);
      const selectedWorkflowId = String(workflowState?.selectedWorkflowId ?? "").trim();
      const workflowParticipantIds = selectedWorkflowId
        ? resolveWorkflowParticipantIds(selectedWorkflowId, agentById)
        : [];
      const mergedParticipants = [
        ...new Set([
          ...stored.filter((id) => id && id !== mainAgent?.id),
          ...workflowParticipantIds.filter((id) => id && id !== mainAgent?.id),
        ]),
      ];
      setParticipantIds(mergedParticipants);
      setComposerWorkflowId(selectedWorkflowId);
      setWorkflowRuntimeState(workflowState?.runtime ?? null);
      setChatApiBlocked(false);
      return;
    }
    if (messagesRef.current.length > 0) return;
    navigate("/chat", { replace: true });
  }, [agentById, mainAgent?.id, navigate, paramC]);

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
      if (rec && !ephemeralSession) {
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
    [agentById, autoScrollRef, bridge, conversationId, ephemeralSession, isElectron, mainAgent, paramC, participantIds, t],
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

  /** Automation task runs append turns in-place; refresh the open thread from persistence. */
  useEffect(() => {
    if (!paramC) return undefined;

    const mergeAutomationThreadFromStore = () => {
      const rec = getSession(paramC);
      if (!isAutomationTaskSessionRecord(rec)) return;
      const liveSlices = gatewaySlicesRef.current.filter((s) => s.active && s.conversationId === paramC);
      setMessages(mapSessionRecordToUiMessages(rec, liveSlices.length ? liveSlices : null));
      autoScrollRef.current = true;
    };

    window.addEventListener("openstudio-chat-sessions-changed", mergeAutomationThreadFromStore);
    window.addEventListener("openstudio-automation-turn-started", mergeAutomationThreadFromStore);
    return () => {
      window.removeEventListener("openstudio-chat-sessions-changed", mergeAutomationThreadFromStore);
      window.removeEventListener("openstudio-automation-turn-started", mergeAutomationThreadFromStore);
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
    if (!paramC || ephemeralSession) return;
    const rec = getSession(conversationId);
    if (!rec) return;
    const current = sanitizeWorkflowSessionState(rec.workflowState);
    const selectedNow = String(current?.selectedWorkflowId ?? "");
    const runtimeNow = current?.runtime ?? null;
    const selectedNext = String(composerWorkflowId ?? "").trim();
    const runtimeNext = workflowRuntimeRef.current && workflowRuntimeRef.current.workflowId === selectedNext
      ? workflowRuntimeRef.current
      : null;
    const sameSelected = selectedNow === selectedNext;
    const sameRuntime = JSON.stringify(runtimeNow ?? null) === JSON.stringify(runtimeNext ?? null);
    if (sameSelected && sameRuntime) return;
    upsertSession(conversationId, rec.title || "…", rec.messages, {
      channel: rec.channel,
      channelPeerId: rec.channelPeerId,
      gatewayConversationId: rec.gatewayConversationId,
      participantIds: rec.participantIds,
      automationCronJobId: rec.automationCronJobId,
      automationTaskSession: rec.automationTaskSession,
      threadContext: rec.threadContext,
      workflowState: {
        selectedWorkflowId: selectedNext || null,
        runtime: runtimeNext,
      },
      previewState: rec.previewState,
    });
  }, [composerWorkflowId, conversationId, ephemeralSession, paramC, workflowRuntimeState]);

  useEffect(() => {
    if (ephemeralSession) return;
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
  }, [messages, conversationId, gatewayStreaming, t, ephemeralSession]);

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

  // 同步 toolbarModelId：根据会话状态决定显示哪个模型
  // - 流式会话：显示会话级模型（固定，不可切换）
  // - 空闲会话：显示全局默认模型（可切换，作为新会话的默认值）
  // - 有排队消息时：显示/切换排队消息的模型，不锁定为当前流式会话模型
  useEffect(() => {
    const globalActiveId = typeof config?.activeModelProfileId === "string" ? config.activeModelProfileId.trim() : "";
    const sessionModelId = conversationModelIdsRef.current.get(conversationId);

    if (gatewayStreaming && queuedMessages.length > 0) {
      const queueModelId = queuedMessages[queuedMessages.length - 1]?.modelId;
      const candidate = queueModelId || globalActiveId;
      const next = enabledModelOptions.some((o) => o.value === candidate)
        ? candidate
        : (enabledModelOptions[0]?.value ?? "");
      setToolbarModelId(next);
      return;
    }

    // 如果会话正在流式执行，优先显示会话级模型
    if (gatewayStreaming && sessionModelId) {
      const next = enabledModelOptions.some((o) => o.value === sessionModelId)
        ? sessionModelId
        : (enabledModelOptions[0]?.value ?? "");
      setToolbarModelId(next);
      return;
    }

    // 空闲会话：显示全局默认模型
    const next = enabledModelOptions.some((o) => o.value === globalActiveId)
      ? globalActiveId
      : (enabledModelOptions[0]?.value ?? "");
    setToolbarModelId(next);
  }, [conversationId, gatewayStreaming, config?.activeModelProfileId, conversationModelIds, enabledModelOptions, queuedMessages]);

  // 当有排队消息时，模型变化应用于全部排队消息
  const prevToolbarModelIdRef = useRef(toolbarModelId);
  useEffect(() => {
    if (
      prevToolbarModelIdRef.current &&
      prevToolbarModelIdRef.current !== toolbarModelId &&
      queuedMessages.length > 0
    ) {
      setQueuedMessages((prev) => prev.map((m) => ({ ...m, modelId: toolbarModelId })));
    }
    prevToolbarModelIdRef.current = toolbarModelId;
  }, [toolbarModelId, queuedMessages.length]);

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
          // Keep raw content (incl. sidebar-action fences) so the runner can extract steps.
          // Continue-session folds a new model turn into the same bubble — append prose.
          const incomingContent = String(content ?? "");
          const mergedContent = m.sidebarAutomationContinueSession
            ? (() => {
                const prev = String(m.content ?? "").trim();
                const nextText = incomingContent.trim();
                if (!nextText) return prev;
                if (!prev) return nextText;
                if (nextText.startsWith(prev) || prev.startsWith(nextText)) {
                  return preferLongerAssistantText(prev, nextText);
                }
                if (prev.includes(nextText)) return prev;
                return `${prev}\n\n${nextText}`;
              })()
            : incomingContent;
          const row = { ...m, content: mergedContent, thinking, streaming: active };
          if (toolTrace && toolTrace.length > 0) {
            const merged = mergePreservingSidebarAutomationToolTrace(m.toolTrace, toolTrace);
            if (merged) row.toolTrace = merged;
          }
          if (activityLog && activityLog.length > 0) row.activityLog = activityLog;
          if (Array.isArray(assistantTimeline) || Array.isArray(m.assistantTimeline)) {
            const mergedTl = mergePreservingSidebarAutomationTimeline(
              m.assistantTimeline,
              assistantTimeline,
              mergedContent,
            );
            if (mergedTl?.length) row.assistantTimeline = mergedTl;
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

  const sessionArtifacts = useMemo(() => collectSessionArtifacts(messages), [messages]);

  const prevConversationIdRef = useRef(conversationId);
  useEffect(() => {
    delegatedFromMessageRef.current.clear();
    workflowHandoffFromMessageRef.current.clear();
  }, [conversationId]);

  useEffect(() => {
    const prev = prevConversationIdRef.current;
    if (prev && prev !== conversationId) {
      void abortAllActiveStreams();
      autoScrollRef.current = true;
      const rec = getSession(conversationId);
      if (!rec) {
        setParticipantIds([]);
      }
    }
    prevConversationIdRef.current = conversationId;
  }, [abortAllActiveStreams, conversationId, mainAgent?.id]);

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
                ? { error: formatStreamError(String(d.message ?? ""), t, d.activityLog) }
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
              void bridge.showSystemNotification({
                title,
                body: t("notifications.replyCompleted"),
                conversationId,
              });
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
        const msg = formatStreamError(raw, t, d.activityLog);
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
        const row = messagesRef.current.find((m) => m.id === d.assistantMessageId);
        const extra = {
          ...(typeof d.content === "string" ? { content: d.content } : {}),
          ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
          ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
          ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
          ...(Array.isArray(d.assistantTimeline) ? { assistantTimeline: d.assistantTimeline } : {}),
        };
        if (d.kind === "done") {
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
          if (composerWorkflowIdRef.current) {
            workflowHandoffAfterAgentReplyRef.current?.(d.assistantMessageId, merged);
          } else {
            delegateAfterAgentReplyRef.current?.(d.assistantMessageId, merged);
          }
          // Trigger system notification when reply completes (if window is not focused)
          try {
            if (bridge?.showSystemNotification && typeof document !== "undefined" && !document.hasFocus()) {
              const title = sessionRec?.title?.trim() || "Open Studio";
              void bridge.showSystemNotification({
                title,
                body: t("notifications.replyCompleted"),
                conversationId,
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
    participantIds,
    t,
  ]);

// Listen for notification click and navigate to the corresponding conversation
  useEffect(() => {
    const onNotificationClick = (/** @type {CustomEvent} */ e) => {
      const cid = String(e?.detail?.conversationId ?? "").trim();
      if (cid) {
        navigate(`/chat?c=${encodeURIComponent(cid)}`, { replace: true });
      }
    };
    window.addEventListener("openstudio-notification-click", onNotificationClick);
    return () => window.removeEventListener("openstudio-notification-click", onNotificationClick);
  }, [navigate]);

  useEffect(() => {
    if (!bridge?.onChatStream) return undefined;
    if (!config?.chatLabRawTraceEnabled) return undefined;

    /**
     * @param {unknown} value
     * @param {number} depth
     * @returns {unknown}
     */
    const sanitizeValue = (value, depth = 0) => {
      if (value == null) return value;
      if (depth > 5) return "[DepthLimit]";
      if (Array.isArray(value)) {
        const cap = 80;
        if (value.length > cap) {
          return [...value.slice(0, cap).map((v) => sanitizeValue(v, depth + 1)), `[+${value.length - cap} more]`];
        }
        return value.map((v) => sanitizeValue(v, depth + 1));
      }
      if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v, depth + 1);
        return out;
      }
      if (typeof value === "string" && value.length > 3000) {
        return `${value.slice(0, 3000)}\n...<truncated ${value.length - 3000} chars>`;
      }
      return value;
    };

    const off = bridge.onChatStream((evt) => {
      if (!evt || typeof evt !== "object") return;
      const streamId = String(evt.streamId ?? "").trim();
      if (!streamId) return;
      const now = Date.now();

      let round = rawTraceRoundsRef.current.get(streamId);
      if (!round) {
        round = {
          id: streamId,
          streamId,
          conversationId: conversationId || "",
          assistantMessageId: "",
          startedAt: now,
          status: /** @type {const} */ ("streaming"),
          omittedEvents: 0,
          events: [],
        };
        rawTraceRoundsRef.current.set(streamId, round);
      }

      if (!round.conversationId && conversationId) round.conversationId = conversationId;
      if (typeof evt.assistantMessageId === "string" && evt.assistantMessageId.trim()) {
        round.assistantMessageId = evt.assistantMessageId.trim();
      }

      if (evt.type === "done") {
        round.status = "done";
        round.endedAt = now;
      } else if (evt.type === "aborted") {
        round.status = "aborted";
        round.endedAt = now;
      } else if (evt.type === "error") {
        round.status = "error";
        round.endedAt = now;
      }

      if (round.events.length < RAW_TRACE_MAX_EVENTS_PER_ROUND) {
        const evSeq = rawTraceEventSeqRef.current++;
        const raw = sanitizeValue(evt);
        round.events.push({
          id: `${streamId}:${evSeq}`,
          at: now,
          type: String(evt.type ?? "unknown"),
          seq: typeof evt.seq === "number" ? evt.seq : undefined,
          raw: raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : { value: raw },
        });
      } else {
        round.omittedEvents = Number(round.omittedEvents || 0) + 1;
      }

      if (rawTraceRoundsRef.current.size > RAW_TRACE_MAX_ROUNDS * 2) {
        const oldestFirst = [...rawTraceRoundsRef.current.values()].sort(
          (a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0),
        );
        const purgeCount = rawTraceRoundsRef.current.size - RAW_TRACE_MAX_ROUNDS * 2;
        for (let i = 0; i < purgeCount; i += 1) {
          rawTraceRoundsRef.current.delete(oldestFirst[i].streamId);
        }
      }

      scheduleRawTraceFlush();
    });

    return () => {
      off?.();
    };
  }, [bridge, config?.chatLabRawTraceEnabled, conversationId, scheduleRawTraceFlush]);

  useEffect(
    () => () => {
      if (rawTraceFlushTimerRef.current) clearTimeout(rawTraceFlushTimerRef.current);
    },
    [],
  );

  const composerHasPayload =
    input.trim().length > 0 || composerAttachments.length > 0 || composerFileRefs.length > 0;
  const composerDraftValid =
    composerAttachments.length > 0 ||
    composerFileRefs.length > 0 ||
    !isSlashOnlyComposerDraft(input, Boolean(composerSkillRow));
  const composerGatewayReady =
    isElectron &&
    configLoaded &&
    !configIssueKey &&
    gatewayPhase === "online" &&
    !chatApiBlocked;

  const canQueue =
    !automationTaskSession &&
    gatewayStreaming &&
    queuedMessages.length < 3 &&
    composerHasPayload &&
    composerDraftValid &&
    composerGatewayReady;

  const canSend =
    !automationTaskSession &&
    !gatewayStreaming &&
    queuedMessages.length === 0 &&
    !queuedSendingId &&
    composerHasPayload &&
    composerDraftValid &&
    composerGatewayReady;

  const composerInputLocked =
    automationTaskSession ||
    !isElectron ||
    !configLoaded ||
    (!configIssueKey && (gatewayPhase !== "online" || chatApiBlocked)) ||
    (gatewayStreaming && queuedMessages.length >= 3);  // 流式时如果排队消息达到上限才锁定

  /** Skill UI is local; keep it usable while waiting on gateway (matches `/` picker). Only lock while a reply streams. */
  const composerSkillUiLocked = gatewayStreaming || automationTaskSession;

  const composerPlaceholder = useMemo(() => {
    if (automationTaskSession) return t("chatLab.automationTaskComposerLocked");
    if (!isElectron) return t("chatLab.heroInputPlaceholder");
    if (!configLoaded) return t("chatLab.configLoadingPlaceholder");
    if (
      !configIssueKey &&
      (gatewayPhase === "checking" || gatewayPhase === "offline" || chatApiBlocked)
    ) {
      return t("chatLab.gatewayConnectingPlaceholder");
    }
    return t("chatLab.heroInputPlaceholder");
  }, [automationTaskSession, chatApiBlocked, configIssueKey, configLoaded, gatewayPhase, isElectron, t]);

  const commitUserMessageEdit = useCallback(
    async (messageId, nextRaw) => {
      if (automationTaskSession) return false;
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
      const activeWorkflowId = String(composerWorkflowId ?? "").trim();
      if (activeWorkflowId) {
        const workflowDoc = getWorkflowById(activeWorkflowId);
        editedUser.workflowId = activeWorkflowId;
        editedUser.workflowName = workflowDoc?.name || activeWorkflowId;
      } else {
        delete editedUser.workflowId;
        delete editedUser.workflowName;
      }
      const base = [...prev.slice(0, idx), editedUser];

      const tailUserRows = buildGatewayPayloadRows([editedUser], { includeImageAttachments: true });
      const { mentionIds: editMentionIds } = parseAgentMentions(trimmed, agents, {
        mainFallback: mainAgentLabel,
        everyoneLabel: mentionEveryoneLabel,
        mainAgent,
        participantIds,
        stripMentions: false,
      });
      let runtimeForPlan = workflowRuntimeRef.current;
      if (activeWorkflowId) {
        const advanced = advanceWorkflowRuntimeByMessages({
          workflowId: activeWorkflowId,
          sessionState: { selectedWorkflowId: composerWorkflowId, runtime: workflowRuntimeRef.current },
          messages: base,
          agentById,
        });
        if (advanced) {
          runtimeForPlan = advanced;
          if (JSON.stringify(advanced) !== JSON.stringify(workflowRuntimeRef.current)) {
            workflowRuntimeRef.current = advanced;
            setWorkflowRuntimeState(advanced);
          }
        }
      }
      const workflowPlan = resolveWorkflowOrchestrationPlan({
        workflowId: activeWorkflowId,
        sessionState: { selectedWorkflowId: composerWorkflowId, runtime: runtimeForPlan },
        agentById,
        mentionedAgentIds: editMentionIds,
      });
      const workflowDispatchIds = workflowPlan?.targetAgentIds?.length ? workflowPlan.targetAgentIds : [];
      const workflowReplyTargets = resolveWorkflowAgents(workflowDispatchIds, agentById);
      const editReplyTargets =
        editMentionIds.length > 0
          ? resolveReplyTargets({ mentionIds: editMentionIds, agents })
          : workflowReplyTargets.length > 0
            ? workflowReplyTargets
            : mainAgent
              ? [mainAgent]
              : [];
      const editTarget = editReplyTargets[0] ?? mainAgent ?? null;
      const editCtx =
        editTarget ?
          resolveAgentGatewayContext({
            conversationId,
            agentId: editTarget.id,
            historyMessages: base.slice(0, -1),
            mode: "thread",
            agentById,
            mainAgentStudioId: mainAgent?.id,
          })
        : { priorRows: buildGatewayPayloadRows(base.slice(0, -1), { agentById }), contextEmbedMode: "full", syncThroughMessageId: null };
      const priorRows = editCtx.priorRows;

      if (!paramC && !ephemeralSession) {
        setSearchParams({ c: conversationId }, { replace: true });
      }

      const assistantNow = Date.now();
      const assistantMsg = withWorkflowAssistantNodeMeta(
        {
          id: newId(),
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          streaming: true,
          createdAt: assistantNow,
          ...(editTarget ? { agentId: editTarget.id } : {}),
        },
        activeWorkflowId,
        workflowPlan?.runtime?.activeNodeIds ?? [],
        agentById,
      );

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
          ...(assistantMsg.workflowNodeId ? { workflowNodeId: assistantMsg.workflowNodeId } : {}),
          ...(assistantMsg.workflowNodeLabel ? { workflowNodeLabel: assistantMsg.workflowNodeLabel } : {}),
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
      if (!ephemeralSession) {
        upsertSession(conversationId, provisionalTitle || "…", persistableNext, {
          workflowState: {
            selectedWorkflowId: composerWorkflowId || null,
            runtime: workflowPlan?.runtime ?? workflowRuntimeRef.current,
          },
        });
      }

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
      const { workspaceContext, previewContext } = await resolveAgentContextBlocks();
      const sysRow = editTarget
        ? systemRowForGroupAgent(editTarget, t, editGroupAgents, {
            workspaceContext,
            previewContext,
            webExploreMode: webExploreEmbed,
            workflowFlowPrompt: workflowPlan?.flowFogPrompt,
            workflowFogPrompt:
              workflowPlan?.fogByAgentId?.[editTarget.id] ??
              Object.values(workflowPlan?.fogByAgentId ?? {})[0] ??
              "",
          })
        : {
            role: "system",
            content: composeChatLabSystemPrompt(t, {
              workspaceContext,
              previewContext,
              webExploreMode: webExploreEmbed,
            }),
          };
      const subagentModeRow = resolveSubagentModeRow(workflowPlan, false, t);
      const workflowModeRow = workflowExecutionSystemRow(workflowPlan);
      const baseOutgoing = [
        ...(sysRow ? [sysRow] : []),
        ...(workflowModeRow ? [workflowModeRow] : []),
        ...(subagentModeRow ? [subagentModeRow] : []),
        ...priorRows,
        ...tailUserRows,
      ];
      const outgoing = withWorkflowContextOnUserTurn(
        webExploreEmbed ? withWebExplorePreviewOnUserTurn(baseOutgoing, previewContext, t) : baseOutgoing,
        workflowPlan,
      );
      const composerSkill = skillPickRowToPayload(composerSkillRow);
      setComposerSkillRow(null);
      if (workflowPlan?.runtime) {
        setWorkflowRuntimeState(workflowPlan.runtime);
      }

      const isFirstTurn = priorRows.length === 0;
      if (
        !ephemeralSession &&
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
          ...(editTarget
            ? {
                agentSessionKey: sessionKeyForAgent(editTarget),
                gatewayAgentId: editTarget.gatewayAgentId,
              }
            : {}),
          usageMeta: buildStreamUsageMeta({
            conversationTitle: getSession(conversationId)?.title,
            assistantMessageId: assistantMsg.id,
            userMessageId: messageId,
            userContentPreview: trimmed,
            agentId: editTarget?.id,
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
      agentById,
      agents,
      automationTaskSession,
      beginGatewayStream,
      bridge,
      chatApiBlocked,
      composerFileRefs,
      composerSkillRow,
      composerWorkflowId,
      config?.chatLabAutoTitle,
      config?.credentials?.hasProviderApiKey,
      configIssueKey,
      conversationId,
      ephemeralSession,
      finalizeAssistantById,
      gatewayPhase,
      isElectron,
      mainAgent,
      mainAgentLabel,
      mentionEveryoneLabel,
      paramC,
      participantIds,
      resetGatewayStream,
      resolveAgentContextBlocks,
      setSearchParams,
      t,
      webExploreEmbed,
    ],
  );

  const submitNewUserTurn = useCallback(
    /**
     * @param {{
     *   trimmed: string;
     *   imageAttachments?: { mime: string; dataUrl: string }[];
     *   fileRefs?: import("../chat/chatSessionsStore.js").PersistedFileRef[];
     *   skillPickRow: import("../skills/skillRegistry.js").SkillPickRow | null;
     *   workflowId?: string | null;
     *   preferSubagent?: boolean;
     *   followUpRef?: import("../chat/chatSessionsStore.js").MessageFollowUpRef | null;
     *   onCommitted?: () => void;
     *   foldIntoAssistantId?: string;
     * }} args
     */
    async ({
      trimmed,
      imageAttachments,
      fileRefs,
      skillPickRow,
      workflowId,
      preferSubagent = false,
      followUpRef,
      onCommitted,
      foldIntoAssistantId,
    }) => {
      if (!paramC && !ephemeralSession) {
        setSearchParams({ c: conversationId }, { replace: true });
      }

      const { cleanText, mentionIds } = parseAgentMentions(trimmed, agents, {
        mainFallback: mainAgentLabel,
        everyoneLabel: mentionEveryoneLabel,
        mainAgent,
        participantIds,
        stripMentions: false,
      });
      const dispatchStartedAt = Date.now();
      const activeWorkflowId = String(workflowId || composerWorkflowId || "").trim();
      let runtimeForPlan = workflowRuntimeRef.current;
      if (activeWorkflowId) {
        const advanced = advanceWorkflowRuntimeByMessages({
          workflowId: activeWorkflowId,
          sessionState: { selectedWorkflowId: composerWorkflowId, runtime: workflowRuntimeRef.current },
          messages: messagesRef.current,
          agentById,
        });
        if (advanced) {
          runtimeForPlan = advanced;
          if (JSON.stringify(advanced) !== JSON.stringify(workflowRuntimeRef.current)) {
            workflowRuntimeRef.current = advanced;
            setWorkflowRuntimeState(advanced);
          }
        }
      }
      const workflowPlan = resolveWorkflowOrchestrationPlan({
        workflowId: activeWorkflowId,
        sessionState: { selectedWorkflowId: composerWorkflowId, runtime: runtimeForPlan },
        agentById,
        mentionedAgentIds: mentionIds,
        dispatchStartedAt,
      });
      const workflowDispatchIds = workflowPlan?.targetAgentIds?.length ? workflowPlan.targetAgentIds : [];
      const autoMentionWorkflowIds =
        workflowDispatchIds.length === 1 && workflowDispatchIds[0] === mainAgent?.id
          ? []
          : workflowDispatchIds;
      const effectiveMentionIds =
        mentionIds.length > 0
          ? mentionIds
          : autoMentionWorkflowIds.length
            ? autoMentionWorkflowIds
            : continuousMentionTargetId
              ? [continuousMentionTargetId]
              : [];
      const effectiveText = cleanText || trimmed;
      if (!isSidebarAutomationInternalUserMessage(effectiveText)) {
        sidebarAutomationContinueCountRef.current = 0;
      }
      const workflowReplyTargets = resolveWorkflowAgents(workflowDispatchIds, agentById);
      const replyTargets =
        mentionIds.length > 0
          ? resolveReplyTargets({
              mentionIds,
              participantIds,
              agents,
            })
          : workflowReplyTargets.length > 0
            ? workflowReplyTargets
            : resolveReplyTargets({
                mentionIds: effectiveMentionIds,
                participantIds,
                agents,
              });
      if (!replyTargets.length) return;

      const priorHistory = buildGatewayPayloadRows(messagesRef.current, { agentById });

      const now = Date.now();
      const skillSnap = skillMetaFromPickRow(skillPickRow ?? null);
      const composerSkill = skillPickRowToPayload(skillPickRow ?? null);
      const workflowDoc = activeWorkflowId ? getWorkflowById(activeWorkflowId) : null;
      if (activeWorkflowId) {
        setWorkflowFloatRun({ workflowId: activeWorkflowId });
      }
      const userMsg = {
        id: newId(),
        role: /** @type {const} */ ("user"),
        content: effectiveText,
        createdAt: now,
        ...(effectiveMentionIds.length ? { mentions: effectiveMentionIds } : {}),
        ...(skillSnap ? { skillMeta: skillSnap } : {}),
        ...(followUpRef ? { followUpRef } : {}),
        ...(imageAttachments && imageAttachments.length ? { imageAttachments: imageAttachments } : {}),
        ...(fileRefs && fileRefs.length ? { fileRefs: fileRefs } : {}),
        ...(activeWorkflowId
          ? {
              workflowId: activeWorkflowId,
              workflowName: workflowDoc?.name || activeWorkflowId,
            }
          : {}),
      };

      const persistablePrior = messagesRef.current
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => toPersistedChatMessage(m));

      const workflowParticipantIds = activeWorkflowId
        ? resolveWorkflowParticipantIds(activeWorkflowId, agentById)
        : workflowPlan?.requiredAgentIds ?? [];
      const { sessionParticipantIds, nextNonMain, memberEvents } = applyWorkflowParticipantIds({
        participantIds,
        mainAgent,
        workflowParticipantIds: [
          ...new Set([...workflowParticipantIds, ...effectiveMentionIds, ...replyTargets.map((a) => a.id)]),
        ],
        agentById,
        t,
      });
      setParticipantIds(nextNonMain);

      setMessages((prev) => [
        ...prev,
        ...memberEvents.map((m) => mapSessionMessageRow(m)),
        userMsg,
      ]);
      setUserBubbleEnterMessageId(userMsg.id);
      onCommitted?.();
      autoScrollRef.current = true;

      const isFirstTurn = priorHistory.length === 0;
      if (
        !ephemeralSession &&
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
      const { workspaceContext, previewContext } = await resolveAgentContextBlocks();

      const parallelReply = replyTargets.length > 1;
      const subagentModeRow = resolveSubagentModeRow(workflowPlan, preferSubagent, t);
      const workflowModeRow = workflowExecutionSystemRow(workflowPlan);
      const historyBeforeUser = messagesRef.current.filter((m) => m.id !== userMsg.id);
      const tailUserRows = buildGatewayPayloadRows([userMsg], {
        includeImageAttachments: true,
        agentById,
      });

      const foldId = String(foldIntoAssistantId ?? "").trim();
      const foldTarget =
        foldId && isSidebarAutomationInternalUserMessage(effectiveText)
          ? messagesRef.current.find((m) => m.id === foldId && m.role === "assistant")
          : null;

      /** @type {Array<{
       *   target: import("../studio/agents.js").LobsterAgent;
       *   assistantMsg: { id: string; role: "assistant"; content: string; thinking: string; streaming: boolean; createdAt: number; agentId: string; sidebarAutomationContinueSession?: boolean };
       *   streamId: string;
       *   outgoing: Array<{ role: string; content: string; attachments?: unknown[] }>;
       *   foldReuse?: boolean;
       * }>} */
      const launchJobs = replyTargets.map((target, i) => {
        const reuse = Boolean(foldTarget && i === 0);
        const assistantMsg = withWorkflowAssistantNodeMeta(
          reuse
            ? {
                id: foldTarget.id,
                role: /** @type {const} */ ("assistant"),
                content: String(foldTarget.content ?? ""),
                thinking: String(foldTarget.thinking ?? ""),
                streaming: true,
                createdAt: Date.now(),
                agentId: target.id,
                sidebarAutomationContinueSession: true,
                ...(Array.isArray(foldTarget.toolTrace) ? { toolTrace: foldTarget.toolTrace } : {}),
                ...(Array.isArray(foldTarget.assistantTimeline)
                  ? { assistantTimeline: foldTarget.assistantTimeline }
                  : {}),
                ...(Array.isArray(foldTarget.activityLog) ? { activityLog: foldTarget.activityLog } : {}),
                ...(Array.isArray(foldTarget.sidebarAutomationSteps)
                  ? { sidebarAutomationSteps: foldTarget.sidebarAutomationSteps }
                  : {}),
              }
            : {
                id: newId(),
                role: /** @type {const} */ ("assistant"),
                content: "",
                thinking: "",
                streaming: true,
                createdAt: now + i + 1,
                agentId: target.id,
              },
          activeWorkflowId,
          workflowPlan?.runtime?.activeNodeIds ?? [],
          agentById,
        );
        const sysRow = systemRowForGroupAgent(target, t, groupAgents, {
          workspaceContext,
          previewContext,
          webExploreMode: webExploreEmbed,
          workflowFlowPrompt: workflowPlan?.flowFogPrompt,
          workflowFogPrompt:
            workflowPlan?.fogByAgentId?.[target.id] ??
            Object.values(workflowPlan?.fogByAgentId ?? {})[0] ??
            "",
        });
        const ctx = resolveAgentGatewayContext({
          conversationId,
          agentId: target.id,
          historyMessages: historyBeforeUser,
          mode: "thread",
          agentById,
          mainAgentStudioId: mainAgent?.id,
        });
        const baseOutgoing = [
          ...(sysRow ? [sysRow] : []),
          ...(workflowModeRow ? [workflowModeRow] : []),
          ...(subagentModeRow ? [subagentModeRow] : []),
          ...ctx.priorRows,
          ...tailUserRows,
        ];
        const outgoing = withWorkflowContextOnUserTurn(
          webExploreEmbed ? withWebExplorePreviewOnUserTurn(baseOutgoing, previewContext, t) : baseOutgoing,
          workflowPlan,
        );
        return {
          target,
          assistantMsg,
          streamId: newId(),
          outgoing,
          contextEmbedMode: ctx.contextEmbedMode,
          threadSummaryPrefix: ctx.threadSummaryPrefix,
          syncThroughMessageId: ctx.syncThroughMessageId,
          foldReuse: reuse,
        };
      });

      const persistableNext = [
        ...persistablePrior.filter((m) => !launchJobs.some((j) => j.foldReuse && j.assistantMsg.id === m.id)),
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
          ...(userMsg.workflowId ? { workflowId: userMsg.workflowId } : {}),
          ...(userMsg.workflowName ? { workflowName: userMsg.workflowName } : {}),
        },
        ...launchJobs.map(({ assistantMsg }) => ({
          id: assistantMsg.id,
          role: /** @type {const} */ ("assistant"),
          content: assistantMsg.content,
          thinking: assistantMsg.thinking,
          createdAt: assistantMsg.createdAt,
          agentId: assistantMsg.agentId,
          ...(assistantMsg.workflowNodeId ? { workflowNodeId: assistantMsg.workflowNodeId } : {}),
          ...(assistantMsg.workflowNodeLabel ? { workflowNodeLabel: assistantMsg.workflowNodeLabel } : {}),
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
      if (!ephemeralSession) {
        upsertSession(conversationId, provisionalTitle || "…", persistableNext, {
          participantIds: sessionParticipantIds,
          workflowState: {
            selectedWorkflowId: workflowId || composerWorkflowId || null,
            runtime: workflowPlan?.runtime ?? null,
          },
        });
      }
      if (workflowPlan?.runtime) {
        setWorkflowRuntimeState(workflowPlan.runtime);
      }

      setMessages((prev) => {
        let next = prev;
        for (const job of launchJobs) {
          if (job.foldReuse) {
            next = next.map((m) => (m.id === job.assistantMsg.id ? { ...m, ...job.assistantMsg } : m));
          } else {
            next = [...next, job.assistantMsg];
          }
        }
        return next;
      });

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
      composerWorkflowId,
      mainAgent,
      mainAgentLabel,
      paramC,
      mentionEveryoneLabel,
      continuousMentionTargetId,
      participantIds,
      resetGatewayStream,
      resolveAgentContextBlocks,
      setProbeRestartKey,
      setSearchParams,
      setMessages,
      t,
    ],
  );

  // 流式结束后自动发送队首消息
  const sendQueuedMessage = useCallback(
    /**
     * @param {NonNullable<typeof queuedMessagesRef.current[number]>} item
     */
    async (item) => {
      const token = queuedAutoSendTokenRef.current;
      if (!item || token !== queuedAutoSendTokenRef.current) return;

      setQueuedSendingId(item.id);

      if (item.modelId) {
        setConversationModelIds((prev) => {
          const next = new Map(prev);
          next.set(conversationId, item.modelId);
          return next;
        });
      }

      const trimmed = item.text.trim();
      const attachmentSnap =
        item.attachments?.length > 0
          ? item.attachments.map(({ mime, dataUrl }) => ({ mime, dataUrl }))
          : undefined;
      const fileRefsSnap =
        item.fileRefs?.length > 0
          ? item.fileRefs.map(({ path, name, kind }) => ({ path, name, kind }))
          : undefined;

      if (
        !trimmed &&
        (!attachmentSnap || attachmentSnap.length === 0) &&
        (!fileRefsSnap || fileRefsSnap.length === 0)
      ) {
        setQueuedSendingId(null);
        setQueuedMessages((prev) => prev.filter((m) => m.id !== item.id));
        return;
      }

      if (token !== queuedAutoSendTokenRef.current) {
        setQueuedSendingId(null);
        return;
      }

      try {
        await submitNewUserTurn({
          trimmed,
          imageAttachments: attachmentSnap,
          fileRefs: fileRefsSnap,
          skillPickRow: item.skillRow || null,
          workflowId: item.workflowId || null,
          preferSubagent: item.preferSubagent === true,
          followUpRef: item.followUpRef || null,
          onCommitted: () => {
            setQueuedMessages((prev) => prev.filter((m) => m.id !== item.id));
          },
        });
      } catch (err) {
        console.error("Failed to auto-send queued message:", err);
        setQueuedSendingId(null);
      }
    },
    [conversationId, submitNewUserTurn],
  );

  useEffect(() => {
    if (gatewayStreaming && queuedSendingId) {
      setQueuedSendingId(null);
    }
  }, [gatewayStreaming, queuedSendingId]);

  const prevGatewayStreamingRef = useRef(gatewayStreaming);
  useEffect(() => {
    const wasStreaming = prevGatewayStreamingRef.current;
    prevGatewayStreamingRef.current = gatewayStreaming;

    if (!wasStreaming || gatewayStreaming || queuedSendingId) return;

    const next = queuedMessagesRef.current[0];
    if (!next) return;

    void sendQueuedMessage(next);
  }, [gatewayStreaming, queuedSendingId, sendQueuedMessage]);

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
      const { workspaceContext, previewContext } = await resolveAgentContextBlocks();
      const sysRow = systemRowForGroupAgent(target, t, groupAgents, {
        mentionDelegateReply: true,
        workspaceContext,
        previewContext,
        webExploreMode: webExploreEmbed,
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
      if (!ephemeralSession) {
        upsertSession(conversationId, rec?.title || provisionalTitle || "…", persistableNext, {
          participantIds: sessionParticipantIds,
        });
      }

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
      resolveAgentContextBlocks,
      setProbeRestartKey,
      setMessages,
      t,
    ],
  );

  const launchWorkflowHandoffReply = useCallback(
    /**
     * @param {{
     *   targets: import("../studio/agents.js").LobsterAgent[];
     *   historyMessages: Array<Record<string, unknown>>;
     *   triggerAgentId?: string;
     *   runtime: import("../workflow/workflowRuntimeRegistry.js").WorkflowSessionRuntimeState;
     * }} args
     */
    async ({ targets, historyMessages, triggerAgentId, runtime }) => {
      if (!targets.length || !bridge?.startChatStream || !mainAgent || !conversationId) return;

      const workflowId = String(composerWorkflowIdRef.current ?? "").trim();
      if (!workflowId) return;

      const workflowPlan = resolveWorkflowOrchestrationPlan({
        workflowId,
        sessionState: { selectedWorkflowId: workflowId, runtime },
        agentById,
        mentionedAgentIds: [],
        dispatchStartedAt: runtime.dispatchStartedAt,
      });
      const workflowParticipantIds = resolveWorkflowParticipantIds(workflowId, agentById);
      const { sessionParticipantIds, nextNonMain, memberEvents } = applyWorkflowParticipantIds({
        participantIds,
        mainAgent,
        workflowParticipantIds: [
          ...new Set([...workflowParticipantIds, ...targets.map((a) => a.id)]),
        ],
        agentById,
        t,
      });
      setParticipantIds(nextNonMain);

      const groupAgents = groupAgentsInSession({
        agents,
        mainAgent,
        participantIds: sessionParticipantIds,
      });
      const { workspaceContext, previewContext } = await resolveAgentContextBlocks();
      const workflowModeRow = workflowExecutionSystemRow(workflowPlan);
      const subagentModeRow = resolveSubagentModeRow(workflowPlan, false, t);
      const triggerName = triggerAgentId ? agentDisplayLabel(agentById.get(triggerAgentId)) : "";
      const handoffUserRow = {
        role: "user",
        content: [
          "【工作流 handoff】上一节点已完成，请立即执行你被分配的工作流节点。",
          triggerName ? `上游执行者：${triggerName}` : "",
          "不要重复上游工作，不要跳过节点直接给最终答案。",
        ]
          .filter(Boolean)
          .join("\n"),
      };

      /** @type {Array<{ target: import("../studio/agents.js").LobsterAgent; assistantMsg: Record<string, unknown>; streamId: string; outgoing: Array<{ role: string; content: string }> }>} */
      const jobs = targets.map((target, i) => {
        const assistantMsg = withWorkflowAssistantNodeMeta(
          {
            id: newId(),
            role: /** @type {const} */ ("assistant"),
            content: "",
            thinking: "",
            streaming: true,
            createdAt: Date.now() + i,
            agentId: target.id,
            workflowHandoffReply: true,
            ...(triggerAgentId ? { workflowHandoffFromAgentId: triggerAgentId } : {}),
          },
          workflowId,
          runtime.activeNodeIds ?? [],
          agentById,
        );
        const sysRow = systemRowForGroupAgent(target, t, groupAgents, {
          workspaceContext,
          previewContext,
          webExploreMode: webExploreEmbed,
          workflowFlowPrompt: workflowPlan?.flowFogPrompt,
          workflowFogPrompt:
            workflowPlan?.fogByAgentId?.[target.id] ??
            Object.values(workflowPlan?.fogByAgentId ?? {})[0] ??
            "",
        });
        const handoffPriorRows = buildWorkflowHandoffGatewayPriorRows({
          historyMessages,
          triggerAgentId: triggerAgentId ?? "",
          targetAgentId: target.id,
          agentById,
          mainAgentStudioId: mainAgent?.id ?? "",
        });
        const recForSummary = getSession(conversationId);
        const threadSummaryPrefix =
          recForSummary?.threadContext?.summary?.trim() ||
          computeThreadSummary(filterMessagesForGatewayContext(historyMessages)) ||
          undefined;
        const contextEmbedMode = handoffPriorRows.length ? "bootstrap" : "none";
        const baseOutgoing = [
          ...(sysRow ? [sysRow] : []),
          ...(workflowModeRow ? [workflowModeRow] : []),
          ...(subagentModeRow ? [subagentModeRow] : []),
          ...handoffPriorRows,
          handoffUserRow,
        ];
        const outgoing = withWorkflowContextOnUserTurn(baseOutgoing, workflowPlan);
        return {
          target,
          assistantMsg,
          streamId: newId(),
          outgoing,
          contextEmbedMode,
          ...(threadSummaryPrefix ? { threadSummaryPrefix } : {}),
        };
      });

      const persistablePrior = historyMessages
        .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
        .map((m) => toPersistedChatMessage(m));
      const persistableNext = [
        ...persistablePrior,
        ...jobs.map(({ assistantMsg }) => ({
          id: String(assistantMsg.id),
          role: /** @type {const} */ ("assistant"),
          content: "",
          thinking: "",
          createdAt: Number(assistantMsg.createdAt),
          agentId: String(assistantMsg.agentId),
          workflowHandoffReply: true,
          ...(assistantMsg.workflowNodeId ? { workflowNodeId: String(assistantMsg.workflowNodeId) } : {}),
          ...(assistantMsg.workflowNodeLabel
            ? { workflowNodeLabel: String(assistantMsg.workflowNodeLabel) }
            : {}),
          ...(triggerAgentId ? { workflowHandoffFromAgentId: triggerAgentId } : {}),
        })),
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
      if (!ephemeralSession) {
        upsertSession(conversationId, rec?.title || provisionalTitle || "…", persistableNext, {
          participantIds: sessionParticipantIds,
          workflowState: {
            selectedWorkflowId: workflowId,
            runtime,
          },
        });
      }

      setWorkflowRuntimeState(runtime);
      workflowRuntimeRef.current = runtime;

      setMessages((prev) => {
        let next = prev;
        if (memberEvents.length > 0) {
          next = [...next, ...memberEvents.map((m) => mapSessionMessageRow(m))];
        }
        for (const job of jobs) {
          if (next.some((m) => m.id === job.assistantMsg.id)) continue;
          next = [...next, job.assistantMsg];
        }
        return next;
      });
      autoScrollRef.current = true;

      for (const job of jobs) {
        beginGatewayStream({
          conversationId,
          streamId: job.streamId,
          assistantMessageId: String(job.assistantMsg.id),
        });
        activeStreamIdsRef.current.add(job.streamId);
        assistantStreamIdsRef.current.set(String(job.assistantMsg.id), job.streamId);
      }

      const stopWechatTyping = maybeStartWechatTypingPulse(conversationId);
      const lastTurnPreview = [...historyMessages]
        .reverse()
        .find(
          (m) =>
            (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim().length > 0,
        );

      const runJob = async (job) => {
        try {
          await bridge.startChatStream({
            streamId: job.streamId,
            conversationId,
            messages: job.outgoing,
            composerSkill: null,
            agentSessionKey: sessionKeyForAgent(job.target),
            gatewayAgentId: job.target.gatewayAgentId,
            concurrent: true,
            contextEmbedMode: job.contextEmbedMode,
            ...(job.threadSummaryPrefix ? { threadSummaryPrefix: job.threadSummaryPrefix } : {}),
            usageMeta: buildStreamUsageMeta({
              conversationTitle: getSession(conversationId)?.title,
              assistantMessageId: String(job.assistantMsg.id),
              userContentPreview: String(lastTurnPreview?.content ?? "").trim(),
              agentId: job.target.id,
            }),
          });
        } catch (err) {
          resetGatewayStream(job.streamId);
          activeStreamIdsRef.current.delete(job.streamId);
          assistantStreamIdsRef.current.delete(String(job.assistantMsg.id));
          try {
            await bridge.abortChatStream(job.streamId);
          } catch {
            /* ignore */
          }
          const raw = String(err?.message ?? err);
          const msg = formatStreamError(raw, t);
          finalizeAssistantById(String(job.assistantMsg.id), { error: msg });
          if (isChatHttp404(raw)) {
            setChatApiBlocked(true);
            setProbeRestartKey((k) => k + 1);
          }
        }
      };

      try {
        await Promise.allSettled(jobs.map((job) => runJob(job)));
      } finally {
        stopWechatTyping();
      }
    },
    [
      agentById,
      beginGatewayStream,
      bridge,
      conversationId,
      ephemeralSession,
      finalizeAssistantById,
      mainAgent,
      participantIds,
      resetGatewayStream,
      resolveAgentContextBlocks,
      setProbeRestartKey,
      setMessages,
      t,
      webExploreEmbed,
    ],
  );

  const maybeWorkflowHandoffAfterAgentReply = useCallback(
    (assistantMessageId, mergedHistory) => {
      if (!conversationId) return;
      if (workflowHandoffFromMessageRef.current.has(assistantMessageId)) return;

      queueMicrotask(() => {
        if (workflowHandoffFromMessageRef.current.has(assistantMessageId)) return;
        if (activeStreamIdsRef.current.size > 0) return;

        const workflowId = String(composerWorkflowIdRef.current ?? "").trim();
        if (!workflowId) return;

        const msg = mergedHistory.find((m) => m.id === assistantMessageId);
        if (!msg || msg.role !== "assistant" || msg.error || msg.streaming) return;

        const speakerId = String(msg.agentId ?? "").trim();
        if (!speakerId) return;

        const handoff = advanceWorkflowAndCollectHandoffs({
          workflowId,
          sessionState: { selectedWorkflowId: workflowId, runtime: workflowRuntimeRef.current },
          messages: mergedHistory,
          agentById,
          triggerAgentId: speakerId,
        });
        if (!handoff) return;

        setWorkflowRuntimeState(handoff.runtime);
        workflowRuntimeRef.current = handoff.runtime;

        if (!handoff.handoffAgentIds.length) {
          if (!ephemeralSession) {
            const rec = getSession(conversationId);
            if (rec) {
              upsertSession(conversationId, rec.title || "…", rec.messages, {
                channel: rec.channel,
                channelPeerId: rec.channelPeerId,
                gatewayConversationId: rec.gatewayConversationId,
                participantIds: rec.participantIds,
                threadContext: rec.threadContext,
                workflowState: { selectedWorkflowId: workflowId, runtime: handoff.runtime },
                previewState: rec.previewState,
              });
            }
          }
          return;
        }

        workflowHandoffFromMessageRef.current.add(assistantMessageId);

        let targets = resolveWorkflowAgents(handoff.handoffAgentIds, agentById);
        if (!targets.length && handoff.runtime.activeNodeIds.length) {
          const workflow = getWorkflowById(workflowId);
          const rawIds = [];
          if (workflow) {
            const nodeById = new Map((workflow.nodes ?? []).map((n) => [n.id, n]));
            for (const nodeId of handoff.runtime.activeNodeIds) {
              const data = nodeById.get(nodeId)?.data;
              const raw =
                data && typeof data === "object" && typeof data.agentId === "string" ? data.agentId.trim() : "";
              if (raw) rawIds.push(raw);
            }
          }
          targets = resolveWorkflowAgents([...handoff.handoffAgentIds, ...rawIds], agentById);
        }
        if (!targets.length) return;

        void launchWorkflowHandoffReply({
          targets,
          historyMessages: mergedHistory,
          triggerAgentId: speakerId,
          runtime: handoff.runtime,
        });
      });
    },
    [agentById, conversationId, ephemeralSession, launchWorkflowHandoffReply],
  );

  const maybeDelegateAfterAgentReply = useCallback(
    (assistantMessageId, mergedHistory) => {
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
      participantIds,
    ],
  );

  useEffect(() => {
    delegateAfterAgentReplyRef.current = maybeDelegateAfterAgentReply;
  }, [maybeDelegateAfterAgentReply]);

  useEffect(() => {
    workflowHandoffAfterAgentReplyRef.current = maybeWorkflowHandoffAfterAgentReply;
  }, [maybeWorkflowHandoffAfterAgentReply]);

  const send = useCallback(async () => {
    if (automationTaskSession) return;
    const trimmed = input.trim();
    const attachmentSnap =
      composerAttachments.length > 0
        ? composerAttachments.map(({ mime, dataUrl }) => ({ mime, dataUrl }))
        : undefined;
    const fileRefsSnap =
      composerFileRefs.length > 0
        ? composerFileRefs.map(({ path, name, kind }) => ({ path, name, kind }))
        : undefined;
    const hasPayload =
      Boolean(trimmed) ||
      (attachmentSnap && attachmentSnap.length > 0) ||
      (fileRefsSnap && fileRefsSnap.length > 0);

    // 流式进行中：加入排队（最多 3 条）
    if (gatewayStreaming && queuedMessages.length < 3) {
      if (!hasPayload) return;

      const { mentionIds } = parseAgentMentions(trimmed, agents, {
        mainFallback: mainAgentLabel,
        everyoneLabel: mentionEveryoneLabel,
        mainAgent,
        participantIds,
        stripMentions: false,
      });

      const queuedMsg = {
        id: newId(),
        text: trimmed,
        attachments: [...composerAttachments],
        fileRefs: [...composerFileRefs],
        modelId: toolbarModelId,
        skillRow: composerSkillRow,
        workflowId: composerWorkflowId,
        followUpRef: composerFollowUpRef,
        mentionIds,
      };

      setQueuedMessages((prev) => [...prev, queuedMsg]);

      setInput("");
      setComposerSkillRow(null);
      setComposerFollowUpRef(null);
      setComposerAttachments([]);
      setComposerFileRefs([]);

      return;
    }

    // 队列排空期间禁止手动直发
    if (!gatewayStreaming && (queuedMessages.length > 0 || queuedSendingId)) return;

    if (messagesRef.current.some((m) => m.role === "assistant" && m.streaming)) return;
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

    // 保存会话级模型：当前选中的模型将被锁定为该会话的模型
    // 这样流式开始后，toolbarModelId 会显示会话级模型而不是全局模型
    const currentModelId = toolbarModelId;
    setConversationModelIds((prev) => {
      const next = new Map(prev);
      next.set(conversationId, currentModelId);
      return next;
    });

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
      fileRefs: fileRefsSnap,
      skillPickRow: effectiveSkillRow ?? null,
      workflowId: composerWorkflowIdRef.current || composerWorkflowId || null,
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
    automationTaskSession,
    bridge,
    chatApiBlocked,
    commitUserMessageEdit,
    composerAttachments,
    composerFileRefs,
    composerSkillRow,
    composerWorkflowId,
    configIssueKey,
    conversationId,
    gatewayPhase,
    gatewayStreaming,
    input,
    isElectron,
    agents,
    mainAgent,
    mainAgentLabel,
    mentionEveryoneLabel,
    continuousMentionTargetId,
    paramC,
    participantIds,
    setSearchParams,
    submitNewUserTurn,
    queuedMessages,
    queuedSendingId,
    toolbarModelId,
    composerFollowUpRef,
  ]);

  const quickReplySend = useCallback(
    async (text) => {
      if (automationTaskSession) return;
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
        workflowId: composerWorkflowIdRef.current || composerWorkflowId || null,
        onCommitted: () => {},
      });
    },
    [
      automationTaskSession,
      bridge,
      chatApiBlocked,
      configIssueKey,
      gatewayPhase,
      gatewayStreaming,
      isElectron,
      composerWorkflowId,
      submitNewUserTurn,
    ],
  );

  /** Cancel a queued message (including one about to auto-send) */
  const cancelQueuedMessage = useCallback((queuedId) => {
    if (queuedSendingId === queuedId) {
      queuedAutoSendTokenRef.current += 1;
      setQueuedSendingId(null);
    }
    setQueuedMessages((prev) => prev.filter((m) => m.id !== queuedId));
  }, [queuedSendingId]);

  /** Clear all queued messages */
  const clearQueuedMessages = useCallback(() => {
    setQueuedMessages([]);
  }, []);

  const applySidebarAutomationResult = useCallback(
    async ({ phase, assistantMessageId, requestedSteps, runningIndex, result }) => {
      const sourceId = String(assistantMessageId ?? "").trim();
      if (!sourceId) return;
      const requested = Array.isArray(requestedSteps) ? requestedSteps : [];

      /** @type {import("../chat/toolTraceMerge.js").ToolTraceRow[]} */
      let sidebarRows = [];
      if (phase === "start") {
        sidebarRows = sidebarAutomationPendingToolTraceRows(requested);
      } else if (phase === "progress") {
        sidebarRows = sidebarAutomationProgressToolTraceRows(requested, result, runningIndex);
      } else {
        sidebarRows = sidebarAutomationToolTraceRows(requested, result);
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== sourceId) return m;
          const keepRows = Array.isArray(m.toolTrace)
            ? m.toolTrace.filter((r) => !isSidebarAutomationToolRow(r))
            : [];
          const toolTrace = [...keepRows, ...sidebarRows];
          const rawContent = String(m.content ?? "");
          const cleanContent = stripSidebarActionFences(rawContent);
          const nextTimeline = mergeSidebarAutomationTimeline(
            m.assistantTimeline,
            sidebarRows,
            cleanContent,
          );
          const gatewayStreamId = assistantStreamIdsRef.current.get(sourceId);
          const gatewayStillActive = Boolean(
            gatewayStreamId && activeStreamIdsRef.current.has(gatewayStreamId),
          );
          return {
            ...m,
            content: cleanContent,
            // Stash steps before fences are stripped so the runner can still execute.
            sidebarAutomationSteps: requested.length
              ? requested
              : Array.isArray(m.sidebarAutomationSteps)
                ? m.sidebarAutomationSteps
                : undefined,
            // Don't clear streaming if the original gateway turn is still open.
            streaming: phase === "complete" ? gatewayStillActive : true,
            toolTrace: toolTrace.length ? toolTrace : undefined,
            assistantTimeline: nextTimeline,
            createdAt: Date.now(),
          };
        }),
      );

      // Fence path is legacy/debug only. Observe→act continues via native OpenClaw
      // tool `sidebar_action` (mid-turn tool_trace); do not inject continue user turns.
      if (phase !== "complete") return;
    },
    [setMessages],
  );

  const stop = useCallback(() => {
    void abortAllActiveStreams();
  }, [abortAllActiveStreams]);

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
          if (canQueue || canSend) send();
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (canQueue || canSend) send();
      }
    },
    [
      canQueue,
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

  const isLandingRaw = !messages.some((m) => m.messageKind !== "group_member_event");
  const isLanding = embedMode?.forceThread ? false : isLandingRaw;
  const showWebExploreFloatToggle =
    Boolean(embedMode?.webExploreMode) && typeof embedMode?.onToggleFloatOpen === "function";
  useEffect(() => {
    onWorkspaceEmptySessionChange(isLandingRaw);
  }, [isLandingRaw, onWorkspaceEmptySessionChange]);
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

  const gatePending = embedMode?.forceThread ? false : shellPhase !== "ready";
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

  const streamLocked = useMemo(
    () =>
      gatewayStreaming ||
      messages.some((m) => m.role === "assistant" && m.streaming),
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

  const composerPendingImageChars = useMemo(
    () =>
      imageAttachmentsContextChars(
        composerAttachments.map((a) => ({ dataUrl: a.dataUrl })),
        { includePayload: true },
      ),
    [composerAttachments],
  );

  const contextUsageApprox = useMemo(() => {
    // Get current model's context window size
    const currentProfile = config?.modelProfiles?.find((p) => p.id === toolbarModelId);
    const currentModelId = currentProfile?.modelId || "";
    const contextWindow = getContextWindowSize(currentModelId);
    
    // Calculate USED context: only sent messages (user + assistant)
    // Do NOT include system prompt - it's a fixed cost, not user-visible usage
    const usedChars = estimateThreadCharBudget(messages, {
      systemPromptLen: 0,  // Don't count system prompt
      inputLen: 0,
      pendingImagePayloadChars: 0,
    });
    const usedTokens = approxTokensFromChars(usedChars);
    const usedFrac = usedTokens / contextWindow;
    
    return { 
      chars: usedChars, 
      tokens: usedTokens, 
      frac: usedFrac,
      contextWindow 
    };
  }, [messages, t, config?.modelProfiles, toolbarModelId]);

  const contextMeterLines = useMemo(() => {
    const pct = Math.round(Math.min(100, Math.max(0, contextUsageApprox.frac * 100)));
    const windowFormatted = formatContextWindow(contextUsageApprox.contextWindow);
    const line1 = t("chatLab.contextMeterLine1", { pct });
    const line2 = t("chatLab.contextMeterLine2", { n: contextUsageApprox.tokens, windowK: windowFormatted });
    return { line1, line2, pct, ariaSummary: `${line1}，${line2}` };
  }, [contextUsageApprox, t]);

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
    if (automationTaskSession) return;
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
  }, [automationTaskSession, skillPickList]);

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
            <Button
                variant="text"
                size="small"
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
            </Button>
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
          {composerFollowUpRef || composerFileRefs.length > 0 || composerFileRefsLeaving ? (
            <div
              className={cn(
                "chat-lab__shell-skill-row",
                composerFileRefsLeaving && "chat-lab__shell-skill-row--leaving",
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
                  <Button
                variant="text"
                size="small"
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
                  </Button>
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
              (composerFollowUpRef || composerFileRefs.length > 0) &&
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
            onBlur={() => {
              setTimeout(() => {
                const activeElement = document.activeElement;
                if (activeElement?.closest('[data-mention-popover]')) {
                  return;
                }
                setComposerFocused(false);
              }, 0);
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
          open={slashSkillMenuOpen}
          textareaRef={textareaRef}
          filterQuery={slashFilterQuery}
          skills={skillPickList}
          highlightIndex={slashHighlightIndex}
          onPick={pickSlashSkill}
          onClose={() => {}}
          t={t}
        />
        <ChatLabAgentMentionPopover
          open={composerFocused && Boolean(mentionActive)}
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
            <TSelect
              id="chat-toolbar-model"
              borderless
              autoWidth
              prefixIcon={<Cpu size={14} strokeWidth={2} aria-hidden />}
              placeholder={
                enabledModelOptions.length > 0
                  ? t("chatLab.toolbarAuto")
                  : t("chatLab.modelNeedConfig")
              }
              value={enabledModelOptions.length > 0 ? toolbarModelId : ""}
              onChange={(v) => {
                if (enabledModelOptions.length === 0) return;
                setToolbarModelId(String(v));
                void applyToolbarModelId(String(v));
              }}
              options={enabledModelOptions}
              className="chat-lab__pill-model"
              disabled={
                composerInputLocked ||
                (gatewayStreaming && queuedMessages.length === 0) ||
                enabledModelOptions.length === 0
              }
            />
            <ComposerSkillToolbarPicker
              skills={skillPickList}
              selected={composerSkillRow}
              onSelect={(row) => {
                setComposerSkillRowLeaving(false);
                setComposerSkillRow(row);
              }}
              disabled={
                composerSkillUiLocked ||
                composerInputLocked ||
                (gatewayStreaming && queuedMessages.length === 0)
              }
              t={t}
            />
            <TSelect
              id="chat-toolbar-workflow"
              borderless
              autoWidth
              prefixIcon={<GitBranch size={14} strokeWidth={2} aria-hidden />}
              clearable={Boolean(composerWorkflowId)}
              placeholder={t("chatLab.toolbarWorkflow")}
              value={composerWorkflowId}
              onClear={() => {
                setComposerWorkflowId("");
                setWorkflowRuntimeState(null);
              }}
              onChange={(v) => {
                const nextId = String(v ?? "");
                setComposerWorkflowId(nextId);
                if (!nextId) {
                  setWorkflowRuntimeState(null);
                  return;
                }
                const nextPlan = resolveWorkflowOrchestrationPlan({
                  workflowId: nextId,
                  sessionState: { selectedWorkflowId: nextId, runtime: null },
                  agentById,
                  mentionedAgentIds: [],
                });
                setWorkflowRuntimeState(nextPlan?.runtime ?? null);
                const workflowParticipantIds = resolveWorkflowParticipantIds(nextId, agentById);
                if (workflowParticipantIds.length) {
                  const { nextNonMain, memberEvents } = applyWorkflowParticipantIds({
                    participantIds,
                    mainAgent,
                    workflowParticipantIds,
                    agentById,
                    t,
                  });
                  setParticipantIds(nextNonMain);
                  if (memberEvents.length) {
                    setMessages((prev) => [...prev, ...memberEvents.map((m) => mapSessionMessageRow(m))]);
                    autoScrollRef.current = true;
                  }
                  if (!ephemeralSession && paramC) {
                    const rec = getSession(conversationId);
                    if (rec) {
                      upsertSession(conversationId, rec.title || "…", rec.messages, {
                        channel: rec.channel,
                        channelPeerId: rec.channelPeerId,
                        gatewayConversationId: rec.gatewayConversationId,
                        participantIds: [...new Set([...(mainAgent ? [mainAgent.id] : []), ...nextNonMain])],
                        threadContext: rec.threadContext,
                        workflowState: { selectedWorkflowId: nextId, runtime: nextPlan?.runtime ?? null },
                        previewState: rec.previewState,
                      });
                    }
                  }
                }
              }}
              options={workflowPickerOptions}
              className="chat-lab__pill-workflow"
              title={t("chatLab.toolbarWorkflowHint")}
              disabled={
                composerSkillUiLocked ||
                composerInputLocked ||
                (gatewayStreaming && queuedMessages.length === 0)
              }
            />
            {pendingEditMessageId ? (
              <span className="chat-lab__composer-edit-tag" role="status">
                <span className="chat-lab__composer-edit-tag-label">{t("chatLab.composerEditingMessageTag")}</span>
                <Button
                variant="text"
                size="small"
                  type="button"
                  className="chat-lab__composer-edit-tag-dismiss"
                  onClick={() => setPendingEditMessageId(null)}
                  title={t("chatLab.composerDismissEditHint")}
                  aria-label={t("chatLab.composerDismissEditHint")}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </Button>
              </span>
            ) : null}
          </ChatLabToolbarScroll>
          <div className="chat-lab__shell-toolbar-end">
            <ChatLabContextMeter
              ratio={Math.min(1, contextUsageApprox.frac)}
              ariaSummary={contextMeterLines.ariaSummary}
              percentText={`${contextMeterLines.pct}%`}
              line1={contextMeterLines.line1}
              line2={contextMeterLines.line2}
            />
            <button
              type="button"
              className={cn(
                "chat-lab__send-round",
                gatewayStreaming ? "chat-lab__send-round--stop" : "chat-lab__send-round--send",
                !gatewayStreaming && canSend && "chat-lab__send-round--active",
              )}
              disabled={!gatewayStreaming && (!canSend)}
              onClick={gatewayStreaming ? stop : send}
              title={gatewayStreaming ? t("chatLab.stop") : sendButtonTitle}
              aria-label={gatewayStreaming ? t("chatLab.stop") : t("chatLab.send")}
            >
              <span className="chat-lab__send-round-icon" aria-hidden>
                <Send size={15} strokeWidth={2.25} />
              </span>
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

  const chatLabShell = (
    <ImageViewProvider>
      <ChatLabWorkspaceActiveRootBridge activeRootRef={activeRootRef} />
      <ChatLabPreviewContextBridge previewSnapshotRef={previewSnapshotRef} />
      {!embedMode?.forceThread ? (
        <>
          <ChatLabAutoHtmlPreview conversationId={conversationId} messages={messages} />
        </>
      ) : null}
      <ChatLabSidebarActionRunner
        conversationId={conversationId}
        messages={messages}
        onAutomationApplied={applySidebarAutomationResult}
      />
      <ChatLabSessionScopeReset conversationId={conversationId} isEmptySession={isLanding} />
      <div className="chat-lab__workspace relative">
        <div className="chat-lab__column">
          <div
            className={cn(
              "chat-lab",
              embedMode?.forceThread && "chat-lab--embed",
              embedMode?.className,
              isLanding && "chat-lab--landing",
              gatePending && "chat-lab--gate-pending",
              isLanding && landingRevealReady && "chat-lab--gate-revealed",
              !isLanding && "chat-lab--thread",
            )}
          >
            {isLanding ? (
              <>
                <ChatLabConvHeader
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
                  participantsDisabled={gatewayStreaming}
                  showFloatToggle={showWebExploreFloatToggle}
                  floatOpen={embedMode?.chatFloatOpen !== false}
                  onToggleFloatOpen={embedMode?.onToggleFloatOpen}
                  onStartFloatDrag={embedMode?.onStartFloatDrag}
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
                  participantsDisabled={gatewayStreaming}
                  showFloatToggle={showWebExploreFloatToggle}
                  floatOpen={embedMode?.chatFloatOpen !== false}
                  onToggleFloatOpen={embedMode?.onToggleFloatOpen}
                  onStartFloatDrag={embedMode?.onStartFloatDrag}
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
                    quickReplyDisabled={streamLocked || Boolean(pendingEditMessageId) || automationTaskSession}
                    remeasureKey={location.key}
                    t={t}
                    locale={locale}
                    threadLabel={t("chatLab.title")}
                    mainAgentLabel={mainAgentLabel}
                    mentionEveryoneLabel={mentionEveryoneLabel}
                    mainAgent={mainAgent}
                    participantIds={participantIds}
                    collapseTracePanels={parallelReplyActive}
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
            <ChatLabComposerStack
              className={gatePending ? "chat-lab__composer-slot--gate-pending" : undefined}
              composer={composer}
              queuedMessages={queuedMessages}
              queuedSendingId={queuedSendingId}
              onCancelQueuedMessage={cancelQueuedMessage}
            />
          </div>
        </div>
        {!embedMode?.hidePreviewDock ? (
        <ChatLabPreviewDock />
        ) : null}
        {config?.chatLabRawTraceEnabled ? (
          <ChatLabRawTraceFloatPanel rounds={rawTraceRounds} onClear={clearRawTraceRounds} />
        ) : null}
        {workflowFloatRun ? (() => {
          const doc = getWorkflowById(workflowFloatRun.workflowId);
          if (!doc) return null;
          return (
            <ChatLabWorkflowRuntimeFloatPanel
              workflowName={doc.name || workflowFloatRun.workflowId}
              nodes={doc.nodes}
              edges={doc.edges}
              runtime={workflowRuntimeState}
              liveExecution={workflowLiveExecution}
              agentById={agentById}
              workflows={workflowLibraryDocs}
              onClose={() => setWorkflowFloatRun(null)}
            />
          );
        })() : null}
      </div>
    </ImageViewProvider>
  );

  if (webExploreEmbed) {
    return chatLabShell;
  }

  return (
    <ChatLabPreviewProvider key={conversationId} conversationId={conversationId}>
      {chatLabShell}
    </ChatLabPreviewProvider>
  );
}

/**
 * Mark existing assistant replies as already handled when switching conversations so
 * hydrate / remount does not auto-open the preview dock.
 *
 * Parent loads messages in useLayoutEffect after children, so the first commit after a
 * conversation change may still carry the previous thread. Absorb that pass, then absorb
 * the following messages swap for the new conversation.
 *
 * @param {string} conversationId
 * @param {Array<{ id: string; role: string; streaming?: boolean; error?: string }>} messages
 * @param {import("react").MutableRefObject<string | null>} conversationIdRef
 * @param {import("react").MutableRefObject<boolean>} pendingHydrateRef
 * @param {import("react").MutableRefObject<unknown>} messagesAtSwitchRef
 * @param {import("react").MutableRefObject<string | null>} handledTailIdRef
 * @returns {boolean} true when this pass should skip auto-open
 */
function seedPreviewAutoOpenOnConversationSwitch(
  conversationId,
  messages,
  conversationIdRef,
  pendingHydrateRef,
  messagesAtSwitchRef,
  handledTailIdRef,
) {
  const lastFinishedAssistantId = () => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && !m.streaming && !m.error);
    return lastAssistant?.id ?? null;
  };

  if (conversationIdRef.current !== conversationId) {
    conversationIdRef.current = conversationId;
    pendingHydrateRef.current = true;
    messagesAtSwitchRef.current = messages;
    handledTailIdRef.current = lastFinishedAssistantId();
    return true;
  }

  if (pendingHydrateRef.current) {
    if (messagesAtSwitchRef.current !== messages) {
      handledTailIdRef.current = lastFinishedAssistantId();
      messagesAtSwitchRef.current = messages;
      pendingHydrateRef.current = false;
    }
    return true;
  }

  return false;
}

/**
 * When the latest assistant reply finishes streaming and includes a ```html … ``` fence,
 * open the preview dock (disk-only artifacts with no fenced body still need manual open via browser_open).
 * @param {{ conversationId: string; messages: Array<{ id: string; role: string; content?: string; streaming?: boolean; error?: string }> }} props
 */
function ChatLabAutoHtmlPreview({ conversationId, messages }) {
  const { t } = useI18n();
  const preview = useChatLabPreview();
  const handledTailIdRef = useRef(/** @type {string | null} */ (null));
  const conversationIdRef = useRef(/** @type {string | null} */ (null));
  const pendingHydrateRef = useRef(false);
  const messagesAtSwitchRef = useRef(/** @type {unknown} */ (null));

  useLayoutEffect(() => {
    if (
      seedPreviewAutoOpenOnConversationSwitch(
        conversationId,
        messages,
        conversationIdRef,
        pendingHydrateRef,
        messagesAtSwitchRef,
        handledTailIdRef,
      )
    ) {
      return;
    }
    if (!preview) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.streaming || last.error) return;
    if (handledTailIdRef.current === last.id) return;
    const doc = lastHtmlFenceAsSrcDocDocument(String(last.content ?? ""));
    handledTailIdRef.current = last.id;
    if (!doc) return;
    preview.openSrcDoc(doc, t("chatLab.previewTitleHtml"));
  }, [conversationId, messages, preview, t]);

  return null;
}

/** Pause bars — shown on the red “stop stream” control (icon only; label via aria on the button). */
function ChatStreamPauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="6" width="3" height="12" rx="0.75" fill="currentColor" />
      <rect x="13" y="6" width="3" height="12" rx="0.75" fill="currentColor" />
    </svg>
  );
}

/** @param {import("../chat/toolTraceMerge.js").ActivityRow} row */
function formatActivityHeadline(row) {
  const stream = truncateOneLine(String(row.stream ?? "").trim(), 64);
  const titleRaw = String(row.title ?? "").trim();
  const phase = String(row.phase ?? "").trim();
  const headline =
    stream.toLowerCase() === "lifecycle" && phase
      ? `${titleRaw || stream} · ${phase}`
      : titleRaw || stream || "";
  return truncateOneLine(headline, 104);
}

/** @param {import("../chat/toolTraceMerge.js").ToolTraceRow | undefined} row */
function isRunningToolRow(row) {
  if (!row) return false;
  const done =
    Boolean(row.done) || /^(end|complete|completed|ok|result)$/i.test(String(row.phase ?? "").trim());
  const failed = Boolean(row.error && String(row.error).trim());
  return !done && !failed;
}

/** @param {import("../chat/toolTraceMerge.js").ActivityRow | undefined} row */
function isRunningActivityRow(row) {
  if (!row) return false;
  if (Boolean(row.workerStreaming)) return true;
  const stream = String(row.stream ?? "").trim().toLowerCase();
  const phase = String(row.phase ?? "").trim().toLowerCase();
  if (isCompletedActivityPhase(phase)) return false;
  // Subagent cards: empty phase + not streaming means settled for this child only.
  // (Previously empty phase forced "running", so both cards stayed loading after siblings finished.)
  if (stream === "subagent") return false;
  if (phase === "running") return true;
  if (!phase) return false;
  return !isCompletedActivityPhase(phase);
}

/** @param {string | undefined} text */
function looksLikeDevTraceLabel(text) {
  const s = String(text ?? "").trim();
  if (!s) return true;
  if (/^[\w.-]+\s·\s[\w.-]+$/i.test(s)) return true;
  if (/^(lifecycle|assistant|tool|session|agent|run|item)([_.:\s-]|$)/i.test(s)) return true;
  if (/^[a-z][a-z0-9_]*$/i.test(s) && s.includes("_")) return true;
  return false;
}

/** @param {string | undefined} text */
function looksLikeShellCommand(text) {
  const s = String(text ?? "").trim();
  if (!s || s.length > 400) return false;
  if (
    /^(curl|wget|npm|pnpm|yarn|git|docker|powershell|pwsh|cmd|bash|sh|python|node|npx|pip|make|cmake|gcc|go|cargo)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/\bcurl(\.exe)?(\s|$)/i.test(s)) return true;
  if (/\.exe\s+["'`/[\-]/i.test(s)) return true;
  if (/^[a-z][\w.-]*(\.exe)?\s+/.test(s) && /["'`$]/.test(s) && !/^https?:\/\//i.test(s)) return true;
  return false;
}

/** @param {import("../chat/toolTraceMerge.js").ToolTraceRow} row */
function pickToolCommandHint(row) {
  const tool = String(row.toolName ?? "").trim();
  const sum = typeof row.summary === "string" ? row.summary.trim() : "";
  const lab = typeof row.label === "string" ? row.label.trim() : "";
  const status = typeof row.status === "string" ? row.status.trim() : "";
  const partial = typeof row.partialResult === "string" ? row.partialResult.trim() : "";
  /** @type {Record<string, unknown> | undefined} */
  const args =
    row.args && typeof row.args === "object" ? /** @type {Record<string, unknown>} */ (row.args) : undefined;
  const candidates = [pickCommandSnippet(args), tool, sum, lab, status, partial].filter(Boolean);
  for (const c of candidates) {
    if (looksLikeShellCommand(c)) return c;
  }
  return pickCommandSnippet(args) || sum || lab || status || partial || tool;
}

/** @param {string | undefined} toolName @param {string | undefined} cmdHint */
function isShellExecToolName(toolName, cmdHint) {
  if (looksLikeShellCommand(toolName) || looksLikeShellCommand(cmdHint)) return true;
  const n = String(toolName ?? "").toLowerCase();
  if (
    n.includes("exec") ||
    n.includes("run_terminal") ||
    n.includes("bash") ||
    n.includes("shell") ||
    n.includes("command") ||
    n === "run" ||
    n.includes("powershell") ||
    n.includes("spawn") ||
    n.includes("subprocess")
  ) {
    return true;
  }
  return false;
}

/** @param {string | undefined} toolName */
function isFileWriteTool(toolName) {
  const n = String(toolName ?? "").toLowerCase();
  return (
    /\b(write|edit|patch|replace|save|create|delete|remove|mkdir|rename|move|apply_patch|str_replace)\b/.test(
      n,
    ) ||
    n.includes("write_file") ||
    n.includes("edit_file") ||
    n.includes("search_replace")
  );
}

/** @param {string | undefined} toolName */
function isFileReadTool(toolName) {
  const n = String(toolName ?? "").toLowerCase();
  return (
    /\b(read|fetch|view|open|load|grep|list_dir|glob|find)\b/.test(n) ||
    n.includes("read_file") ||
    n.includes("readfile")
  );
}

/**
 * User-facing in-flight label for a tool row (not dev trace copy).
 * @param {import("../chat/toolTraceMerge.js").ToolTraceRow} row
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
function getStreamingBusyLabelFromTool(row, t) {
  const tool = String(row.toolName || "").trim();
  const nameLower = tool.toLowerCase();
  if (isSidebarAutomationToolRow(row)) {
    return t("chatLab.sidebarAutomationRunning");
  }
  // Hard-block / yield wait — never mislabel as "正在执行命令…".
  if (isSessionsSpawnToolName(tool) || /^sessions_yield$/i.test(tool)) {
    return t("chatLab.streamingAwaitSubagent");
  }
  const cmdHint = pickToolCommandHint(row);
  if (isShellExecToolName(tool, cmdHint)) {
    return t("chatLab.streamingRunningCommand");
  }

  const pres = getToolTracePresentation(row, t);
  /** @type {Record<string, unknown> | undefined} */
  const args =
    row.args && typeof row.args === "object" ? /** @type {Record<string, unknown>} */ (row.args) : undefined;

  if (pres.kind === "search") return t("chatLab.streamingSearching");
  if (pres.kind === "exec") return t("chatLab.streamingRunningCommand");
  if (pres.kind === "session") return t("chatLab.streamingPreparing");
  if (looksLikeShellCommand(pres.brief)) return t("chatLab.streamingRunningCommand");

  const hasPath = Boolean(
    pickArgString(args, [
      "path",
      "file_path",
      "filepath",
      "target_file",
      "absolute_path",
      "file",
      "uri",
      "resolvedPath",
    ]),
  );
  if (pres.kind === "file" || hasPath) {
    if (isFileWriteTool(tool)) return t("chatLab.streamingEditingFile");
    if (isFileReadTool(tool)) return t("chatLab.streamingReadingFile");
    return t("chatLab.streamingEditingFile");
  }

  if (/browser|navigate|web_fetch|webfetch|\bfetch\b|http/i.test(nameLower)) {
    return t("chatLab.streamingFetching");
  }

  return t("chatLab.streamingWorking");
}

/**
 * User-facing in-flight label for an activity row (not dev trace copy).
 * @param {import("../chat/toolTraceMerge.js").ActivityRow} row
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
function getStreamingBusyLabelFromActivity(row, t) {
  const stream = String(row.stream ?? "").trim().toLowerCase();
  const phase = String(row.phase ?? "").trim().toLowerCase();
  const title = String(row.title ?? "").trim();
  const textRaw = typeof row.text === "string" ? row.text.trim() : "";

  if (Boolean(row.workerStreaming)) return t("chatLab.streamingWriting");

  if (/^(command|exec|shell|terminal|bash|powershell|process)$/.test(stream)) {
    return t("chatLab.streamingRunningCommand");
  }
  if (looksLikeShellCommand(title) || looksLikeShellCommand(textRaw)) {
    return t("chatLab.streamingRunningCommand");
  }

  if (stream === "lifecycle") {
    if (phase === "start" || phase === "init" || phase === "bootstrap") {
      return t("chatLab.streamingPreparing");
    }
    return t("chatLab.streamingWorking");
  }


  if (stream === "subagent") {
    const task =
      typeof row.subagentTask === "string" && row.subagentTask.trim()
        ? row.subagentTask.trim()
        : textRaw;
    if (task && !looksLikeDevTraceLabel(task)) {
      return t("chatLab.streamingSubagent", { task: truncateOneLine(task, 72) });
    }
    if (title && !looksLikeDevTraceLabel(title)) {
      return t("chatLab.streamingSubagent", { task: truncateOneLine(title, 72) });
    }
    return t("chatLab.streamingSubagentGeneric");
  }

  if (title && !looksLikeDevTraceLabel(title) && !looksLikeShellCommand(title)) {
    return truncateOneLine(title, 64);
  }
  if (phase === "running") return t("chatLab.streamingWorking");
  return t("chatLab.streamingPreparing");
}

/**
 * @param {import("../chat/toolTraceMerge.js").ActivityRow[] | undefined} rows
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
function findRunningActivityBusyLabel(rows, t) {
  if (!Array.isArray(rows) || !rows.length) return "";
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const nestedTools = Array.isArray(row.toolTrace) ? row.toolTrace : [];
    for (let j = nestedTools.length - 1; j >= 0; j--) {
      const tool = nestedTools[j];
      if (isRunningToolRow(tool)) {
        return getStreamingBusyLabelFromTool(tool, t);
      }
    }
    if (isRunningActivityRow(row)) {
      return getStreamingBusyLabelFromActivity(row, t);
    }
    const nested = findRunningActivityBusyLabel(row.nestedActivity, t);
    if (nested) return nested;
  }
  return "";
}

/**
 * @param {{
 *   streaming?: boolean;
 *   timeline?: import("../chat/streamTimelineMerge.js").AssistantTimelineSegment[];
 *   toolRows?: import("../chat/toolTraceMerge.js").ToolTraceRow[];
 *   activityRows?: import("../chat/toolTraceMerge.js").ActivityRow[];
 *   subagentActivityRows?: import("../chat/toolTraceMerge.js").ActivityRow[];
 *   thinking?: string;
 *   content?: string;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   fallback?: string;
 * }} opts
 */
function resolveStreamingBusyLabel(opts) {
  const fallback = String(opts.fallback ?? opts.t("chatLab.streaming")).trim();
  if (!opts.streaming) return fallback;

  const toolRows = Array.isArray(opts.toolRows) ? opts.toolRows : [];
  const activityRows = Array.isArray(opts.activityRows) ? opts.activityRows : [];
  const subagentActivityRows = Array.isArray(opts.subagentActivityRows) ? opts.subagentActivityRows : [];
  const subagentsSettled = areSubagentCardsSettled(subagentActivityRows);
  const timeline = Array.isArray(opts.timeline) ? opts.timeline : [];
  const toolMap = new Map(toolRows.map((r) => [r.id, r]));
  const deepTools = collectToolRowsDeep(toolRows, activityRows);

  // 1) In-flight webview automation only — never sticky after the tool finishes.
  if (hasRunningSidebarAutomationTool(toolRows, activityRows)) {
    return opts.t("chatLab.sidebarAutomationRunning");
  }

  // 2) Any other in-flight tool.
  for (let i = deepTools.length - 1; i >= 0; i--) {
    const row = deepTools[i];
    const tool = String(row.toolName ?? "").trim();
    if (
      subagentsSettled &&
      (isSessionsSpawnToolName(tool) || /^sessions_yield$/i.test(tool))
    ) {
      continue;
    }
    if (isRunningToolRow(row)) return getStreamingBusyLabelFromTool(row, opts.t);
  }

  // 3) Visible assistant prose / thinking beats lifecycle "正在准备…".
  const hasTimelineText = timeline.some(
    (seg) => seg?.kind === "text" && String(seg.body ?? "").trim(),
  );
  const hasTimelineThinking = timeline.some(
    (seg) => seg?.kind === "thinking" && String(seg.body ?? "").trim(),
  );
  if (hasTimelineText || String(opts.content ?? "").trim()) {
    return opts.t("chatLab.streamingWriting");
  }
  if (hasTimelineThinking || String(opts.thinking ?? "").trim()) {
    return opts.t("chatLab.streamingThinking");
  }

  // 4) Activity / lifecycle only when there is still no user-visible reply body.
  const activityLabel = findRunningActivityBusyLabel(activityRows, opts.t);
  if (activityLabel) return activityLabel;

  for (let i = timeline.length - 1; i >= 0; i--) {
    const seg = timeline[i];
    if (seg?.kind !== "tool") continue;
    const row = toolMap.get(seg.refId);
    const tool = String(row?.toolName ?? "").trim();
    if (
      subagentsSettled &&
      row &&
      (isSessionsSpawnToolName(tool) || /^sessions_yield$/i.test(tool))
    ) {
      continue;
    }
    if (isRunningToolRow(row)) return getStreamingBusyLabelFromTool(row, opts.t);
  }

  return fallback;
}

/** Shimmer label for in-flight assistant work (tools, steps, writing). */
function ChatStreamingIndicator({ label }) {
  return (
    <span className="chat-lab__streaming" role="status" aria-live="polite">
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
  /** Hide spawn/subagent noise and de-duplicate repeated timeline refs. */
  const visibleSegments = useMemo(() => {
    const seen = new Set();
    return segments.filter((s) => {
      const ref = `${s.kind}:${String(s.refId ?? "")}`;
      if (seen.has(ref)) return false;
      if (s.kind === "tool") {
        const row = toolMap.get(s.refId);
        if (row && isSessionsSpawnToolName(row.toolName)) return false;
        if (!row) return false;
      }
      if (s.kind === "activity") {
        const row = activityMap.get(s.refId);
        const stream = String(row?.stream ?? "").toLowerCase();
        if (stream === "subagent") return false;
        if (!row) return false;
      }
      seen.add(ref);
      return true;
    });
  }, [segments, toolMap, activityMap]);
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
    for (const s of visibleSegments) {
      if (s.kind === "tool") toolCount++;
      else if (s.kind === "activity") stepCount++;
    }
    return { toolCount, stepCount };
  }, [visibleSegments]);

  const lastActivityIdx = useMemo(() => {
    let last = -1;
    visibleSegments.forEach((s, idx) => {
      if (s.kind === "activity") last = idx;
    });
    return last;
  }, [visibleSegments]);

  if (!visibleSegments.length) return null;

  const disableEnterAnim = shouldDisableTraceRowEnterAnim(streaming, visibleSegments.length);

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
        {visibleSegments.map((s, idx) => {
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
  subagentRows = [],
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

  const gapHasVisibleTextAfter = useMemo(() => {
    /** @type {Map<number, boolean>} */
    const out = new Map();
    for (let i = 0; i < visibleParts.length; i++) {
      const part = visibleParts[i];
      if (part.kind !== "toolActivityGap") continue;
      let hasTextAfter = false;
      for (let j = i + 1; j < visibleParts.length; j++) {
        const next = visibleParts[j];
        if (next.kind !== "text") continue;
        const nextBody = stripSidebarActionFences(String(next.body ?? ""));
        if (nextBody.trim()) {
          hasTextAfter = true;
          break;
        }
      }
      out.set(i, hasTextAfter);
    }
    return out;
  }, [visibleParts]);

  const spawnGapPartIdx = useMemo(() => {
    for (let i = 0; i < visibleParts.length; i++) {
      const part = visibleParts[i];
      if (part.kind !== "toolActivityGap") continue;
      for (const s of part.segments) {
        if (s.kind !== "tool") continue;
        const tool = toolMap.get(s.refId);
        if (tool && isSessionsSpawnToolName(tool.toolName)) return i;
      }
    }
    return -1;
  }, [visibleParts, toolMap]);

  const subagentStepEl =
    Array.isArray(subagentRows) && subagentRows.length > 0 ? (
      <div key="tl-subagent-stack" className="chat-lab__timeline-block chat-lab__subagent-stack">
        {subagentRows.map((row) => {
          const props = subagentStepPropsFromRow(row, t);
          return (
            <SubagentStepBlock
              key={row.id}
              title={props.title}
              progress={props.progress}
              active={props.active}
              t={t}
            />
          );
        })}
      </div>
    ) : null;

  return (
    <div className="chat-lab__assistant-timeline">
      {visibleParts.map((p, ri) => {
        if (p.kind === "text") {
          const body = stripSidebarActionFences(String(p.body ?? ""));
          if (!body.trim()) return null;
          if (plainText) {
            return (
              <div
                key={p.key}
                className="chat-lab__timeline-block chat-lab__timeline-block--text chat-lab__timeline-block--plain"
              >
                {body}
              </div>
            );
          }
          return (
            <div key={p.key} className="chat-lab__timeline-block chat-lab__timeline-block--text chat-lab__md">
              <ChatLabMarkdownContent source={body} components={mdComponents} />
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
        const panelStreaming =
          Boolean(streaming) &&
          ri === lastGapPartIdx &&
          !gapHasVisibleTextAfter.get(ri);
        /** @type {import("react").ReactNode[]} */
        const gapNodes = [];
        /** @type {Array<{ kind: "tool"; refId: string } | { kind: "activity"; refId: string }>} */
        let otherBuf = [];
        const flushOther = (keySuffix) => {
          if (!otherBuf.length) return;
          gapNodes.push(
            <GapToolActivityPanel
              key={`gap-other-${p.key}-${keySuffix}`}
              segments={otherBuf}
              toolMap={toolMap}
              activityMap={activityMap}
              t={t}
              streaming={panelStreaming}
              keepCollapsed={keepTraceCollapsed}
              nested={nested}
              collapseWhenIdle={!nested}
            />,
          );
          otherBuf = [];
        };
        for (const s of p.segments) {
          if (s.kind === "tool") {
            const tool = toolMap.get(s.refId);
            if (tool && isSessionsSpawnToolName(tool.toolName)) continue;
          }
          if (s.kind === "activity") {
            const act = activityMap.get(s.refId);
            const stream = String(act?.stream ?? "").toLowerCase();
            if (stream === "subagent") continue;
          }
          otherBuf.push(s);
        }
        flushOther("tail");
        const insertSubagentHere = Boolean(subagentStepEl) && ri === spawnGapPartIdx;
        if (!gapNodes.length && !insertSubagentHere) return null;
        return (
          <div key={p.key} className="chat-lab__timeline-block chat-lab__timeline-block--gap-chain">
            {gapNodes}
            {insertSubagentHere ? subagentStepEl : null}
          </div>
        );
      })}
      {/* Fallback: spawn not present in timeline gaps yet (tool just started). */}
      {subagentStepEl && spawnGapPartIdx < 0 ? subagentStepEl : null}
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

  // Native `browser_action` rows often have no friendly summary — avoid showing the raw tool id.
  if (isBrowserAutomationToolRow(row)) {
    const running = isRunningToolRow(row);
    const line = running
      ? t("chatLab.sidebarAutomationRunning")
      : t("chatLab.sidebarAutomationToolLabel");
    return { kind: "generic", brief: line, aria: line };
  }

  if (
    nameLower === "browser_open" ||
    nameLower.endsWith(".browser_open") ||
    nameLower.endsWith("/browser_open")
  ) {
    const running = isRunningToolRow(row);
    const line = running ? t("chatLab.browserOpenRunning") : t("chatLab.browserOpenToolLabel");
    return { kind: "generic", brief: line, aria: line };
  }

  if (
    nameLower === "browser_debug" ||
    nameLower === "sidebar_debug" ||
    nameLower.endsWith(".browser_debug") ||
    nameLower.endsWith("/browser_debug") ||
    nameLower.endsWith(".sidebar_debug") ||
    nameLower.endsWith("/sidebar_debug")
  ) {
    const running = isRunningToolRow(row);
    const line = running
      ? t("chatLab.sidebarDebugRunning")
      : t("chatLab.sidebarDebugToolLabel");
    return { kind: "generic", brief: line, aria: line };
  }

  if (
    nameLower === "browser_screenshot" ||
    nameLower === "sidebar_screenshot" ||
    nameLower.endsWith(".browser_screenshot") ||
    nameLower.endsWith("/browser_screenshot") ||
    nameLower.endsWith(".sidebar_screenshot") ||
    nameLower.endsWith("/sidebar_screenshot")
  ) {
    const running = isRunningToolRow(row);
    const line = running
      ? t("chatLab.sidebarScreenshotRunning")
      : t("chatLab.sidebarScreenshotToolLabel");
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
  const visibleRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);
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
  if (!visibleRows?.length) return null;
  const disableEnterAnim = shouldDisableTraceRowEnterAnim(streaming, visibleRows.length);
  return (
    <TraceDisclosure
      className="chat-lab__tool-chain"
      open={open}
      onOpenChange={setOpen}
      triggerClassName="chat-lab__tool-chain-summary"
      summary={t("chatLab.toolsInvokedSummary", { count: visibleRows.length })}
    >
      <div className="chat-lab__tool-chain-body">
        {visibleRows.map((row) => (
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
  const showEnterAnim = useTraceRowEnterOnMount(row.id, enterRegistryRef, disableEnterAnim);
  const stream = truncateOneLine(String(row.stream ?? "").trim(), 64);
  const phase = String(row.phase ?? "").trim();
  const titleRaw = String(row.title ?? "").trim();
  const title = formatActivityHeadline(row) || "—";
  const textRaw = typeof row.text === "string" ? row.text.trim() : "";
  const truncatedText = textRaw.length > 2000 ? `${textRaw.slice(0, 2000)}…` : textRaw;
  const nestedToolRows = Array.isArray(row.toolTrace) ? row.toolTrace : [];
  const nestedActivityRows = Array.isArray(row.nestedActivity) ? row.nestedActivity : [];
  const workerTimeline = Array.isArray(row.assistantTimeline) ? row.assistantTimeline : [];
  const workerStreaming = Boolean(row.workerStreaming);
  const rowPhase = String(row.phase ?? "").trim();
  const rowDone = isCompletedActivityPhase(rowPhase);
  const rowActive = !rowDone && (workerStreaming || rowPhase === "running");
  const titleOnly = stepTitleOnly;
  const hasDetail = titleOnly
    ? false
    : Boolean(
        phase ||
          truncatedText.length > 0 ||
          stream ||
          nestedToolRows.length > 0 ||
          nestedActivityRows.length > 0 ||
          workerTimeline.length > 0,
      );
  const ariaPieces = [stream, titleRaw || undefined, phase || undefined].filter(Boolean);
  const aria = ariaPieces.length ? ariaPieces.join(" · ") : title;
  const gState = rowDone
    ? "ok"
    : activityGlyphState(row, Boolean(streaming || workerStreaming), Boolean(isTail || workerStreaming));
  const [rowOpen, setRowOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (!autoExpandOnContent || titleOnly) return;
    const active =
      !rowDone &&
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
  }, [autoExpandOnContent, rowActive, rowDone, workerStreaming, streaming, isTail, rowPhase, titleOnly, rowOpen]);
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
      ].join(":"),
    [nestedActivityRows, nestedToolRows, workerTimeline, truncatedText, workerStreaming],
  );
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
          className="chat-lab__tool-nested-body"
          pinActive={false}
          contentDigest={nestedScrollDigest}
        >
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
        </TraceNestedScrollBody>
      ) : null}
    </TraceDisclosure>
  );
}

/**
 * Cursor-style subagent step: title + changing progress line (in the reply body).
 * @param {{
 *   title: string;
 *   progress?: string;
 *   active?: boolean;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
/** Min time each subtitle line stays visible before the next queued step. */
const SUBAGENT_LINE_HOLD_MS = 900;
/** Enter/leave animation duration (keep in sync with CSS). */
const SUBAGENT_LINE_ANIM_MS = 480;
/** Cap queued rapid tool updates (keep newest). */
const SUBAGENT_LINE_QUEUE_MAX = 8;

function SubagentStepBlock({ title, progress, active, t }) {
  const heading = String(title ?? "").trim() || t("chatLab.streamingSubagentGeneric");
  const incoming =
    String(progress ?? "").trim() ||
    (active ? t("chatLab.streamingSubagentWorking") : "");
  const [currentLine, setCurrentLine] = useState(incoming);
  const [leavingLine, setLeavingLine] = useState("");
  const [lineAnimTick, setLineAnimTick] = useState(0);
  const currentRef = useRef(incoming);
  const queueRef = useRef(/** @type {string[]} */ ([]));
  const busyRef = useRef(false);
  const lastShownAtRef = useRef(Date.now());
  const timersRef = useRef(/** @type {number[]} */ ([]));

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  };

  const schedule = (fn, ms) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };

  const pumpQueue = () => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (next === undefined) return;
    if (next === currentRef.current) {
      pumpQueue();
      return;
    }
    const wait = Math.max(0, SUBAGENT_LINE_HOLD_MS - (Date.now() - lastShownAtRef.current));
    busyRef.current = true;
    schedule(() => {
      setLeavingLine(currentRef.current);
      currentRef.current = next;
      setCurrentLine(next);
      setLineAnimTick((n) => n + 1);
      lastShownAtRef.current = Date.now();
      schedule(() => {
        setLeavingLine("");
        busyRef.current = false;
        pumpQueue();
      }, SUBAGENT_LINE_ANIM_MS);
    }, wait);
  };

  useEffect(() => {
    if (!incoming) {
      if (!active && currentRef.current) {
        queueRef.current = [];
        clearTimers();
        busyRef.current = false;
        currentRef.current = "";
        setCurrentLine("");
        setLeavingLine("");
      }
      return undefined;
    }
    if (incoming === currentRef.current) return undefined;
    const q = queueRef.current;
    if (q[q.length - 1] === incoming) return undefined;
    q.push(incoming);
    while (q.length > SUBAGENT_LINE_QUEUE_MAX) q.shift();
    pumpQueue();
    return undefined;
  }, [incoming, active]);

  useEffect(() => () => clearTimers(), []);

  return (
    <div
      className={cn("chat-lab__subagent-step", active && "chat-lab__subagent-step--active")}
      aria-live="polite"
    >
      <div className="chat-lab__subagent-step-title">
        {active ? (
          <span className="chat-lab__subagent-step-glyph chat-lab__subagent-step-glyph--grid" aria-hidden>
            {Array.from({ length: 9 }).map((_, idx) => (
              <i
                key={idx}
                className="chat-lab__subagent-dot"
                style={{ animationDelay: `${idx * 60}ms` }}
              />
            ))}
          </span>
        ) : (
          <span className="chat-lab__subagent-step-glyph" aria-hidden>
            {"\u2713"}
          </span>
        )}
        <span>{heading}</span>
      </div>
      {currentLine || leavingLine ? (
        <div className="chat-lab__subagent-step-progress muted">
          {leavingLine ? (
            <span
              key={`leave-${lineAnimTick}`}
              className="chat-lab__subagent-step-progress-line chat-lab__subagent-step-progress-line--leave"
            >
              {leavingLine}
            </span>
          ) : null}
          {currentLine ? (
            <span
              key={`enter-${lineAnimTick}`}
              className="chat-lab__subagent-step-progress-line chat-lab__subagent-step-progress-line--enter"
            >
              {currentLine}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * @param {import("../chat/toolTraceMerge.js").ActivityRow} row
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
function subagentStepPropsFromRow(row, t) {
  const task = typeof row.subagentTask === "string" ? row.subagentTask : "";
  const title = shortSubagentTitle(task, row.title) || t("chatLab.streamingSubagentGeneric");
  const progress = pickSubagentProgressLine({
    task,
    progress: row.text,
    active: isRunningActivityRow(row),
  });
  return {
    title,
    progress,
    active: isRunningActivityRow(row),
  };
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
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming, keepCollapsed]);
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
              (Boolean(r.workerStreaming) || String(r.phase ?? "") === "running")
            }
            enterRegistryRef={enterRegistryRef}
            autoExpandOnContent={false}
            stepTitleOnly={stepTitleOnly}
            mdComponents={mdComponents}
            disableEnterAnim={disableEnterAnim}
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
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   expanded: boolean;
 *   onExpandedChange: (next: boolean) => void;
 *   onFoldableChange: (canFold: boolean) => void;
 * }} props
 */
const UserMessageCollapsibleBody = memo(function UserMessageCollapsibleBody({
  message,
  t,
  expanded,
  onExpandedChange,
  onFoldableChange,
}) {
  const innerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [naturalH, setNaturalH] = useState(0);

  const userText = String(message.content ?? "");
  const userMdComponents = useMemo(() => createChatLabMarkdownComponents(t), [t]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNaturalH(el.scrollHeight));
    ro.observe(el);
    setNaturalH(el.scrollHeight);
    return () => ro.disconnect();
  }, [message.content, message.imageAttachments, userText]);

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
          <div className="chat-lab__user-text chat-lab__md chat-lab__md--user">
            <ChatLabMarkdownContent source={userText} components={userMdComponents} />
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
        <Button
                variant="text"
                size="small"
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
        </Button>
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
      <div className="chat-lab__quick-replies__toolbar">
        <span className="chat-lab__quick-replies__title">{t("chatLab.questionnaireGroup")}</span>
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
                  <Input
                    id={inputId}
                    name={it.id}
                    size="small"
                    block
                    autocomplete="off"
                    value={answers[it.id] ?? ""}
                    placeholder={t("chatLab.questionnaireAnswerPlaceholder")}
                    disabled={disabled || sent}
                    onChange={(value) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [it.id]: value,
                      }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="chat-lab__questionnaire__actions">
          <Button
            type="submit"
            variant="text"
            className="chat-lab__questionnaire-submit"
            disabled={disabled || sent || !canSubmit}
          >
            {t("chatLab.questionnaireSubmit")}
          </Button>
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
  /** @type {import("react").MutableRefObject<boolean>} */
  const sequenceSubmittedRef = useRef(false);

  const tiersSig = useMemo(() => tiers.map((x) => x.id).join("\x1e"), [tiers]);

  useEffect(() => {
    sequenceSubmittedRef.current = false;
    setAnswers(tiers.map(() => null));
    setViewIndex(0);
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

  const selectedValue = useMemo(() => {
    const fromAnswer = String(answers[safeTierIdx] ?? "").trim();
    if (fromAnswer) return fromAnswer;
    if (sentText == null) return undefined;
    if (tiers.length <= 1) return sentText.trim() || undefined;
    if (sentPieces.length >= tiers.length) return sentPieces[safeTierIdx] ?? undefined;
    return undefined;
  }, [answers, safeTierIdx, sentPieces.length, sentText, tiers.length]);

  const frozen = disabled || Boolean(sentText);
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
    },
    [frozen, unansweredIdx, onSelect, safeTierIdx, tiers, tiers.length],
  );

  if (!tiers?.length) return null;

  const pager = tiers.length > 1;
  const radioDisabled = frozen || (tiers.length > 1 && !canInteractRadios);

  return (
    <div className="chat-lab__quick-replies-shell">
      <div className="chat-lab__quick-replies">
        <div className="chat-lab__quick-replies__toolbar">
          {pager ? (
            <>
              <Button
                variant="text"
                size="small"
                type="button"
                className="chat-lab__quick-replies__pager-btn"
                disabled={frozen || viewIndex <= 0}
                aria-label={t("chatLab.quickReplyPrevAria")}
                onClick={() => setViewIndex((vi) => Math.max(0, vi - 1))}
              >
                {t("chatLab.quickReplyPrev")}
              </Button>
              <span className="chat-lab__quick-replies__step">
                {t("chatLab.quickReplyGroupStep", { current: safeTierIdx + 1, total: tiers.length })}
              </span>
              <Button
                variant="text"
                size="small"
                type="button"
                className="chat-lab__quick-replies__pager-btn"
                disabled={frozen || viewIndex >= tiers.length - 1}
                aria-label={t("chatLab.quickReplyNextAria")}
                onClick={() => setViewIndex((vi) => Math.min(tiers.length - 1, vi + 1))}
              >
                {t("chatLab.quickReplyNext")}
              </Button>
            </>
          ) : (
            <span className="chat-lab__quick-replies__title">{t("chatLab.quickReplyGroup")}</span>
          )}
        </div>
        <RadioGroup
          className="chat-lab__quick-replies__radios"
          layout="vertical"
          value={selectedValue}
          disabled={radioDisabled}
          aria-label={
            tiers.length > 1
              ? t("chatLab.quickReplyGroupStep", { current: safeTierIdx + 1, total: tiers.length })
              : t("chatLab.quickReplyGroup")
          }
          onChange={(val) => {
            const picked = String(val ?? "").trim();
            if (!picked || radioDisabled) return;
            if (tiers.length <= 1) onSelect(picked);
            else handleMultiPick(picked);
          }}
        >
          {options.map((o) => (
            <Radio key={o.id} value={o.sendText} className="chat-lab__quick-reply-radio">
              <span className="chat-lab__quick-reply-radio__text">
                <span className="chat-lab__quick-reply-radio__badge">{o.badge}.</span>
                {o.label}
              </span>
            </Radio>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
});

/** @param {string | undefined} kind */
function isLegacyDagMessageKind(kind) {
  if (typeof kind !== "string" || !kind) return false;
  return /^o[a-z]+_(internal|event|plan|anchor)$/.test(kind);
}

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
 *   };
 *   agents?: import("../studio/agents.js").LobsterAgent[];
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
 *   hideAgentHead?: boolean;
 *   embedded?: boolean;
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
  hideAgentHead = false,
  embedded = false,
  mentionAgents = [],
  collapseTracePanels = false,
  agents = [],
}) {
  const isUser = message.role === "user";
  if (message.messageKind === "group_member_event") {
    return (
      <div className="chat-lab__msg chat-lab__msg--group-event" data-message-id={message.id} role="status">
        <p className="chat-lab__group-event-text">{message.content}</p>
      </div>
    );
  }
  if (isLegacyDagMessageKind(message.messageKind)) {
    return null;
  }
  if (isUser && isSidebarAutomationInternalUserMessage(String(message.content ?? ""))) return null;

  const sidebarAutomationPending =
    !isUser &&
    isSidebarAutomationCarrierMessage(message, Boolean(message.streaming)) &&
    !(Array.isArray(message.toolTrace) && message.toolTrace.some((r) => isSidebarAutomationToolRow(r)));

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
  const toolRows = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const activityRows = Array.isArray(message.activityLog) ? message.activityLog : [];
  const subagentActivityRows = useMemo(() => {
    const fromLog = activityRows.filter((r) => String(r.stream ?? "").toLowerCase() === "subagent");
    const fromTools = deriveSubagentRowsFromToolTrace(toolRows, {
      streaming: Boolean(message.streaming),
    });
    return coalesceSubagentActivityRows(fromLog, fromTools, {
      streaming: Boolean(message.streaming),
    });
  }, [activityRows, toolRows, message.streaming]);
  // Parent turn streaming is authoritative; never fake "正在生成" after the turn ends.
  const bubbleStreaming = Boolean(message.streaming);
  const parentLifecycleEnded = useMemo(
    () =>
      activityRows.some(
        (r) =>
          String(r.stream ?? "").toLowerCase() === "lifecycle" &&
          isCompletedActivityPhase(r.phase),
      ),
    [activityRows],
  );
  const subagentBusy =
    bubbleStreaming &&
    !parentLifecycleEnded &&
    !(subagentActivityRows.length > 0 && areSubagentCardsSettled(subagentActivityRows)) &&
    (subagentActivityRows.some((row) => isRunningActivityRow(row)) ||
      toolTraceAwaitsSubagent(toolRows, { subagentCards: subagentActivityRows }));
  const generalActivityRows = useMemo(
    () =>
      activityRows.filter((r) => {
        const stream = String(r.stream ?? "").toLowerCase();
        return stream !== "subagent";
      }),
    [activityRows],
  );

  const showTyping =
    !isUser &&
    bubbleStreaming &&
    !message.content &&
    !message.thinking &&
    !message.error &&
    !interleavedAssistant;

  const interleavedTailBusy = interleavedAssistant && bubbleStreaming && !message.error;

  const previewApi = useContext(ChatLabPreviewContext);

  const mdComponents = useMemo(
    () => createChatLabMarkdownComponents(t, { streaming: bubbleStreaming }),
    [t, bubbleStreaming],
  );

  const [thinkOpen, setThinkOpen] = useState(() => Boolean(message.streaming));

  useEffect(() => {
    if (bubbleStreaming) setThinkOpen(true);
  }, [bubbleStreaming]);

  const streamingBusyLabel = useMemo(() => {
    if (!bubbleStreaming) return "";
    if (subagentBusy) {
      return t("chatLab.streamingAwaitSubagent");
    }
    return resolveStreamingBusyLabel({
      streaming: bubbleStreaming,
      timeline,
      toolRows,
      activityRows: generalActivityRows,
      subagentActivityRows,
      thinking: message.thinking,
      content: message.content,
      t,
    });
  }, [
    parentLifecycleEnded,
    subagentBusy,
    subagentActivityRows,
    bubbleStreaming,
    message.thinking,
    message.content,
    timeline,
    toolRows,
    generalActivityRows,
    t,
  ]);

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
        !embedded && "chat-lab__msg",
        !embedded && (isUser ? "chat-lab__msg--user" : "chat-lab__msg--assistant"),
        embedded && "chat-lab__msg-embedded",
        shouldEnterAnim && "chat-lab__msg--user-enter chat-lab__reveal-enter",
      )}
      data-message-id={message.id}
      data-message-role={message.role}
      {...(typeof message.agentId === "string" && message.agentId
        ? { "data-message-agent-id": message.agentId }
        : {})}
      onAnimationEnd={shouldEnterAnim ? handleUserEnterAnimEnd : undefined}
    >
      {isUser && (message.followUpRef || message.skillMeta || fileRefs.length > 0 || message.workflowName || message.messageKind === "automation_run") ?
        <div className="chat-lab__msg-meta-tags">
          {message.messageKind === "automation_run" ?
            <div className="chat-lab__msg-skill-pill chat-lab__msg-workflow-pill" title={t("chatLab.automationRunBadge")}>
              <Timer className="chat-lab__msg-workflow-icon" aria-hidden size={13} strokeWidth={2.2} />
              <span className="chat-lab__msg-skill-label">{t("chatLab.automationRunBadge")}</span>
            </div>
          : null}
          {message.workflowName ?
            <div
              className="chat-lab__msg-skill-pill chat-lab__msg-workflow-pill"
              title={String(message.workflowName)}
            >
              <GitBranch className="chat-lab__msg-workflow-icon" aria-hidden size={13} strokeWidth={2.2} />
              <span className="chat-lab__msg-skill-label">{message.workflowName}</span>
            </div>
          : null}
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
          {fileRefs.map((ref, idx) => (
            <button
              key={`${message.id}-fref-${idx}`}
              type="button"
              className="chat-lab__msg-skill-pill chat-lab__msg-file-pill"
              onClick={() => handleOpenFileRef(ref)}
              title={`${t("chatLab.messageFileRefOpen")}\n${ref.path}`}
              aria-label={t("chatLab.messageFileRefOpenNamed", { name: ref.name })}
            >
              <span className="chat-lab__msg-skill-emoji" aria-hidden>
                {emojiForFileRefKind(ref.kind === "directory" ? "directory" : "file")}
              </span>
              <span className="chat-lab__msg-skill-label">{ref.name}</span>
            </button>
          ))}
        </div>
      : null}
      {!isUser && agentName && !hideAgentHead ? (
        <div className="chat-lab__msg-agent-head">
          <Avatar
            src={agentGlyph}
            name={agentName}
            size="sm"
            shape="rounded"
          />
          <span className="chat-lab__msg-agent-name">{agentName}</span>
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
        {!isUser && !interleavedAssistant &&
        toolRows.some((r) => !isSessionsSpawnToolName(r.toolName)) ? (
          <ToolChainPanel
            rows={toolRows.filter((r) => !isSessionsSpawnToolName(r.toolName))}
            t={t}
            streaming={bubbleStreaming}
            keepCollapsed={collapseTracePanels}
          />
        ) : null}
        {!isUser && !interleavedAssistant &&
        generalActivityRows.length > 0 ? (
          <ActivityChainPanel
            rows={generalActivityRows}
            t={t}
            streaming={bubbleStreaming}
            keepCollapsed={collapseTracePanels}
          />
        ) : null}
        {!isUser && !interleavedAssistant &&
        subagentActivityRows.length > 0 ? (
          <div className="chat-lab__subagent-stack">
            {subagentActivityRows.map((row) => {
              const props = subagentStepPropsFromRow(row, t);
              return (
                <SubagentStepBlock
                  key={row.id}
                  title={props.title}
                  progress={props.progress}
                  active={props.active}
                  t={t}
                />
              );
            })}
          </div>
        ) : null}
        {!isUser && !interleavedAssistant && message.thinking ? (
          <TraceDisclosure
            className={cn("chat-lab__think", bubbleStreaming && "thinking-pulse-border")}
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
              activityRows={generalActivityRows}
              subagentRows={subagentActivityRows}
              mdComponents={mdComponents}
              t={t}
              streaming={bubbleStreaming}
              tailBusy={Boolean(interleavedTailBusy)}
              tailBusyLabel={streamingBusyLabel}
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
            {stripSidebarActionFences(String(message.content ?? "")) ? (
              <ChatLabMarkdownContent
                source={stripSidebarActionFences(String(message.content ?? ""))}
                components={mdComponents}
              />
            ) : showTyping ? (
              <ChatStreamingIndicator label={streamingBusyLabel} />
            ) : sidebarAutomationPending ? (
              <ChatStreamingIndicator label={t("chatLab.sidebarAutomationRunning")} />
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
          <ChatLabMentionAvatarGroup agents={mentionAgents} />
        </div>
      ) : null}
      {isUser || !bubbleStreaming ? (
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
            <Button
                variant="text"
                size="small"
              type="button"
              className="chat-lab__msg-collapse-btn"
              onClick={() => setUserLongExpanded(false)}
            >
              {t("chatLab.userMessageCollapse")}
            </Button>
          ) : null}
          <div className="chat-lab__msg-actions">
            <Button
                variant="text"
                shape="square"
                size="small"
              type="button"
              className={cn("chat-lab__msg-action-btn", copiedPulse && "chat-lab__msg-action-btn--copied")}
              onClick={handleCopy}
              disabled={!copyPlain.trim()}
              title={copiedPulse ? t("chatLab.messageCopied") : t("chatLab.messageCopy")}
              aria-label={copiedPulse ? t("chatLab.messageCopied") : t("chatLab.messageCopy")}
            >
              {copiedPulse ? <MessageMetaCopiedIcon /> : <MessageMetaCopyIcon />}
            </Button>
            {isUser ? (
              <Button
                variant="text"
                shape="square"
                size="small"
                type="button"
                className="chat-lab__msg-action-btn"
                onClick={startComposerEdit}
                disabled={disableUserEdit}
                title={t("chatLab.messageEdit")}
                aria-label={t("chatLab.messageEdit")}
              >
                <MessageMetaEditIcon />
              </Button>
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

/**
 * @param {{ mentions?: string[]; content?: string; role?: string; agentId?: string }} message/**
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
 * @param {import("../chat/chatLabWorkflowMessageLayout.js").ChatMessageRenderItem} item
 */
function renderItemDomKey(item) {
  if (item.kind === "message") return String(item.message.id ?? item.messageIndex);
  return `wf-group:${item.userMessageId}`;
}

/**
 * @param {import("../chat/chatLabWorkflowMessageLayout.js").ChatMessageRenderItem} item
 */
function estimateRenderItemHeight(item) {
  if (item.kind === "message") {
    const m = item.message;
    if (m.role === "user") {
      let h =
        m.skillMeta || m.followUpRef || m.workflowName || (Array.isArray(m.fileRefs) && m.fileRefs.length > 0)
          ? 118
          : 96;
      const textLen = String(m.content ?? "").length;
      h += Math.min(480, Math.ceil(textLen / 3.2));
      const n = Array.isArray(m.imageAttachments) ? m.imageAttachments.length : 0;
      if (n > 0) h += 56 + Math.min(n, 8) * 56;
      const mentionN = Array.isArray(m.mentions) ? m.mentions.length : 0;
      if (mentionN > 0) h += 30 + Math.min(mentionN - 1, 3) * 8;
      return h;
    }
    return estimateAssistantRowHeight(m);
  }
  let h = 64;
  let tallest = 120;
  for (const reply of item.replies) {
    tallest = Math.max(tallest, estimateAssistantRowHeight(reply.message));
  }
  return h + tallest;
}

/**
 * @param {{
 *   item: import("../chat/chatLabWorkflowMessageLayout.js").ChatMessageRenderItem;
 *   lastAssistantMessageId: string | null;
 *   renderMessageBubble: (
 *     message: Record<string, unknown>,
 *     opts: { messageIndex: number; hideAgentHead?: boolean; embedded?: boolean },
 *   ) => import("react").ReactNode;
 * }} args
 */
function renderChatLabMessageItem({ item, lastAssistantMessageId, renderMessageBubble }) {
  if (item.kind === "message") {
    return renderMessageBubble(item.message, { messageIndex: item.messageIndex });
  }
  if (item.replies.length === 1) {
    const reply = item.replies[0];
    return renderMessageBubble(reply.message, { messageIndex: reply.messageIndex });
  }
  return (
    <div
      key={renderItemDomKey(item)}
      className="chat-lab__msg chat-lab__msg--assistant chat-lab__msg--workflow-group"
      data-workflow-turn={item.userMessageId}
    >
      <ChatLabWorkflowReplyTabs replies={item.replies}>
        {(reply, { hideAgentHead }) =>
          renderMessageBubble(reply.message, {
            messageIndex: reply.messageIndex,
            hideAgentHead,
            embedded: true,
          })
        }
      </ChatLabWorkflowReplyTabs>
    </div>
  );
}

/**
 * @param {ChatLabMessageListProps} props
 */
function ChatLabMessageList(props) {
  if (props.messages.length <= CHAT_LAB_PLAIN_MESSAGE_MAX) {
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
}) {
  const mentionDisplayOpts = useMemo(
    () => ({ everyoneLabel: mentionEveryoneLabel, mainAgent, participantIds }),
    [mentionEveryoneLabel, mainAgent, participantIds],
  );
  const renderItems = useMemo(() => buildChatMessageRenderItems(messages, agentById), [messages, agentById]);
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return String(messages[i].id ?? "");
    }
    return null;
  }, [messages]);
  const messagesMeasureDigest = useMemo(
    () =>
      `${buildMessagesMeasureDigest(messages)}|${renderItems.length}|${buildGatewaySlicesDigest(gatewayStreamSlices)}`,
    [messages, renderItems.length, gatewayStreamSlices],
  );
  const streamingPinActive = gatewayStreaming || messages.some((m) => Boolean(m.streaming));
  const { onUserScrollAway, armPin, syncFromScroll } = useChatThreadScrollPin(
    autoScrollRef,
    streamingPinActive,
  );
  const scrollPinKey = renderItems.length
    ? `${conversationId}:${renderItems.length}:${renderItemDomKey(renderItems[renderItems.length - 1])}:${streamingPinActive ? 1 : 0}`
    : "";

  const handleScroll = useCallback(() => {
    syncFromScroll(messagesScrollRef.current);
  }, [messagesScrollRef, syncFromScroll]);

  const pinScrollRafRef = useRef(/** @type {number | null} */ (null));
  const pinPlainNow = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [autoScrollRef, messagesScrollRef]);
  const pinScrollToBottom = useCallback(() => {
    if (messages.length === 0) return;
    schedulePinChatScroll(messagesScrollRef.current, autoScrollRef, pinScrollRafRef);
  }, [autoScrollRef, messages.length, messagesScrollRef]);

  usePinChatOnContentGrowth(messagesScrollRef, autoScrollRef, messagesMeasureDigest, pinPlainNow);
  useStreamingChatPinLoop(streamingPinActive, messagesScrollRef, autoScrollRef, pinPlainNow);

  useLayoutEffect(() => {
    if (!conversationId || messages.length === 0) return;
    armPin();
    forcePinChatScroll(messagesScrollRef.current);
  }, [armPin, conversationId, messages.length, messagesScrollRef]);

  useLayoutEffect(() => {
    armPin();
    pinScrollToBottom();
  }, [scrollPinKey, armPin, pinScrollToBottom]);

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
        armPin();
        forcePinChatScroll(messagesScrollRef.current);
      },
      scrollToBottom: ({ animated = true } = {}) => {
        armPin();
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
  }, [armPin, messages, messagesScrollRef, threadScrollApiRef]);

  return (
    <div
      className="chat-lab__messages"
      ref={messagesScrollRef}
      onScroll={handleScroll}
      onWheel={(e) => {
        if (e.deltaY < 0) onUserScrollAway();
      }}
      role="log"
      aria-live="polite"
      aria-label={threadLabel}
    >
      {renderItems.map((item) => {
        const renderMessageBubble = (message, { messageIndex, hideAgentHead = false, embedded = false }) => {
          const agent = message.agentId ? agentById.get(String(message.agentId)) : null;
          return (
            <MessageBubble
              key={String(message.id ?? messageIndex)}
              message={message}
              t={t}
              locale={locale}
              streamLocked={streamLocked}
              animateUserEnter={message.role === "user" && message.id === userBubbleEnterMessageId}
              onUserEnterAnimEnd={onUserBubbleEnterAnimEnd}
              allowAssistantQuickReply={
                message.role === "assistant" && String(message.id ?? "") === lastAssistantMessageId
              }
              quickReplyDisabled={quickReplyDisabled}
              onQuickReply={onQuickReply}
              onBeginUserEdit={onBeginUserEdit}
              onFollowUpNavigate={onFollowUpNavigate}
              agentGlyph={agent ? agentAvatarGlyph(agent) : undefined}
              agentName={agent ? agentDisplayLabel(agent) : undefined}
              mentionAgents={mentionAgentsForMessage(message, agentById, mainAgentLabel, mentionDisplayOpts)}
              collapseTracePanels={collapseTracePanels}
              agents={agents}
              hideAgentHead={hideAgentHead}
              embedded={embedded}
            />
          );
        };
        return (
          <div key={renderItemDomKey(item)} className="chat-lab__msg-vrow">
            {renderChatLabMessageItem({ item, lastAssistantMessageId, renderMessageBubble })}
          </div>
        );
      })}
      {sessionArtifacts?.length && !gatewayStreaming ? (
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
  gatewayStreamSlices = [],
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
}) {
  const mentionDisplayOpts = useMemo(
    () => ({ everyoneLabel: mentionEveryoneLabel, mainAgent, participantIds }),
    [mentionEveryoneLabel, mainAgent, participantIds],
  );
  const renderItems = useMemo(() => buildChatMessageRenderItems(messages, agentById), [messages, agentById]);
  const renderItemsRef = useRef(renderItems);
  renderItemsRef.current = renderItems;
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return String(messages[i].id ?? "");
    }
    return null;
  }, [messages]);
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
    const item = renderItemsRef.current[index];
    if (!item) return 120;
    return estimateRenderItemHeight(item);
  }, []);

  const messagesMeasureDigest = useMemo(
    () =>
      `${buildMessagesMeasureDigest(messages)}|${renderItems.length}|${buildGatewaySlicesDigest(gatewayStreamSlices)}`,
    [messages, renderItems.length, gatewayStreamSlices],
  );
  const streamingPinActive = gatewayStreaming || messages.some((m) => Boolean(m.streaming));
  const { onUserScrollAway, armPin, syncFromScroll } = useChatThreadScrollPin(
    autoScrollRef,
    streamingPinActive,
  );
  const prevGatewayStreamingRef = useRef(gatewayStreaming);

  const getItemKey = useCallback((index) => renderItemDomKey(renderItemsRef.current[index] ?? { kind: "message", message: { id: index }, messageIndex: index }), []);

  const rowVirtualizer = useVirtualizer({
    count: renderItems.length,
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

  const pinVirtualRafRef = useRef(/** @type {number | null} */ (null));
  const pinVirtualToBottom = useCallback(() => {
    if (!autoScrollRef.current || renderItemsRef.current.length === 0) return;
    const run = () => {
      if (!autoScrollRef.current) return;
      const count = renderItemsRef.current.length;
      if (count === 0) return;
      vInstRef.current.measure();
      vInstRef.current.scrollToIndex(count - 1, { align: "end", behavior: "instant" });
    };
    run();
    if (pinVirtualRafRef.current != null) return;
    pinVirtualRafRef.current = requestAnimationFrame(() => {
      pinVirtualRafRef.current = null;
      run();
      requestAnimationFrame(run);
    });
  }, [autoScrollRef]);

  const handleScroll = useCallback(() => {
    syncFromScroll(messagesScrollRef.current);
    syncScrollbarMetrics();
    setScrollbarVisible(true);
    scheduleScrollbarHide();
  }, [messagesScrollRef, syncFromScroll, scheduleScrollbarHide, syncScrollbarMetrics]);

  usePinChatOnContentGrowth(messagesScrollRef, autoScrollRef, messagesMeasureDigest, pinVirtualToBottom);
  useStreamingChatPinLoop(streamingPinActive, messagesScrollRef, autoScrollRef, pinVirtualToBottom);

  const scrollPinKey = renderItems.length
    ? `${conversationId}:${renderItems.length}:${renderItemDomKey(renderItems[renderItems.length - 1])}:${streamingPinActive ? 1 : 0}`
    : "";

  useEffect(
    () => () => {
      if (scrollFadeTimerRef.current != null) window.clearTimeout(scrollFadeTimerRef.current);
      if (pinVirtualRafRef.current != null) cancelAnimationFrame(pinVirtualRafRef.current);
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
      onUserScrollAway();
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
    [messagesScrollRef, onUserScrollAway, scheduleScrollbarHide, scrollbarMetrics],
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

  const forcePinVirtualToBottom = useCallback(() => {
    const count = renderItemsRef.current.length;
    if (count === 0) return;
    const run = () => {
      vInstRef.current.measure();
      vInstRef.current.scrollToIndex(count - 1, { align: "end", behavior: "instant" });
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
  }, []);

  useLayoutEffect(() => {
    if (!conversationId || renderItems.length === 0) return;
    armPin();
    forcePinVirtualToBottom();
  }, [armPin, conversationId, forcePinVirtualToBottom, renderItems.length]);

  /** Pin when a new turn starts — not on every streaming token (messages reference churn). */
  useLayoutEffect(() => {
    armPin();
    pinVirtualToBottom();
  }, [scrollPinKey, armPin, pinVirtualToBottom]);

  /** Follow streaming growth only while the reader is already at the bottom. */
  useLayoutEffect(() => {
    pinVirtualToBottom();
  }, [messagesMeasureDigest, pinVirtualToBottom]);

  /** User-bubble enter anim + streaming row growth need a remeasure or the first turn can clip. */
  useLayoutEffect(() => {
    if (renderItems.length === 0) return;
    vInstRef.current.measure();
  }, [renderItems.length, userBubbleEnterMessageId, gatewayStreaming]);

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
      if (autoScrollRef.current && renderItemsRef.current.length > 0) {
        vInstRef.current.scrollToIndex(renderItemsRef.current.length - 1, { align: "end", behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [gatewayStreaming, autoScrollRef]);

  useLayoutEffect(() => {
    if (!remeasureKey || renderItems.length === 0) return;
    vInstRef.current.measure();
  }, [remeasureKey, renderItems.length]);

  useEffect(() => {
    const remeasure = () => {
      if (renderItemsRef.current.length === 0) return;
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
        armPin();
        forcePinVirtualToBottom();
      },
      scrollToBottom: ({ animated = true } = {}) => {
        armPin();
        const count = renderItemsRef.current.length;
        if (count === 0) return;
        const el = messagesScrollRef.current;
        vInstRef.current.measure();
        if (!animated || !el) {
          forcePinVirtualToBottom();
          return;
        }
        vInstRef.current.scrollToIndex(count - 1, { align: "end", behavior: "instant" });
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
  }, [armPin, messages, messagesScrollRef, threadScrollApiRef]);

  return (
    <>
      <div
        className="chat-lab__messages chat-lab__messages--virtual"
        ref={messagesScrollRef}
        onScroll={handleScroll}
        onWheel={(e) => {
          if (e.deltaY < 0) onUserScrollAway();
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
            const item = renderItems[virtualRow.index];
            const renderMessageBubble = (message, { messageIndex, hideAgentHead = false, embedded = false }) => {
              const agent = message.agentId ? agentById.get(String(message.agentId)) : null;
              return (
                <MessageBubble
                  key={String(message.id ?? messageIndex)}
                  message={message}
                  t={t}
                  locale={locale}
                  streamLocked={streamLocked}
                  animateUserEnter={message.role === "user" && message.id === userBubbleEnterMessageId}
                  onUserEnterAnimEnd={onUserBubbleEnterAnimEnd}
                  allowAssistantQuickReply={
                    message.role === "assistant" && String(message.id ?? "") === lastAssistantMessageId
                  }
                  quickReplyDisabled={quickReplyDisabled}
                  onQuickReply={onQuickReply}
                  onBeginUserEdit={onBeginUserEdit}
                  onFollowUpNavigate={onFollowUpNavigate}
                  agentGlyph={agent ? agentAvatarGlyph(agent) : undefined}
                  agentName={agent ? agentDisplayLabel(agent) : undefined}
                  mentionAgents={mentionAgentsForMessage(message, agentById, mainAgentLabel, mentionDisplayOpts)}
                  collapseTracePanels={collapseTracePanels}
                  agents={agents}
                  hideAgentHead={hideAgentHead}
                  embedded={embedded}
                />
              );
            };
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
                  ...(virtualRow.index < renderItems.length - 1 ? { paddingBottom: "0.85rem" } : {}),
                }}
              >
                {item
                  ? renderChatLabMessageItem({ item, lastAssistantMessageId, renderMessageBubble })
                  : null}
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
