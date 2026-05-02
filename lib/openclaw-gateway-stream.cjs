/**
 * Stream chat via the local OpenClaw Gateway WebSocket RPC.
 *
 * See openclaw-gateway-ws.cjs for protocol notes. Chat runs on a **persistent**
 * session (openclaw-gateway-session.cjs) so turns do not pay a full reconnect /
 * handshake tax and the gateway can keep plugin/tool state warm.
 */

const { randomUUID } = require("crypto");
const { resolveGateway } = require("./openclaw-gateway-ws.cjs");
const { acquireGatewaySession } = require("./openclaw-gateway-session.cjs");

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
 * Prefer `payload.message`; if empty, scan non-protocol keys on the payload (some gateways put text only at top level).
 * @param {any} p chat event payload
 */
function extractChatPayloadSnapshot(p) {
  const fromMsg = extractMessageSnapshot(p?.message);
  if (fromMsg.text.trim() || fromMsg.thinking.trim()) return fromMsg;
  if (!p || typeof p !== "object") return { text: "", thinking: "" };
  const clone = { ...p };
  delete clone.message;
  delete clone.sessionKey;
  delete clone.runId;
  delete clone.state;
  delete clone.errorMessage;
  return extractMessageSnapshot(clone);
}

/**
 * @param {Array<{ role: string; content: string }>} messages
 * @returns {string}
 */
function pickLatestUserMessage(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user") continue;
    const c = typeof m.content === "string" ? m.content : "";
    if (c.trim()) return c;
  }
  return "";
}

/**
 * @param {unknown} cfg
 * @param {Array<{ role: string; content: string }>} messages
 * @param {AbortSignal} signal
 * @param {(evt: { type: string } & Record<string, unknown>) => void} onEvent
 */
async function dispatchOpenClawGatewayStream(cfg, messages, signal, onEvent) {
  const resolved = resolveGateway(cfg);
  return dispatchOpenClawGatewayStreamWithResolved(resolved, messages, signal, onEvent);
}

/**
 * @param {{ baseUrl: string; wsUrl: string; token: string; sessionKey: string }} resolved
 * @param {Array<{ role: string; content: string }>} messages
 * @param {AbortSignal} signal
 * @param {(evt: { type: string } & Record<string, unknown>) => void} onEvent
 */
async function dispatchOpenClawGatewayStreamWithResolved(resolved, messages, signal, onEvent) {
  const { baseUrl, sessionKey } = resolved;

  onEvent({
    type: "meta",
    vendor: "openclaw",
    model: "openclaw/default",
    profileId: "",
    profileLabel: "",
    gatewayBaseUrl: baseUrl,
    sessionKey,
  });

  const userMessage = pickLatestUserMessage(messages);
  if (!userMessage.trim()) {
    throw new Error("empty_user_message");
  }

  /** OpenClaw sets `clientRunId = idempotencyKey`; streamed frames use that run id. */
  const runRef = { id: randomUUID() };

  const client = await acquireGatewaySession(resolved, signal);

  let lastText = "";
  let lastThinking = "";
  let finished = false;
  let errorEmitted = false;
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

  function startProgressWatchdog() {
    if (progressTimer) return;
    progressTimer = setInterval(() => {
      const idle = Date.now() - lastProgressAt;
      if (idle >= STREAM_NO_PROGRESS_TIMEOUT_MS) {
        errorEmitted = true;
        onEvent({
          type: "error",
          message: `no_progress — no WebSocket push activity or streamed chat tokens for ${Math.round(idle / 1000)}s (limit ${Math.round(STREAM_NO_PROGRESS_TIMEOUT_MS / 1000)}s). Gateway **RPC** lines in the log (e.g. tools.catalog) do not count here; only events on this connection reset the timer. Set OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS to wait longer, or reduce gateway load (lean plugins, Defender exclusions).`,
        });
        finishWaiter?.("error");
      }
    }, 5_000);
    if (typeof progressTimer.unref === "function") progressTimer.unref();
  }

  /** @type {Promise<void>} */
  const completion = new Promise((resolve, reject) => {
    finishWaiter = (reason) => {
      if (finished) return;
      finished = true;
      if (reason === "error" && !errorEmitted) {
        reject(new Error("chat_run_error"));
        return;
      }
      resolve();
    };
  });

  const offEvent = client.onEvent((evt) => {
    /** Any inbound push frame counts as liveness: heartbeats, tool/session noise, agent thumbnails, etc.
     * RPC responses (`type: res`) never reach this listener, so logs can show slow RPCs while this timer still fires. */
    bumpProgress();

    if (evt.event === "agent") {
      const p = /** @type {any} */ (evt.payload);
      if (!p || typeof p !== "object") return;
      if (p.sessionKey && p.sessionKey !== sessionKey) return;
      if (typeof p.runId === "string" && p.runId.trim()) {
        runRef.id = p.runId.trim();
      }
      if (p.stream === "fallback") {
        const data = p.data && typeof p.data === "object" ? /** @type {any} */ (p.data) : {};
        const reason = typeof data.reason === "string" ? data.reason : "";
        const detail = typeof data.errorPreview === "string" ? data.errorPreview : "";
        if (reason || detail) {
          onEvent({
            type: "info",
            message: `[fallback] ${reason}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
          });
        }
      } else if (p.stream === "lifecycle") {
        const data = p.data && typeof p.data === "object" ? /** @type {any} */ (p.data) : {};
        if (data.phase === "error" || data.phase === "failed") {
          const message =
            typeof data.errorMessage === "string" && data.errorMessage.trim()
              ? data.errorMessage.trim()
              : "agent run failed";
          errorEmitted = true;
          onEvent({ type: "error", message });
          finishWaiter?.("error");
        }
      }
      return;
    }

    if (evt.event !== "chat") return;
    const p = /** @type {any} */ (evt.payload);
    if (!p || typeof p !== "object") return;
    if (p.sessionKey && p.sessionKey !== sessionKey) return;
    if (typeof p.runId === "string" && p.runId.trim()) {
      runRef.id = p.runId.trim();
    }

    const snap = extractChatPayloadSnapshot(p);

    if (snap.thinking.length > lastThinking.length && snap.thinking.startsWith(lastThinking)) {
      const delta = snap.thinking.slice(lastThinking.length);
      lastThinking = snap.thinking;
      onEvent({ type: "thinking", delta });
    } else if (snap.thinking !== lastThinking) {
      const delta = snap.thinking;
      lastThinking = snap.thinking;
      if (delta) onEvent({ type: "thinking", delta });
    }

    if (snap.text.length > lastText.length && snap.text.startsWith(lastText)) {
      const delta = snap.text.slice(lastText.length);
      lastText = snap.text;
      onEvent({ type: "text", delta });
    } else if (snap.text !== lastText) {
      lastText = snap.text;
      if (snap.text) onEvent({ type: "text", delta: snap.text });
    }

    if (p.state === "final") {
      const full = extractChatPayloadSnapshot(p);
      onEvent({ type: "content_sync", content: full.text, thinking: full.thinking });
      lastText = full.text;
      lastThinking = full.thinking;
      finishWaiter?.();
    } else if (p.state === "aborted") {
      const full = extractChatPayloadSnapshot(p);
      onEvent({ type: "content_sync", content: full.text, thinking: full.thinking });
      lastText = full.text;
      lastThinking = full.thinking;
      finishWaiter?.();
    } else if (p.state === "error") {
      const msg =
        typeof p.errorMessage === "string" && p.errorMessage.trim()
          ? p.errorMessage.trim()
          : "chat_run_error";
      errorEmitted = true;
      onEvent({ type: "error", message: msg });
      finishWaiter?.("error");
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
    const sendAck = await client.request("chat.send", {
      sessionKey,
      message: userMessage,
      deliver: false,
      idempotencyKey: runRef.id,
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
