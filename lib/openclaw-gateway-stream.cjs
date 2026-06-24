/**
 * Stream chat via the local OpenClaw Gateway WebSocket RPC.
 *
 * See openclaw-gateway-ws.cjs for protocol notes. Chat runs on a **persistent**
 * session (openclaw-gateway-session.cjs) so turns do not pay a full reconnect /
 * handshake tax. Studio scopes **gateway chat sessions** per conversation via
 * `sessionKey` suffix (`#studio:<conversationId>`) while the WebSocket pool still
 * keys off the configured base session key only — see `openclaw-gateway-session.cjs`.
 */

const { randomUUID } = require("crypto");
const { resolveGateway } = require("./openclaw-gateway-ws.cjs");
const { getStudioLog } = require("./studio-logger.cjs");
const {
  acquireGatewaySession,
  enqueueHydrateChatPrep,
  isGatewaySessionPrepReady,
  markGatewaySessionPrepReady,
  resolveStudioGatewaySessionKey,
  sanitizeConversationIdSegment,
} = require("./openclaw-gateway-session.cjs");
const {
  WECHAT_CHAT_SEND_PREFIX,
  sanitizeWechatAssistantHistoryContent,
} = require("./wechat-gateway-message.cjs");
const { extractUsageFromChatPayload } = require("./token-usage-extract.cjs");
const { readSessionUsageSinceWithRetry } = require("./token-usage-session.cjs");

const CHAT_STREAM_IMMEDIATE_TYPES = new Set([
  "meta",
  "text",
  "thinking",
  "content_sync",
  "usage",
  "error",
  "aborted",
  "done",
  "info",
]);

/**
 * Batch non-critical IPC events (tool_trace / agent_activity) to reduce renderer churn.
 * @param {(evt: { type: string } & Record<string, unknown>) => void} onEvent
 */
function createChatStreamEmitter(onEvent) {
  if (process.env.OPEN_STUDIO_GATEWAY_EVENT_BATCH === "0") return onEvent;

  /** @type {Array<{ type: string } & Record<string, unknown>>} */
  let batch = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  const flush = () => {
    if (!batch.length) return;
    const pending = batch;
    batch = [];
    for (const evt of pending) onEvent(evt);
  };

  return (evt) => {
    if (!evt || typeof evt !== "object") return;
    if (CHAT_STREAM_IMMEDIATE_TYPES.has(evt.type)) {
      flush();
      onEvent(evt);
      return;
    }
    batch.push(evt);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, 75);
    }
  };
}

const PROBE_TIMEOUT_MS = 20_000;
/** If neither chat nor agent stream frames arrive for this long after `chat.send`
 * accepts, fail fast. Override via `OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS`
 * (milliseconds, min 30000). RPC completions (`tools.*`, `sessions.*`) do **not**
 * reset this timer — only WebSocket push `event` frames do — so embedded runs that
 * stay silent on the event channel need a generous default. */
function resolveStreamNoProgressTimeoutMs() {
  const raw = process.env.OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS?.trim();
  if (!raw) return 600_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 30_000 ? n : 600_000;
}
const STREAM_NO_PROGRESS_TIMEOUT_MS = resolveStreamNoProgressTimeoutMs();

/**
 * Deep-clone JSON-serializable subtrees for IPC (truncate large strings / deep trees).
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function jsonSafeDeep(value, depth = 0) {
  if (depth > 10) return "[Deep]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.length > 16_000 ? `${value.slice(0, 16_000)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 400).map((v) => jsonSafeDeep(v, depth + 1));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    const entries = Object.entries(value);
    for (let i = 0; i < entries.length && i < 120; i++) {
      const [k, v] = entries[i];
      out[k] = jsonSafeDeep(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/**
 * OpenAI-style nested `delta.reasoning` object (`{ content: [{ text }] }`).
 * @param {any} r
 * @returns {string}
 */
function extractReasoningObjectChunk(r) {
  if (!r || typeof r !== "object") return "";
  const arr = Array.isArray(r.content) ? r.content : [];
  return arr.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("");
}

/**
 * Walk gateway/OpenAI-style content part arrays (possibly nested).
 * @param {unknown[]} parts
 * @param {number} depth
 * @returns {{ text: string; thinking: string }}
 */
function walkContentParts(parts, depth) {
  if (!Array.isArray(parts) || depth > 8) return { text: "", thinking: "" };
  let text = "";
  let thinking = "";
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    /** @type {any} */ const raw = part;
    if (raw.thought === true && typeof raw.text === "string" && raw.text) {
      thinking += raw.text;
      continue;
    }
    const pt = raw.type;
    if (
      pt === "text" ||
      pt === "output_text" ||
      pt === "input_text" ||
      pt === "text_delta" ||
      pt === "output_text_delta"
    ) {
      const v =
        typeof raw.text === "string"
          ? raw.text
          : typeof raw.content === "string"
            ? raw.content
            : typeof raw.delta === "string"
              ? raw.delta
              : "";
      text += v;
    } else if (
      pt === "thinking" ||
      pt === "reasoning" ||
      pt === "reasoning_content" ||
      pt === "thinking_delta" ||
      pt === "reasoning_delta"
    ) {
      const v =
        typeof raw.delta === "string"
          ? raw.delta
          : typeof raw.thinking === "string"
            ? raw.thinking
            : typeof raw.content === "string"
              ? raw.content
              : typeof raw.text === "string"
                ? raw.text
                : "";
      thinking += v;
    }
    if (Array.isArray(raw.content)) {
      const sub = walkContentParts(raw.content, depth + 1);
      text += sub.text;
      thinking += sub.thinking;
    }
  }
  return { text, thinking };
}

/**
 * Extract text + thinking content from a chat event message snapshot.
 * The server sends a *replacement* snapshot per delta, not an append.
 * @param {any} message
 * @returns {{ text: string; thinking: string }}
 */
function extractMessageSnapshot(message) {
  if (!message || typeof message !== "object") return { text: "", thinking: "" };
  /** @type {any} */ const m = message;

  let reasoningPrefix = "";
  if (typeof m.reasoning_content === "string") reasoningPrefix += m.reasoning_content;
  if (typeof m.reasoning === "string") reasoningPrefix += m.reasoning;
  else if (m.reasoning && typeof m.reasoning === "object") reasoningPrefix += extractReasoningObjectChunk(m.reasoning);

  /** OpenAI-style aggregated chunks (`choices[].delta` / `message`). */
  if (Array.isArray(m.choices) && m.choices.length > 0) {
    let aggText = "";
    let aggThink = "";
    for (const ch of m.choices) {
      if (!ch || typeof ch !== "object") continue;
      const d = ch.delta && typeof ch.delta === "object" ? ch.delta : ch.message;
      if (!d || typeof d !== "object") continue;
      if (typeof d.content === "string") aggText += d.content;
      if (Array.isArray(d.content)) {
        const w = walkContentParts(d.content, 0);
        aggText += w.text;
        aggThink += w.thinking;
      }
      if (typeof d.text === "string") aggText += d.text;
      if (typeof d.reasoning_content === "string") aggThink += d.reasoning_content;
      if (typeof d.reasoning === "string") aggThink += d.reasoning;
      else if (d.reasoning && typeof d.reasoning === "object") aggThink += extractReasoningObjectChunk(d.reasoning);
    }
    if (aggText.trim() || aggThink.trim()) {
      return { text: aggText, thinking: reasoningPrefix + aggThink };
    }
  }

  if (typeof m.output === "string" && m.output.trim()) {
    return { text: m.output, thinking: reasoningPrefix };
  }

  if (typeof m.text === "string") return { text: m.text, thinking: reasoningPrefix };
  if (typeof m.content === "string") return { text: m.content, thinking: reasoningPrefix };

  let text = "";
  let thinking = reasoningPrefix;

  if (Array.isArray(m.content)) {
    const w = walkContentParts(m.content, 0);
    text += w.text;
    thinking += w.thinking;
  }

  for (const key of ["parts", "blocks"]) {
    if (!Array.isArray(m[key])) continue;
    const w = walkContentParts(m[key], 0);
    text += w.text;
    thinking += w.thinking;
  }

  return { text, thinking };
}

/**
 * Same chat event may carry reasoning on `payload.message` and/or sibling fields. Prefer the longer
 * cumulative snapshot when one extends the other.
 * @param {string} a
 * @param {string} b
 */
function mergeThinkingSlices(a, b) {
  const sa = typeof a === "string" ? a : "";
  const sb = typeof b === "string" ? b : "";
  const ta = sa.trim();
  const tb = sb.trim();
  if (!tb) return sa;
  if (!ta) return sb;
  if (tb.startsWith(ta)) return sb;
  if (ta.startsWith(tb)) return sa;
  if (ta === tb) return sa.length >= sb.length ? sa : sb;
  return `${sa.replace(/\s+$/u, "")}\n\n${sb.replace(/^\s+/u, "")}`;
}

/**
 * Prefer `payload.message` for **text** (canonical assistant body). Reasoning may live only on the
 * outer payload (or only inside nested `delta.reasoning` objects); merging avoids dropping it when
 * `message` already has non-empty `text` but empty `thinking`.
 * @param {any} p chat event payload
 */
function extractChatPayloadSnapshot(p) {
  const fromMsg = extractMessageSnapshot(p?.message);
  if (!p || typeof p !== "object") return fromMsg;

  const clone = { ...p };
  delete clone.message;
  delete clone.sessionKey;
  delete clone.runId;
  delete clone.state;
  delete clone.errorMessage;
  const fromRest = extractMessageSnapshot(clone);

  const text = fromMsg.text.trim() ? fromMsg.text : fromRest.text;
  const thinking = mergeThinkingSlices(fromMsg.thinking, fromRest.thinking);

  return { text, thinking };
}

/**
 * @param {unknown} s
 */
function formatComposerSkillDirective(s) {
  if (!s || typeof s !== "object") return "";
  const kind = /** @type {{ kind?: unknown }} */ (s).kind;
  if (kind === "openclaw") {
    const slug = String(/** @type {{ slug?: unknown }} */ (s).slug ?? "").trim();
    const label = String(/** @type {{ label?: unknown }} */ (s).label ?? "").trim();
    if (!slug) return "";
    const labelBit = label ? ` (${label})` : "";
    return `[OpenClaw skill: ${slug}]${labelBit} Please follow this bundled SKILL when it applies to the user's request.`;
  }
  if (kind === "user") {
    const label = String(/** @type {{ label?: unknown }} */ (s).label ?? "").trim();
    const desc = String(/** @type {{ description?: unknown }} */ (s).description ?? "").trim();
    const localPath = String(/** @type {{ localPath?: unknown }} */ (s).localPath ?? "").trim();
    if (!label) return "";
    const parts = [label];
    if (desc) parts.push(desc);
    if (localPath) parts.push(`Path: ${localPath}`);
    return `[User-registered skill] ${parts.join(" — ")}`;
  }
  return "";
}

/**
 * Structured image rows for OpenClaw `chat.send`. Only the latest user bubble should carry these
 * — see Studio `buildGatewayPayloadRows(_, { includeImageAttachments: true })`.
 * @param {unknown[]} messages
 * @returns {unknown[] | undefined}
 */
function extractLatestUserAttachments(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== "object" || /** @type {{ role?: string }} */ (m).role !== "user") continue;
    const raw = /** @type {{ attachments?: unknown }} */ (m).attachments;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    return undefined;
  }
  return undefined;
}

/**
 * @param {string} body
 * @returns {{ label: string; body: string } | null}
 */
function peelEmbeddedHistoryBody(body) {
  const trimmed = String(body ?? "").trim();
  const groupMatch = /^\[群聊 · ([^\]]+)\]:\s*([\s\S]*)$/u.exec(trimmed);
  if (groupMatch?.[1]) {
    return { label: `Agent · ${groupMatch[1].trim()}`, body: groupMatch[2].trim() || trimmed };
  }
  const youMatch = /^\[You · ([^\]]+)\]:\s*([\s\S]*)$/u.exec(trimmed);
  if (youMatch?.[1]) {
    return { label: `You · ${youMatch[1].trim()}`, body: youMatch[2].trim() || trimmed };
  }
  return null;
}

/**
 * Speaker label for embedded Studio history. Other agents must not appear as bare "Assistant"
 * (models treat that as their own prior output).
 * @param {{ role?: string; content?: string }} m
 */
function historySpeakerLabel(m) {
  if (!m || typeof m !== "object") return "Unknown";
  const body = String(m.content ?? "").trim();
  const peeled = peelEmbeddedHistoryBody(body);
  if (peeled) return peeled.label;
  if (m.role === "user") return "User";
  const selfMatch = /^\[([^\]]+)\]:\s*/u.exec(body);
  if (selfMatch?.[1]) return `You · ${selfMatch[1].trim()}`;
  return "Assistant";
}

/**
 * `chat.send` only accepts one user string; embed prior turns when Studio must bootstrap or
 * deliver a delta since the agent's last sync cursor.
 * @param {Array<{ role: string; content: string }>} messages
 * @param {unknown} [composerSkill]
 * @param {{ channel?: "internal" | "wechat"; contextEmbedMode?: "none" | "bootstrap" | "incremental" | "full"; threadSummaryPrefix?: string }} [opts]
 */
function buildChatSendMessage(messages, composerSkill, opts = {}) {
  if (!Array.isArray(messages)) return "";
  const channel = opts.channel === "wechat" ? "wechat" : "internal";
  const embedMode = opts.contextEmbedMode ?? "full";
  const systemParts = messages
    .filter((m) => m && typeof m === "object" && m.role === "system")
    .map((m) => String(m.content ?? "").trim())
    .filter(Boolean);
  const turns = messages.filter(
    (m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant"),
  );
  let lastUserIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return "";
  const rawLatest = String(turns[lastUserIdx].content ?? "").trim();
  if (!rawLatest) return "";
  const peeledLatest = peelEmbeddedHistoryBody(rawLatest);
  let latest = peeledLatest?.body ?? rawLatest;
  let currentHeading =
    peeledLatest?.label?.startsWith("Agent ·")
      ? `Reply as yourself — ${peeledLatest.label} @mentioned you:`
      : "Current user message:";
  const hint = formatComposerSkillDirective(composerSkill).trim();
  if (hint) {
    latest = `${hint}\n\n${latest}`;
  }
  const prior = embedMode === "none" ? [] : turns.slice(0, lastUserIdx);
  /** @type {string[]} */
  const chunks = [];
  if (systemParts.length) {
    chunks.push("[System instructions]", systemParts.join("\n\n"), "");
  }
  if (channel === "wechat") {
    chunks.push(WECHAT_CHAT_SEND_PREFIX, "");
  }

  if (prior.length === 0) {
    if (peeledLatest?.label?.startsWith("Agent ·")) {
      chunks.push(currentHeading, latest);
    } else {
      chunks.push(latest);
    }
    return chunks.join("\n");
  }

  const summaryPrefix =
    typeof opts.threadSummaryPrefix === "string" ? opts.threadSummaryPrefix.trim() : "";
  const embedIntro =
    embedMode === "incremental"
      ? "New turns since your last reply in this Studio thread:"
      : embedMode === "bootstrap"
        ? "Thread context (summary of earlier turns plus recent messages):"
        : "Earlier turns from this Studio thread (included because gateway session memory may not replay the full transcript on every chat.send):";

  const lines = [embedIntro, ""];
  if (summaryPrefix) {
    lines.push(summaryPrefix, "");
  }
  for (const m of prior) {
    const rawBody = String(m.content ?? "").trim();
    const peeled = peelEmbeddedHistoryBody(rawBody);
    const label = peeled?.label ?? historySpeakerLabel(m);
    let body = peeled?.body ?? rawBody;
    if (channel === "wechat" && m.role === "assistant") {
      body = sanitizeWechatAssistantHistoryContent(body);
    }
    lines.push(`${label}: ${body || "(no visible text)"}`);
    lines.push("");
  }
  lines.push(currentHeading);
  lines.push(latest);
  chunks.push(lines.join("\n"));
  return chunks.join("\n");
}

/**
 * @param {unknown} cfg
 * @param {Array<{ role: string; content: string }>} messages
 * @param {AbortSignal} signal
 * @param {(evt: { type: string } & Record<string, unknown>) => void} onEvent
 * @param {{ conversationId?: string; composerSkill?: unknown; channel?: "internal" | "wechat"; wechatPeerId?: string; deliver?: boolean; agentSessionKey?: string }} [opts]
 */
async function dispatchOpenClawGatewayStream(cfg, messages, signal, onEvent, opts = {}) {
  const resolved = resolveGateway(cfg);
  return dispatchOpenClawGatewayStreamWithResolved(resolved, messages, signal, onEvent, opts);
}

/**
 * @param {{ baseUrl: string; wsUrl: string; token: string; sessionKey: string }} resolved
 * @param {Array<{ role: string; content: string }>} messages
 * @param {AbortSignal} signal
 * @param {(evt: { type: string } & Record<string, unknown>) => void} onEvent
 * @param {{ conversationId?: string; uiConversationId?: string; composerSkill?: unknown; channel?: "internal" | "wechat"; wechatPeerId?: string; deliver?: boolean; agentSessionKey?: string }} [opts]
 */
async function dispatchOpenClawGatewayStreamWithResolved(resolved, messages, signal, onEvent, opts = {}) {
  const log = getStudioLog();
  const startedAt = Date.now();
  let firstDeltaAt = /** @type {number | null} */ (null);
  const emit = createChatStreamEmitter((evt) => {
    if (!firstDeltaAt && (evt.type === "text" || evt.type === "thinking")) {
      firstDeltaAt = Date.now();
      log.info("[chat.send.perf] first_delta", {
        elapsedMs: firstDeltaAt - startedAt,
        type: evt.type,
      });
    }
    onEvent(evt);
  });

  const { baseUrl, sessionKey: resolvedSessionKey } = resolved;
  const baseSessionKey =
    typeof opts.agentSessionKey === "string" && opts.agentSessionKey.trim()
      ? opts.agentSessionKey.trim()
      : resolvedSessionKey;
  const conversationId = typeof opts.conversationId === "string" ? opts.conversationId.trim() : "";
  const uiConversationId =
    typeof opts.uiConversationId === "string" ? opts.uiConversationId.trim() : conversationId;
  const channel = opts?.channel === "wechat" ? "wechat" : "internal";
  const wechatPeerId = typeof opts?.wechatPeerId === "string" ? opts.wechatPeerId.trim() : "";
  const sessionKey = resolveStudioGatewaySessionKey(baseSessionKey, conversationId);
  const wechatAutoReply = uiConversationId.startsWith("wechat:");
  if (wechatAutoReply) {
    log.info("[chat.send] wechat auto-reply gateway", {
      uiConversationId,
      gatewayConversationId: conversationId,
      sessionKey,
      channel,
      messageChars: buildChatSendMessage(messages, opts.composerSkill, { channel }).length,
    });
  }

  emit({
    type: "meta",
    vendor: "openclaw",
    model: "openclaw/default",
    profileId: "",
    profileLabel: "",
    gatewayBaseUrl: baseUrl,
    sessionKey,
    channel,
    wechatPeerId: wechatPeerId || undefined,
  });

  const userMessage = buildChatSendMessage(messages, opts.composerSkill, {
    channel,
    contextEmbedMode: opts.contextEmbedMode,
    threadSummaryPrefix: opts.threadSummaryPrefix,
  });
  if (!userMessage.trim()) {
    throw new Error("empty_user_message");
  }
  const chatAttachments = extractLatestUserAttachments(messages);

  /** OpenClaw sets `clientRunId = idempotencyKey`; streamed frames use that run id. */
  const runRef = { id: randomUUID() };

  const client = await acquireGatewaySession(resolved, signal);

  if (!isGatewaySessionPrepReady(sessionKey)) {
    try {
      await enqueueHydrateChatPrep(
        async () => {
          if (isGatewaySessionPrepReady(sessionKey)) return;
          try {
            await client.request("sessions.create", { key: sessionKey });
          } catch {
            /* session may already exist */
          }
          try {
            await client.request("tools.effective", { sessionKey });
          } catch {
            /* best-effort — gateway may already have handles */
          }
          markGatewaySessionPrepReady(sessionKey);
        },
        { urgent: true, sessionKey },
      );
    } catch (e) {
      log.warn("[gateway_session] hydrate_before_send skipped", {
        sessionKey,
        message: /** @type {any} */ (e)?.message ?? String(e ?? ""),
      });
    }
  }

  let lastText = "";
  let lastThinking = "";
  let loggedFirstChatEvent = false;

  /**
   * Emit assistant prose deltas; ignore regressive snapshots that would truncate streamed text.
   * @param {{ text: string; thinking: string }} snap
   */
  function emitChatSnapshotDeltas(snap) {
    if (snap.thinking.length > lastThinking.length && snap.thinking.startsWith(lastThinking)) {
      const delta = snap.thinking.slice(lastThinking.length);
      lastThinking = snap.thinking;
      emit({ type: "thinking", delta });
    } else if (snap.thinking !== lastThinking) {
      if (lastThinking.startsWith(snap.thinking)) {
        /* shorter thinking snapshot — keep accumulated */
      } else if (snap.thinking.startsWith(lastThinking)) {
        const delta = snap.thinking.slice(lastThinking.length);
        lastThinking = snap.thinking;
        if (delta) emit({ type: "thinking", delta });
      } else if (snap.thinking) {
        lastThinking = snap.thinking;
        emit({
          type: "content_sync",
          content: lastText,
          thinking: snap.thinking,
        });
      }
    }

    if (snap.text.length > lastText.length && snap.text.startsWith(lastText)) {
      const delta = snap.text.slice(lastText.length);
      lastText = snap.text;
      emit({ type: "text", delta });
    } else if (snap.text !== lastText) {
      if (lastText.startsWith(snap.text)) {
        /* shorter text snapshot — keep accumulated */
      } else if (snap.text.startsWith(lastText)) {
        const delta = snap.text.slice(lastText.length);
        lastText = snap.text;
        if (delta) emit({ type: "text", delta });
      } else if (snap.text) {
        lastText = snap.text;
        emit({
          type: "content_sync",
          content: snap.text,
          thinking: snap.thinking,
        });
      }
    }
  }

  let finished = false;
  let errorEmitted = false;
  let lastErrorMessage = "chat_run_error";
  /** @type {((reason?: string) => void) | null} */
  let finishWaiter = null;
  /** @type {(() => void) | null} */
  let abortHandler = null;
  /** @type {NodeJS.Timeout | null} */
  let progressTimer = null;
  let lastProgressAt = Date.now();

  function bumpProgress() {
    lastProgressAt = Date.now();
  }

  function failStream(message) {
    const msg = String(message ?? "chat_run_error").trim() || "chat_run_error";
    errorEmitted = true;
    lastErrorMessage = msg;
    emit({ type: "error", message: msg });
    finishWaiter?.("error");
  }

  function startProgressWatchdog() {
    if (progressTimer) return;
    progressTimer = setInterval(() => {
      const idle = Date.now() - lastProgressAt;
      if (idle >= STREAM_NO_PROGRESS_TIMEOUT_MS) {
        failStream(
          `no_progress — no WebSocket push activity or streamed chat tokens for ${Math.round(idle / 1000)}s (limit ${Math.round(STREAM_NO_PROGRESS_TIMEOUT_MS / 1000)}s). Gateway **RPC** lines in the log (e.g. tools.catalog) do not count here; only events on this connection reset the timer. Set OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS to wait longer, or reduce gateway load (lean plugins, Defender exclusions).`,
        );
      }
    }, 5_000);
    if (typeof progressTimer.unref === "function") progressTimer.unref();
  }

  /** @type {Promise<void>} */
  const completion = new Promise((resolve, reject) => {
    finishWaiter = (reason) => {
      if (finished) return;
      finished = true;
      if (reason === "error") {
        log.warn("[chat.send] stream_error", {
          sessionKey,
          runId: runRef.id,
          message: lastErrorMessage,
        });
        reject(new Error(lastErrorMessage));
        return;
      }
      resolve();
    };
  });

  function payloadSessionMatches(p) {
    if (!p || typeof p !== "object") return false;
    const payloadKey = typeof p.sessionKey === "string" ? p.sessionKey.trim() : "";
    // Strict match only — `#studio:<conversationId>` suffix matching caused concurrent
    // multi-agent turns on one WebSocket to ingest each other's chat frames.
    if (!payloadKey || payloadKey !== sessionKey) return false;
    return true;
  }

  /**
   * Only count push frames for **this** chat turn when deciding liveness. A shared WebSocket
   * serves many concurrent `chat.send` runs; bumping on unrelated sessions kept other runs
   * stuck in "generating" forever while a different thread streamed.
   * @param {any} p
   */
  function eventTargetsThisRun(p) {
    if (!payloadSessionMatches(p)) return false;
    const rid = typeof p.runId === "string" ? p.runId.trim() : "";
    if (rid && runRef.id && rid !== runRef.id) return false;
    return true;
  }

  const offEvent = client.onEvent((evt) => {
    if (evt.event === "agent") {
      const p = /** @type {any} */ (evt.payload);
      if (!p || typeof p !== "object") return;
      if (!eventTargetsThisRun(p)) return;
      bumpProgress();
      if (typeof p.runId === "string" && p.runId.trim()) {
        runRef.id = p.runId.trim();
      }
      if (p.stream === "tool") {
        const d = p.data && typeof p.data === "object" ? /** @type {any} */ (p.data) : {};
        const toolCallId = typeof d.toolCallId === "string" ? d.toolCallId.trim() : "";
        const toolName = typeof d.name === "string" ? d.name.trim() : "";
        const label =
          typeof d.label === "string"
            ? d.label
            : typeof d.title === "string"
              ? d.title
              : "";
        emit({
          type: "tool_trace",
          runId: typeof p.runId === "string" ? p.runId.trim() : "",
          seq: typeof p.seq === "number" ? p.seq : 0,
          phase: typeof d.phase === "string" ? d.phase : "",
          toolCallId,
          toolName,
          label,
          status: typeof d.status === "string" ? d.status : "",
          summary: typeof d.summary === "string" ? d.summary : "",
          args: d.args && typeof d.args === "object" ? /** @type {Record<string, unknown>} */ (jsonSafeDeep(d.args)) : undefined,
          result: typeof d.result === "string" ? d.result : undefined,
          partialResult: typeof d.partialResult === "string" ? d.partialResult : undefined,
          error: typeof d.error === "string" ? d.error : undefined,
        });
        return;
      }
      const activityStreams = new Set([
        "item",
        "plan",
        "command_output",
        "patch",
        "approval",
        "compaction",
      ]);
      if (activityStreams.has(p.stream)) {
        const d = p.data && typeof p.data === "object" ? /** @type {any} */ (p.data) : {};
        {
          const usage = extractUsageFromChatPayload(d);
          if (usage) emit({ type: "usage", usage });
        }
        /** @type {Record<string, unknown>} */
        const payload = {};
        for (const k of [
          "phase",
          "kind",
          "itemId",
          "toolCallId",
          "name",
          "title",
          "summary",
          "status",
          "progressText",
          "output",
          "exitCode",
          "durationMs",
          "cwd",
          "steps",
          "explanation",
          "errorMessage",
          "stopReason",
          "aborted",
          "completed",
          "command",
          "host",
          "reason",
          "message",
          "approvalId",
          "approvalSlug",
        ]) {
          if (Object.prototype.hasOwnProperty.call(d, k)) payload[k] = jsonSafeDeep(d[k]);
        }
        emit({
          type: "agent_activity",
          stream: typeof p.stream === "string" ? p.stream : "",
          runId: typeof p.runId === "string" ? p.runId.trim() : "",
          seq: typeof p.seq === "number" ? p.seq : 0,
          payload,
        });
        return;
      }
      if (p.stream === "lifecycle") {
        const data = p.data && typeof p.data === "object" ? /** @type {any} */ (p.data) : {};
        {
          const usage = extractUsageFromChatPayload(data);
          if (usage) emit({ type: "usage", usage });
        }
        /** @type {Record<string, unknown>} */
        const lifePayload = {};
        for (const k of [
          "phase",
          "errorMessage",
          "stopReason",
          "aborted",
          "startedAt",
          "endedAt",
        ]) {
          if (Object.prototype.hasOwnProperty.call(data, k)) lifePayload[k] = jsonSafeDeep(data[k]);
        }
        emit({
          type: "agent_activity",
          stream: "lifecycle",
          runId: typeof p.runId === "string" ? p.runId.trim() : "",
          seq: typeof p.seq === "number" ? p.seq : 0,
          payload: lifePayload,
        });
        if (data.phase === "error" || data.phase === "failed") {
          const message =
            typeof data.errorMessage === "string" && data.errorMessage.trim()
              ? data.errorMessage.trim()
              : typeof data.stopReason === "string" && data.stopReason.trim()
                ? data.stopReason.trim()
                : "agent run failed";
          failStream(message);
        }
        return;
      }
      if (p.stream === "fallback") {
        const data = p.data && typeof p.data === "object" ? /** @type {any} */ (p.data) : {};
        const reason = typeof data.reason === "string" ? data.reason : "";
        const detail = typeof data.errorPreview === "string" ? data.errorPreview : "";
        if (reason || detail) {
          emit({
            type: "info",
            message: `[fallback] ${reason}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
          });
        }
      }
      return;
    }

    if (evt.event !== "chat") return;
    const p = /** @type {any} */ (evt.payload);
    if (!p || typeof p !== "object") return;
    if (!eventTargetsThisRun(p)) return;
    if (typeof p.runId === "string" && p.runId.trim()) {
      runRef.id = p.runId.trim();
    }
    if (wechatAutoReply && !loggedFirstChatEvent) {
      loggedFirstChatEvent = true;
      log.info("[chat.send] wechat first_chat_event", {
        uiConversationId,
        gatewayConversationId: conversationId,
        runId: runRef.id,
        payloadSessionKey: typeof p.sessionKey === "string" ? p.sessionKey : "",
        state: typeof p.state === "string" ? p.state : "",
      });
    }
    bumpProgress();

    const snap = extractChatPayloadSnapshot(p);
    emitChatSnapshotDeltas(snap);
    {
      const usage = extractUsageFromChatPayload(p);
      if (usage) emit({ type: "usage", usage });
    }

    if (p.state === "final") {
      const full = extractChatPayloadSnapshot(p);
      emit({ type: "content_sync", content: full.text, thinking: full.thinking });
      lastText = full.text;
      lastThinking = full.thinking;
      finishWaiter?.();
    } else if (p.state === "aborted") {
      const full = extractChatPayloadSnapshot(p);
      emit({ type: "content_sync", content: full.text, thinking: full.thinking });
      lastText = full.text;
      lastThinking = full.thinking;
      finishWaiter?.();
    } else if (p.state === "error") {
      const msg =
        typeof p.errorMessage === "string" && p.errorMessage.trim()
          ? p.errorMessage.trim()
          : "chat_run_error";
      failStream(msg);
    }
  });

  const endSubscriptions = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    offEvent();
  };

  abortHandler = () => {
    client
      .request("chat.abort", { sessionKey, runId: runRef.id })
      .catch(() => {
        /* ignore — gateway might already be aborting */
      })
      .finally(() => {
        finishWaiter?.();
      });
  };
  signal.addEventListener("abort", abortHandler, { once: true });

  try {
    /** @type {Record<string, unknown>} */
    const sendParams = {
      sessionKey,
      message: userMessage,
      // Studio delivers WeChat outbound itself (openclaw-weixin channel is not running on gateway).
      deliver: opts.deliver === true,
      idempotencyKey: runRef.id,
    };
    if (chatAttachments) sendParams.attachments = chatAttachments;
    const sendAck = await client.request("chat.send", sendParams);
    log.info("[chat.send.perf] gateway_accept", {
      elapsedMs: Date.now() - startedAt,
      runId: runRef.id,
      sessionKey,
      channel,
    });
    if (
      sendAck &&
      typeof sendAck === "object" &&
      typeof sendAck.runId === "string" &&
      sendAck.runId.trim()
    ) {
      runRef.id = sendAck.runId.trim();
    }
    bumpProgress();
    startProgressWatchdog();
  } catch (err) {
    endSubscriptions();
    throw err;
  }

  try {
    await completion;
    const sessionUsage = await readSessionUsageSinceWithRetry({
      gatewayBaseUrl: baseUrl,
      sessionKey,
      startedAtMs: startedAt,
    });
    if (sessionUsage) {
      emit({ type: "usage", usage: sessionUsage, authoritative: true });
    }
    log.info("[chat.send.perf] done", {
      elapsedMs: Date.now() - startedAt,
      firstDeltaMs: firstDeltaAt ? firstDeltaAt - startedAt : null,
      runId: runRef.id,
      sessionKey,
      textLen: lastText.length,
      thinkingLen: lastThinking.length,
    });
    return { text: lastText, thinking: lastThinking };
  } finally {
    endSubscriptions();
  }
}

/**
 * Reachability + handshake: ensures a live session to the gateway (persistent).
 *
 * @param {unknown} cfg
 */
async function probeOpenClawGateway(cfg) {
  const resolved = resolveGateway(cfg);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    await acquireGatewaySession(resolved, ac.signal);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/^gateway_unreachable/.test(message)) throw new Error(message);
    throw new Error(`gateway_unreachable — ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  dispatchOpenClawGatewayStream,
  dispatchOpenClawGatewayStreamWithResolved,
  probeOpenClawGateway,
};
