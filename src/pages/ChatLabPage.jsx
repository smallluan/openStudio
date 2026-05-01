import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../context/I18nContext.jsx";
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

export default function ChatLabPage() {
  const { t } = useI18n();
  const location = useLocation();
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
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState(/** @type {string | null} */ (null));
  const [gatewayPhase, setGatewayPhase] = useState(
    /** @type {"loading" | "checking" | "online" | "offline"} */ ("loading"),
  );
  const [gatewayProbeError, setGatewayProbeError] = useState(/** @type {string | null} */ (null));
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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    if (!isElectron || !bridge?.probeGateway) {
      setGatewayPhase("online");
      setGatewayProbeError(null);
      return undefined;
    }
    if (!configLoaded) {
      setGatewayPhase("loading");
      setGatewayProbeError(null);
      return undefined;
    }
    if (configIssueKey) {
      setGatewayPhase("online");
      setGatewayProbeError(null);
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
          setGatewayProbeError(null);
          setChatApiBlocked(false);
          setStreamError(null);
        } else {
          const msg = r?.message ? formatStreamError(r.message, t) : t("chatLab.gatewayUnreachable");
          setGatewayProbeError(msg);
          setGatewayPhase("offline");
          scheduleRetry();
        }
      } catch (err) {
        if (cancelled) return;
        setGatewayProbeError(formatStreamError(String(err?.message ?? err), t));
        setGatewayPhase("offline");
        scheduleRetry();
      }
    }

    runProbe();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [bridge, configIssueKey, configLoaded, isElectron, location.pathname, probeRestartKey, t]);

  const scrollToBottomIfPinned = useCallback(() => {
    if (!autoScrollRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottomIfPinned();
  }, [messages, streaming, scrollToBottomIfPinned]);

  const handleScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 80;
  }, []);

  const applyAssistantPatch = useCallback(
    /** @param {string} assistantId @param {(prev: {id:string; role:'assistant'; content:string; thinking?:string; streaming?:boolean; error?:string}) => any} patchFn */
    (assistantId, patchFn) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          return patchFn(m);
        }),
      );
    },
    [],
  );

  const finalizeActiveAssistant = useCallback(
    /** @param {{ error?: string } | undefined} extra */
    (extra) => {
      const assistantId = activeAssistantIdRef.current;
      activeAssistantIdRef.current = null;
      activeStreamIdRef.current = null;
      setStreaming(false);
      if (!assistantId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                streaming: false,
                ...(extra?.error ? { error: extra.error } : {}),
              }
            : m,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    if (!bridge) return undefined;
    return () => {
      const sid = activeStreamIdRef.current;
      activeStreamIdRef.current = null;
      activeAssistantIdRef.current = null;
      if (sid && bridge.abortChatStream) {
        try {
          bridge.abortChatStream(sid);
        } catch {
          /* ignore */
        }
      }
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.onChatStream) return undefined;
    const off = bridge.onChatStream((evt) => {
      if (!evt || typeof evt !== "object") return;
      const assistantId = activeAssistantIdRef.current;
      const expectedStreamId = activeStreamIdRef.current;
      if (evt.streamId && expectedStreamId && evt.streamId !== expectedStreamId) return;

      switch (evt.type) {
        case "thinking":
          if (!assistantId || typeof evt.delta !== "string") return;
          applyAssistantPatch(assistantId, (m) => ({
            ...m,
            thinking: (m.thinking ?? "") + evt.delta,
          }));
          return;
        case "text":
          if (!assistantId || typeof evt.delta !== "string") return;
          applyAssistantPatch(assistantId, (m) => ({
            ...m,
            content: (m.content ?? "") + evt.delta,
          }));
          return;
        case "meta":
        case "usage":
          return;
        case "aborted":
          finalizeActiveAssistant();
          return;
        case "error": {
          const raw = String(evt.message ?? "");
          const msg = formatStreamError(raw, t);
          setStreamError(msg);
          finalizeActiveAssistant({ error: msg });
          if (isChatHttp404(raw)) {
            setChatApiBlocked(true);
            setProbeRestartKey((k) => k + 1);
          }
          return;
        }
        case "done":
          finalizeActiveAssistant();
          return;
        default:
          return;
      }
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [applyAssistantPatch, bridge, finalizeActiveAssistant, t]);

  const canSend =
    !streaming &&
    input.trim().length > 0 &&
    isElectron &&
    configLoaded &&
    !configIssueKey &&
    gatewayPhase === "online" &&
    !chatApiBlocked;

  const composerInputLocked =
    !isElectron ||
    streaming ||
    !configLoaded ||
    (!configIssueKey && (gatewayPhase !== "online" || chatApiBlocked));

  const composerPlaceholder = useMemo(() => {
    if (!isElectron) return t("chatLab.placeholder");
    if (!configLoaded) return t("chatLab.configLoadingPlaceholder");
    if (
      !configIssueKey &&
      (gatewayPhase === "checking" || gatewayPhase === "offline" || chatApiBlocked)
    ) {
      return t("chatLab.gatewayConnectingPlaceholder");
    }
    return t("chatLab.placeholder");
  }, [chatApiBlocked, configIssueKey, configLoaded, gatewayPhase, isElectron, t]);

  const send = useCallback(async () => {
    if (streaming) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!isElectron || !bridge?.startChatStream) return;
    if (configIssueKey) {
      setStreamError(t(configIssueKey));
      return;
    }
    if (gatewayPhase !== "online" || chatApiBlocked) return;

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
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreamError(null);
    setStreaming(true);
    autoScrollRef.current = true;

    const streamId = newId();
    activeStreamIdRef.current = streamId;
    activeAssistantIdRef.current = assistantMsg.id;

    const outgoing = [
      systemMessage,
      ...historyForRequest,
      { role: "user", content: trimmed },
    ];

    try {
      await bridge.startChatStream({ streamId, messages: outgoing });
    } catch (err) {
      const raw = String(err?.message ?? err);
      const msg = formatStreamError(raw, t);
      setStreamError(msg);
      finalizeActiveAssistant({ error: msg });
      if (isChatHttp404(raw)) {
        setChatApiBlocked(true);
        setProbeRestartKey((k) => k + 1);
      }
    }
  }, [
    bridge,
    chatApiBlocked,
    configIssueKey,
    finalizeActiveAssistant,
    gatewayPhase,
    input,
    isElectron,
    streaming,
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

  const clearSession = useCallback(() => {
    if (streaming) return;
    setMessages([]);
    setStreamError(null);
    setChatApiBlocked(false);
    autoScrollRef.current = true;
  }, [streaming]);

  const rotateGatewaySessionKey = useCallback(async () => {
    if (!bridge?.setUserConfig || streaming) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
        : Date.now().toString(36);
    const nextKey = `agent:dev:os-${id}`;
    try {
      await bridge.setUserConfig({ openclaw: { sessionKey: nextKey } });
      await reloadConfig();
      setProbeRestartKey((k) => k + 1);
      clearSession();
    } catch (e) {
      setStreamError(formatStreamError(String(e?.message ?? e), t));
    }
  }, [bridge, clearSession, reloadConfig, streaming, t]);

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

  return (
    <div className="chat-lab">
      <header className="chat-lab__header">
        <div className="min-w-0">
          <h1 className="chat-lab__title">{t("chatLab.title")}</h1>
          <p className="chat-lab__subtitle muted">{t("chatLab.subtitle")}</p>
          {gatewayLine && !configIssueKey ? (
            <p className="mt-1 text-[0.78rem] text-[var(--os-text-muted)]">{gatewayLine}</p>
          ) : null}
        </div>
        <div className="chat-lab__header-actions">
          <Link
            to="/settings"
            state={settingsLinkState}
            className="btn-ghost chat-lab__settings-link"
          >
            {t("chatLab.openSettings")}
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={rotateGatewaySessionKey}
            disabled={streaming || !bridge?.setUserConfig || Boolean(configIssueKey)}
            title={t("chatLab.rotateSessionKeyHint")}
          >
            {t("chatLab.rotateSessionKey")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={clearSession}
            disabled={streaming || messages.length === 0}
          >
            {t("chatLab.clear")}
          </button>
        </div>
      </header>

      {!isElectron ? (
        <div className="chat-lab__callout chat-lab__callout--warn" role="status">
          {t("chatLab.electronOnly")}
        </div>
      ) : null}

      {isElectron && configLoaded && configIssueKey ? (
        <div className="chat-lab__callout chat-lab__callout--warn" role="status">
          {t(configIssueKey)}
        </div>
      ) : null}

      {isElectron && configLoaded && !configIssueKey && gatewayProbeError && gatewayPhase === "offline" ? (
        <div className="chat-lab__callout chat-lab__callout--warn" role="status">
          <div>{gatewayProbeError}</div>
          <p className="mt-1 mb-0 text-[0.78rem] opacity-90">{t("chatLab.gatewayRetryHint")}</p>
        </div>
      ) : null}

      {streamError ? (
        <div className="chat-lab__callout chat-lab__callout--err" role="alert">
          {streamError}
        </div>
      ) : null}

      <div
        className="chat-lab__messages"
        ref={messagesScrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label={t("chatLab.title")}
      >
        {messages.length === 0 ? (
          <p className="chat-lab__empty muted">{t("chatLab.emptyHint")}</p>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} t={t} />
          ))
        )}
        <div ref={messagesEndRef} aria-hidden />
      </div>

      <div className="chat-lab__composer">
        <textarea
          className="chat-lab__input"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={composerPlaceholder}
          disabled={composerInputLocked}
          spellCheck
        />
        <div className="chat-lab__composer-row">
          <span className="chat-lab__hint muted">{t("chatLab.shortcutHint")}</span>
          <div className="chat-lab__btns">
            {streaming ? (
              <button type="button" className="btn-ghost" onClick={stop}>
                {t("chatLab.stop")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              onClick={send}
              disabled={!canSend}
              title={
                configIssueKey
                  ? t(configIssueKey)
                  : !isElectron
                    ? t("chatLab.electronOnly")
                    : !configLoaded
                      ? t("chatLab.configLoadingPlaceholder")
                      : !configIssueKey && (gatewayPhase === "checking" || gatewayPhase === "offline" || chatApiBlocked)
                        ? t("chatLab.gatewayConnectingPlaceholder")
                        : undefined
              }
            >
              {t("chatLab.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
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
  const roleLabel = isUser ? t("chatLab.roleUser") : t("chatLab.roleAssistant");
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
      <div className="chat-lab__bubble-role">{roleLabel}</div>
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
            <span className="chat-lab__typing muted">
              <span className="playground-live-dot" aria-hidden /> {t("chatLab.streaming")}
            </span>
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
