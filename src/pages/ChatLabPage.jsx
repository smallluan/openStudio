import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavSettingsIcon from "../assets/svg/NavSettingsIcon.jsx";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  deriveTitleFromMessages,
  getSession,
  loadAllSessions,
  upsertSession,
} from "../chat/chatSessionsStore.js";
import { useI18n } from "../context/I18nContext.jsx";
import {
  useChatLabStreaming,
  useGatewayStreamSlice,
} from "../context/ChatLabStreamingContext.jsx";
import { cn } from "../ui/cn.js";

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
 * @param {{ content?: string; thinking?: string; error?: string }} extra
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
  const { t } = useI18n();
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
    /** @type {Array<{id: string; role: "user" | "assistant"; content: string; thinking?: string; streaming?: boolean; error?: string}>} */
    ([]),
  );
  const [input, setInput] = useState("");
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
  const messagesEndRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const messagesScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const autoScrollRef = useRef(true);

  const { beginGatewayStream, resetGatewayStream } = useChatLabStreaming();
  const gatewaySliceForConv = useGatewayStreamSlice(conversationId);
  const gatewayStreaming = Boolean(gatewaySliceForConv?.active);

  /** Switching threads clears send guards; finalize skips terminal events when conversationId mismatch left refs stuck. */
  useEffect(() => {
    activeAssistantIdRef.current = null;
    activeStreamIdRef.current = null;
  }, [conversationId]);

  /** Background OpenClaw prep for `#studio:` keys (does not block UI). */
  useEffect(() => {
    if (!isElectron || !bridge?.prewarmStudioGatewaySessions || !conversationId) return undefined;
    const ids = buildStudioGatewayPrewarmIds(conversationId, 12);
    if (ids.length === 0) return undefined;
    void bridge.prewarmStudioGatewaySessions({ conversationIds: ids, max: 12 }).catch(() => {});
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
      setMessages(
        rec.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking ? { thinking: m.thinking } : {}),
          streaming: false,
        })),
      );
      setChatApiBlocked(false);
      return;
    }
    if (messagesRef.current.length > 0) return;
    navigate("/chat", { replace: true });
  }, [navigate, paramC]);

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

  const scrollToBottomIfPinned = useCallback(() => {
    if (!autoScrollRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottomIfPinned();
  }, [messages, gatewayStreaming, scrollToBottomIfPinned]);

  const handleScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 80;
  }, []);

  useEffect(() => {
    if (!gatewaySliceForConv) return;
    const { assistantMessageId, content, thinking, active } = gatewaySliceForConv;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === assistantMessageId);
      if (idx === -1) return prev;
      return prev.map((m) =>
        m.id === assistantMessageId ? { ...m, content, thinking, streaming: active } : m,
      );
    });
  }, [gatewaySliceForConv]);

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

    if (!paramC) {
      setSearchParams({ c: conversationId }, { replace: true });
    }

    const systemMessage = { role: "system", content: t("chatLab.systemPrompt") };
    const historyForRequest = messagesRef.current
      .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content }));

    const userMsg = {
      id: newId(),
      role: /** @type {const} */ ("user"),
      content: trimmed,
    };
    const assistantMsg = {
      id: newId(),
      role: /** @type {const} */ ("assistant"),
      content: "",
      thinking: "",
      streaming: true,
    };

    const persistablePrior = messagesRef.current
      .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ...(m.thinking && String(m.thinking).trim() ? { thinking: m.thinking } : {}),
      }));
    const persistableNext = [
      ...persistablePrior,
      { id: userMsg.id, role: /** @type {const} */ ("user"), content: userMsg.content },
      { id: assistantMsg.id, role: /** @type {const} */ ("assistant"), content: "", thinking: "" },
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
        upsertSession(conversationId, r.title.trim(), rec.messages);
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
    resetGatewayStream,
    setSearchParams,
    t,
  ]);

  const stop = useCallback(async () => {
    const sid = activeStreamIdRef.current;
    if (!sid || !bridge?.abortChatStream) return;
    try {
      await bridge.abortChatStream(sid);
    } catch {
      /* ignore — the stream will emit `aborted` or `done` itself */
    }
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

  const sendButtonTitle = useMemo(() => {
    if (configIssueKey) return t(configIssueKey);
    if (!isElectron) return t("chatLab.electronOnly");
    if (!configLoaded) return t("chatLab.configLoadingPlaceholder");
    if (!configIssueKey && (gatewayPhase === "checking" || gatewayPhase === "offline" || chatApiBlocked)) {
      return t("chatLab.gatewayConnectingPlaceholder");
    }
    return undefined;
  }, [chatApiBlocked, configIssueKey, configLoaded, gatewayPhase, isElectron, t]);

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
            <button type="button" className="chat-lab__pill-btn" disabled title={t("chatLab.toolbarConnectHint")}>
              <span className="chat-lab__pill-ico" aria-hidden>
                ⎗
              </span>
              {t("chatLab.toolbarConnect")}
              <ToolbarChevron />
            </button>
          </div>
          <div className="chat-lab__shell-toolbar-end">
            {gatewayStreaming ? (
              <button type="button" className="btn-ghost chat-lab__shell-stop" onClick={stop}>
                {t("chatLab.stop")}
              </button>
            ) : null}
            <button
              type="button"
              className="chat-lab__attach"
              disabled
              aria-label={t("chatLab.attachHint")}
              title={t("chatLab.attachHint")}
            >
              <ChatPaperclipIcon />
            </button>
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
          <div
            className="chat-lab__messages"
            ref={messagesScrollRef}
            onScroll={handleScroll}
            role="log"
            aria-live="polite"
            aria-label={t("chatLab.title")}
          >
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} t={t} />
            ))}
            <div ref={messagesEndRef} aria-hidden />
          </div>
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

function ChatPaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.5 7.5 9 15a3 3 0 1 1 4.24 4.24l-7.07 7.07a5 5 0 1 1-7.07-7.07L16.11 6.28a3.5 3.5 0 1 1 4.95 4.95L10.5 22"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatSendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 17V7M12 7 7 12M12 7l5 5"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
 * @param {{
 *   message: { id: string; role: "user" | "assistant"; content: string; thinking?: string; streaming?: boolean; error?: string };
 *   t: (key: string, vars?: Record<string, string | number>) => string;
 * }} props
 */
function MessageBubble({ message, t }) {
  const isUser = message.role === "user";
  const showTyping =
    !isUser && message.streaming && !message.content && !message.thinking && !message.error;
  const [thinkOpen, setThinkOpen] = useState(() => Boolean(message.streaming));

  useEffect(() => {
    if (message.streaming) setThinkOpen(true);
  }, [message.streaming]);

  return (
    <article
      className={cn("chat-lab__bubble", isUser && "chat-lab__bubble--user")}
      data-role={message.role}
    >
      {!isUser && message.thinking ? (
        <details
          className={cn("chat-lab__think", message.streaming && "thinking-pulse-border")}
          open={thinkOpen}
          onToggle={(e) => setThinkOpen(e.currentTarget.open)}
        >
          <summary>
            {t("chatLab.thinking")}
            <span className="chat-lab__think-hint muted">· {t("chatLab.thinkingHint")}</span>
          </summary>
          <pre className="chat-lab__think-body">{message.thinking}</pre>
        </details>
      ) : null}
      {isUser ? (
        <div className="chat-lab__user-text">{message.content}</div>
      ) : (
        <div className="chat-lab__md">
          {message.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          ) : showTyping ? (
            <ChatStreamingIndicator label={t("chatLab.streaming")} />
          ) : !message.thinking && !message.error ? (
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
  );
}
