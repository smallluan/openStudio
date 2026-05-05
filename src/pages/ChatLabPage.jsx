import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import NavSettingsIcon from "../assets/svg/NavSettingsIcon.jsx";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  deriveTitleFromMessages,
  getSession,
  loadAllSessions,
  renameSession,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import { useI18n } from "../context/I18nContext.jsx";
import {
  useChatLabStreaming,
  useGatewayStreamSlice,
} from "../context/ChatLabStreamingContext.jsx";
import { createChatLabMarkdownComponents } from "../components/chat-lab/chatLabMarkdown.jsx";
import { TraceDisclosure, TraceRowChevron, TraceStepGlyph } from "../components/chat-lab/TraceDisclosure.jsx";
import { cn } from "../ui/cn.js";

/** Markdown pipelines for assistant bubbles (GFM + LaTeX via KaTeX). */
const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];
const CHAT_MD_REHYPE_PLUGINS = [rehypeKatex];

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
 * @param {Array<{role: string; content?: string; thinking?: string; error?: string}>} msgs
 */
function buildGatewayPayloadRows(msgs) {
  return msgs
    .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
    .map((m) => {
      if (m.role !== "assistant") return { role: m.role, content: m.content };
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
 * Compute whether the stored config is enough to make a chat call.
 * Returns a short locale key describing the first problem, or null when OK.
 * @param {*} cfg
 */
function deriveConfigIssueKey(cfg) {
  if (!cfg) return "chatLab.gatewayUrlMissing";
  const url = String(cfg.openclaw?.gatewayBaseUrl ?? "").trim();
  if (!url) return "chatLab.gatewayUrlMissing";
  return null;
}

/** @param {*} cfg @param {(k: string, v?: Record<string, string | number>) => string} tr */
function gatewayStatusLine(cfg, tr) {
  const url = String(cfg?.openclaw?.gatewayBaseUrl ?? "").trim();
  const badge = cfg?.openclaw?.hasGatewayToken ? tr("chatLab.gatewayTokenBadge") : "";
  const sk = String(cfg?.openclaw?.sessionKey ?? "agent:dev:dev").trim();
  if (!url) return null;
  return tr("chatLab.gatewayLine", { url, tokenBadge: badge, sessionKey: sk });
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
 * @param {{ content?: string; thinking?: string; error?: string; toolTrace?: unknown[]; activityLog?: unknown[] }} extra
 */
function mergeTerminalAssistantPayload(m, extra) {
  /** @type {*} */
  const next = { ...m, streaming: false };
  if (typeof extra?.content === "string") {
    const incoming = extra.content;
    const prev = String(m.content ?? "");
    if (incoming.trim().length > 0 || prev.trim().length === 0) {
      next.content = incoming;
    }
  }
  if (typeof extra?.thinking === "string") {
    const incoming = extra.thinking;
    const prev = String(m.thinking ?? "");
    if (incoming.trim().length > 0 || prev.trim().length === 0) {
      next.thinking = incoming;
    }
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

  const settingsLinkState = useMemo(
    () => ({ backgroundLocation: location }),
    [location],
  );
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const isElectron = Boolean(bridge?.startChatStream);

  const [config, setConfig] = useState(/** @type {* | null} */ (null));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [messages, setMessages] = useState(
    /** @type {Array<{id: string; role: "user" | "assistant"; content: string; thinking?: string; streaming?: boolean; error?: string; toolTrace?: import("../chat/toolTraceMerge.js").ToolTraceRow[]; activityLog?: import("../chat/toolTraceMerge.js").ActivityRow[]; createdAt?: number}>} */
    ([]),
  );
  const [input, setInput] = useState("");
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

  /** The id of the assistant bubble currently being filled (if any). */
  const activeAssistantIdRef = useRef(/** @type {string | null} */ (null));
  /** The streamId tracked by main process for abort. */
  const activeStreamIdRef = useRef(/** @type {string | null} */ (null));
  const messagesRef = useRef(messages);
  const messagesScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const autoScrollRef = useRef(true);

  const { beginGatewayStream, resetGatewayStream } = useChatLabStreaming();
  const gatewaySliceForConv = useGatewayStreamSlice(conversationId);
  const gatewayStreaming = Boolean(gatewaySliceForConv?.active);

  /** Switching threads clears send guards; finalize skips terminal events when conversationId mismatch left refs stuck. */
  useEffect(() => {
    activeAssistantIdRef.current = null;
    activeStreamIdRef.current = null;
    setPendingEditMessageId(null);
  }, [conversationId]);

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
    return deriveTitleFromMessages(messages);
  }, [conversationId, messages, sessionTitleBump]);

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
      const mapped = rec.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
        ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
        ...(typeof m.createdAt === "number" && Number.isFinite(m.createdAt) ? { createdAt: m.createdAt } : {}),
        streaming: false,
      }));
      setMessages(withBackfilledCreatedAt(mapped, rec.updatedAt));
      setChatApiBlocked(false);
      return;
    }
    if (messagesRef.current.length > 0) return;
    navigate("/chat", { replace: true });
  }, [navigate, paramC]);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [paramC]);

  useEffect(() => {
    if (!conversationId) return;
    if (messages.length === 0) return;

    const h = window.setTimeout(() => {
      const toSave = messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking && String(m.thinking).trim() ? { thinking: m.thinking } : {}),
          ...(Array.isArray(m.toolTrace) && m.toolTrace.length ? { toolTrace: m.toolTrace } : {}),
          ...(Array.isArray(m.activityLog) && m.activityLog.length ? { activityLog: m.activityLog } : {}),
          ...(typeof m.createdAt === "number" ? { createdAt: m.createdAt } : {}),
        }));
      if (toSave.length === 0) return;
      const title = deriveTitleFromMessages(messages);
      upsertSession(conversationId, title || "…", toSave);
    }, 380);

    return () => window.clearTimeout(h);
  }, [messages, conversationId]);

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
  }, [reloadConfig, location.pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => {
      if (document.visibilityState === "visible") reloadConfig();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reloadConfig]);

  const configIssueKey = useMemo(() => deriveConfigIssueKey(config), [config]);
  const gatewayLine = useMemo(() => (config ? gatewayStatusLine(config, t) : null), [config, t]);

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
    const { assistantMessageId, content, thinking, active, toolTrace, activityLog } = gatewaySliceForConv;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === assistantMessageId);
      if (idx === -1) return prev;
      return prev.map((m) => {
        if (m.id !== assistantMessageId) return m;
        const next = { ...m, content, thinking, streaming: active };
        if (toolTrace && toolTrace.length > 0) next.toolTrace = toolTrace;
        if (activityLog && activityLog.length > 0) next.activityLog = activityLog;
        return next;
      });
    });
  }, [gatewaySliceForConv, paramC]);

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

  const finalizeAssistantById = useCallback((assistantId, extra) => {
    if (!assistantId) return;
    activeAssistantIdRef.current = null;
    activeStreamIdRef.current = null;
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? mergeTerminalAssistantPayload(m, extra ?? {}) : m)),
    );
  }, []);

  useEffect(() => {
    /** @param {Event} e */
    const fn = (e) => {
      const ce = /** @type {CustomEvent} */ (e);
      const d = ce.detail;
      if (!d || d.conversationId !== conversationId) return;
      if (d.kind === "error") {
        const raw = String(d.message ?? "");
        const msg = formatStreamError(raw, t);
        finalizeAssistantById(d.assistantMessageId, {
          error: msg,
          ...(typeof d.content === "string" ? { content: d.content } : {}),
          ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
          ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
          ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
        });
        if (isChatHttp404(raw)) {
          setChatApiBlocked(true);
          setProbeRestartKey((k) => k + 1);
        }
        return;
      }
      if (d.kind === "aborted" || d.kind === "done") {
        finalizeAssistantById(d.assistantMessageId, {
          ...(typeof d.content === "string" ? { content: d.content } : {}),
          ...(typeof d.thinking === "string" ? { thinking: d.thinking } : {}),
          ...(Array.isArray(d.toolTrace) ? { toolTrace: d.toolTrace } : {}),
          ...(Array.isArray(d.activityLog) ? { activityLog: d.activityLog } : {}),
        });
      }
    };
    window.addEventListener("openstudio-gateway-chat-terminal", fn);
    return () => window.removeEventListener("openstudio-gateway-chat-terminal", fn);
  }, [conversationId, finalizeAssistantById, t]);

  const canSend =
    !gatewayStreaming &&
    input.trim().length > 0 &&
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

  const heroPlaceholder = useMemo(() => {
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
      const base = [
        ...prev.slice(0, idx),
        {
          ...prev[idx],
          content: trimmed,
          createdAt: typeof preservedCreated === "number" ? preservedCreated : Date.now(),
        },
      ];

      const priorRows = buildGatewayPayloadRows(base.slice(0, -1));
      const userText = String(base[base.length - 1]?.content ?? "").trim();

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
        })),
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
      autoScrollRef.current = true;

      activeStreamIdRef.current = streamId;
      activeAssistantIdRef.current = assistantMsg.id;

      const systemMessage = { role: "system", content: t("chatLab.systemPrompt") };
      const outgoing = [systemMessage, ...priorRows, { role: "user", content: userText }];

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

      try {
        await bridge.startChatStream({ streamId, conversationId, messages: outgoing });
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
      }
      return true;
    },
    [
      beginGatewayStream,
      bridge,
      chatApiBlocked,
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

  const send = useCallback(async () => {
    if (activeAssistantIdRef.current) return;
    if (messagesRef.current.some((m) => m.role === "assistant" && m.streaming)) return;
    if (gatewayStreaming) return;
    const trimmed = input.trim();
    if (!trimmed) return;
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

    if (!paramC) {
      setSearchParams({ c: conversationId }, { replace: true });
    }

    const systemMessage = { role: "system", content: t("chatLab.systemPrompt") };
    const historyForRequest = buildGatewayPayloadRows(messagesRef.current);

    const now = Date.now();
    const userMsg = {
      id: newId(),
      role: /** @type {const} */ ("user"),
      content: trimmed,
      createdAt: now,
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
      }));
    const persistableNext = [
      ...persistablePrior,
      {
        id: userMsg.id,
        role: /** @type {const} */ ("user"),
        content: userMsg.content,
        createdAt: userMsg.createdAt,
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
      })),
    );
    upsertSession(conversationId, provisionalTitle || "…", persistableNext);

    const streamId = newId();
    beginGatewayStream({
      conversationId,
      streamId,
      assistantMessageId: assistantMsg.id,
    });

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    autoScrollRef.current = true;

    activeStreamIdRef.current = streamId;
    activeAssistantIdRef.current = assistantMsg.id;

    const outgoing = [
      systemMessage,
      ...historyForRequest,
      { role: "user", content: trimmed },
    ];

    const isFirstTurn = historyForRequest.length === 0;
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

    try {
      await bridge.startChatStream({ streamId, conversationId, messages: outgoing });
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
    }
  }, [
    beginGatewayStream,
    bridge,
    chatApiBlocked,
    config,
    configIssueKey,
    conversationId,
    finalizeAssistantById,
    gatewayPhase,
    gatewayStreaming,
    input,
    isElectron,
    paramC,
    commitUserMessageEdit,
    resetGatewayStream,
    setSearchParams,
    t,
  ]);

  const stop = useCallback(() => {
    const sid = activeStreamIdRef.current;
    if (!sid || !bridge?.abortChatStream) return;
    void bridge.abortChatStream(sid).catch(() => {
      /* ignore — the stream will emit `aborted` or `done` itself */
    });
  }, [bridge]);

  const onKeyDown = useCallback(
    /** @param {import('react').KeyboardEvent<HTMLTextAreaElement>} e */
    (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (canSend) send();
      }
    },
    [canSend, send],
  );

  const isLanding = messages.length === 0;

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

  const beginComposerEdit = useCallback((messageId, content) => {
    setPendingEditMessageId(messageId);
    setInput(String(content ?? ""));
    autoScrollRef.current = true;
  }, []);

  const composer = (
    <div className={cn("chat-lab__composer-outer", isLanding && "chat-lab__composer-outer--landing")}>
      <div className={cn("chat-lab__shell", isLanding && "chat-lab__shell--hero")}>
        <textarea
          className="chat-lab__shell-textarea"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={heroPlaceholder}
          disabled={composerInputLocked}
          spellCheck
        />
        <div className="chat-lab__shell-toolbar">
          <div className="chat-lab__shell-toolbar-start">
            <button type="button" className="chat-lab__pill-btn" disabled title={t("chatLab.toolbarAutoHint")}>
              <span className="chat-lab__pill-ico" aria-hidden>
                ⦿
              </span>
              {t("chatLab.toolbarAuto")}
              <ToolbarChevron />
            </button>
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
            {gatewayStreaming ? (
              <button
                type="button"
                className="chat-lab__send-round chat-lab__send-round--stop"
                onClick={stop}
                title={t("chatLab.stop")}
                aria-label={t("chatLab.stop")}
              >
                <ChatStreamPauseIcon />
              </button>
            ) : (
              <button
                type="button"
                className={cn("chat-lab__send-round", canSend && "chat-lab__send-round--active")}
                disabled={!canSend}
                onClick={send}
                title={sendButtonTitle}
                aria-label={t("chatLab.send")}
              >
                <ChatSendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("chat-lab", isLanding && "chat-lab--landing", !isLanding && "chat-lab--thread")}>
      {isLanding ? (
        <>
          <div className="chat-lab__landing-top">
            <div className="chat-lab__landing-actions">
              <Link
                to="/settings"
                state={settingsLinkState}
                className="chat-lab__landing-settings"
                aria-label={t("chatLab.openSettings")}
                title={t("chatLab.openSettings")}
              >
                <NavSettingsIcon className="h-[22px] w-[22px] text-[var(--os-text-muted)]" />
              </Link>
            </div>
          </div>
          <div className="chat-lab__landing-mid">
            <div className="chat-lab__hero">
              <h1 className="chat-lab__hero-title">
                <span className="chat-lab__hero-hi">Hi,</span>{" "}
                {t("chatLab.heroGreeting", { brand: t("titlebar.appName") })}
                <span className="chat-lab__hero-star" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path
                      d="M10 2.2 11.8 7.2 17 7.2 13.1 10.4 14.6 15.8 10 12.7 5.4 15.8 6.9 10.4 3 7.2 8.2 7.2Z"
                      fill="var(--os-accent)"
                      fillOpacity="0.35"
                      stroke="var(--os-accent)"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </h1>
              <p className="chat-lab__hero-sub muted">{t("chatLab.heroSubtitle")}</p>
              {gatewayLine && !configIssueKey ? (
                <p className="chat-lab__hero-meta">{gatewayLine}</p>
              ) : null}
            </div>
          </div>
          {composer}
        </>
      ) : (
        <div className="chat-lab__thread-stack">
          <header className="chat-lab__conv-header">
            <h2 className="chat-lab__conv-title">{headerTitle || t("chatLab.chatUntitled")}</h2>
          </header>
          <ChatLabVirtualMessageList
            key={conversationId}
            messages={messages}
            messagesScrollRef={messagesScrollRef}
            autoScrollRef={autoScrollRef}
            gatewayStreaming={gatewayStreaming}
            streamLocked={streamLocked}
            onBeginUserEdit={beginComposerEdit}
            t={t}
            locale={locale}
            threadLabel={t("chatLab.title")}
          />
          {composer}
        </div>
      )}
    </div>
  );
}

function ToolbarChevron() {
  return (
    <svg
      className="chat-lab__pill-chevron"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ChatSendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
 * @param {{
 *   row: import("../chat/toolTraceMerge.js").ToolTraceRow;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
function ToolRow({ row, t }) {
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
      className="chat-lab__tool-nested"
      triggerClassName="chat-lab__tool-nested-summary"
      triggerAriaLabel={pres.aria}
      summary={
        <>
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
  const [open, setOpen] = useState(() => false);
  useEffect(() => {
    if (streaming) setOpen(true);
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
          <ToolRow key={row.id} row={row} t={t} />
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
 * }} props
 */
function ActivityRow({ row, t, streaming, isTail }) {
  const stream = truncateOneLine(String(row.stream ?? "").trim(), 64);
  const titleRaw = String(row.title ?? "").trim();
  const title = truncateOneLine(titleRaw || stream || "—", 104);
  const phase = String(row.phase ?? "").trim();
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
      className="chat-lab__tool-nested chat-lab__activity-nested"
      triggerClassName="chat-lab__tool-nested-summary"
      triggerAriaLabel={aria}
      summary={
        <>
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
  useEffect(() => {
    if (streaming) setOpen(true);
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
            key={`${r.id}-${r.stream}-${r.seq}`}
            row={r}
            t={t}
            streaming={streaming}
            isTail={Boolean(streaming) && idx === rows.length - 1}
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
 *     createdAt?: number;
 *   };
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   locale: import("../i18n/messages.js").LocaleId;
 *   streamLocked: boolean;
 *   onBeginUserEdit: (messageId: string, content: string) => void;
 * }} props
 */
const MessageBubble = memo(function MessageBubble({ message, t, locale, streamLocked, onBeginUserEdit }) {
  const isUser = message.role === "user";
  const showTyping =
    !isUser && message.streaming && !message.content && !message.thinking && !message.error;

  const mdComponents = useMemo(
    () => ({
      ...createChatLabMarkdownComponents(t),
      /** @param {import("react").AnchorHTMLAttributes<HTMLAnchorElement> & { children?: import("react").ReactNode }} props */
      a: ({ href, children }) => (
        <a href={href ?? "#"} target="_blank" rel="noreferrer noopener" className="chat-lab__md-a">
          {children}
        </a>
      ),
    }),
    [t],
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
    if (isUser) return String(message.content ?? "");
    const c = String(message.content ?? "").trim();
    const th = String(message.thinking ?? "").trim();
    const err = message.error ? String(message.error).trim() : "";
    const parts = /** @type {string[]} */ ([]);
    if (c) parts.push(c);
    if (th) parts.push(th);
    if (err) parts.push(err);
    return parts.join("\n\n---\n");
  }, [isUser, message.content, message.error, message.thinking]);

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
    onBeginUserEdit(message.id, String(message.content ?? ""));
  }, [message.content, message.id, onBeginUserEdit]);

  return (
    <div
      className={cn(
        "chat-lab__msg",
        isUser ? "chat-lab__msg--user" : "chat-lab__msg--assistant",
      )}
    >
      <article
        className={cn("chat-lab__bubble", isUser && "chat-lab__bubble--user")}
        data-role={message.role}
      >
        {!isUser && toolRows.length > 0 ? (
          <ToolChainPanel rows={toolRows} t={t} streaming={Boolean(message.streaming)} />
        ) : null}
        {!isUser && activityRows.length > 0 ? (
          <ActivityChainPanel rows={activityRows} t={t} streaming={Boolean(message.streaming)} />
        ) : null}
        {!isUser && message.thinking ? (
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
          <div className="chat-lab__user-text">{message.content}</div>
        ) : (
          <div className="chat-lab__md">
            {message.content ? (
              <ReactMarkdown
                remarkPlugins={CHAT_MD_REMARK_PLUGINS}
                rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
                components={mdComponents}
              >
                {message.content}
              </ReactMarkdown>
            ) : showTyping ? (
              <ChatStreamingIndicator label={t("chatLab.streaming")} />
            ) : !message.thinking && !message.error && toolRows.length === 0 && activityRows.length === 0 ? (
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
 *     createdAt?: number;
 *   }>;
 *   messagesScrollRef: import("react").MutableRefObject<HTMLDivElement | null>;
 *   autoScrollRef: import("react").MutableRefObject<boolean>;
 *   gatewayStreaming: boolean;
 *   streamLocked: boolean;
 *   onBeginUserEdit: (messageId: string, content: string) => void;
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 *   locale: LocaleId;
 *   threadLabel: string;
 * }} props
 */
function ChatLabVirtualMessageList({
  messages,
  messagesScrollRef,
  autoScrollRef,
  gatewayStreaming,
  streamLocked,
  onBeginUserEdit,
  t,
  locale,
  threadLabel,
}) {
  const messagesEstRef = useRef(messages);
  messagesEstRef.current = messages;

  const estimateSize = useCallback((index) => {
    const m = messagesEstRef.current[index];
    return m?.role === "user" ? 96 : 228;
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

  const handleScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 80;
  }, [messagesScrollRef, autoScrollRef]);

  /** Pin-to-bottom only when the transcript or stream phase changes — not on row height remeasure (e.g. tool panels). */
  useLayoutEffect(() => {
    if (!autoScrollRef.current || messages.length === 0) return;
    vInstRef.current.scrollToIndex(messages.length - 1, { align: "end", behavior: "instant" });
  }, [messages, gatewayStreaming, autoScrollRef]);

  return (
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
                onBeginUserEdit={onBeginUserEdit}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
