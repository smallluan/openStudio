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
 * accepts, give up. Dev gateways often stall the Node event loop while staging
 * deps / running tools — 120s is too aggressive. Override via
 * `OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS` (milliseconds, min 30000). */
function resolveStreamNoProgressTimeoutMs() {
  const raw = process.env.OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS?.trim();
  if (!raw) return 600_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 30_000 ? n : 600_000;
}
const STREAM_NO_PROGRESS_TIMEOUT_MS = resolveStreamNoProgressTimeoutMs();

/**
 * Extract text + thinking content from a chat event message snapshot.
 * The server sends a *replacement* snapshot per delta, not an append.
 * @param {any} message
 * @returns {{ text: string; thinking: string }}
 */
function extractMessageSnapshot(message) {
  if (!message || typeof message !== "object") return { text: "", thinking: "" };
  /** @type {any} */ const m = message;

  if (typeof m.text === "string") return { text: m.text, thinking: "" };
  if (typeof m.content === "string") return { text: m.content, thinking: "" };
  if (!Array.isArray(m.content)) return { text: "", thinking: "" };

  let text = "";
  let thinking = "";
  for (const part of m.content) {
    if (!part || typeof part !== "object") continue;
    const t = /** @type {any} */ (part).type;
    if (t === "text") {
      const v = /** @type {any} */ (part).text;
      if (typeof v === "string") text += v;
    } else if (t === "thinking") {
      const v = /** @type {any} */ (part).thinking;
      if (typeof v === "string") thinking += v;
    }
  }
  return { text, thinking };
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
          message: `no_progress — gateway sent no streamed chat/agent updates for ${Math.round(idle / 1000)}s (limit ${Math.round(STREAM_NO_PROGRESS_TIMEOUT_MS / 1000)}s). If OpenClaw logs show large event_loop_delay, the gateway Node thread is overloaded; you can raise OPEN_STUDIO_GATEWAY_NO_PROGRESS_MS.`,
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
    if (evt.event === "agent") {
      const p = /** @type {any} */ (evt.payload);
      if (!p || typeof p !== "object") return;
      if (p.sessionKey && p.sessionKey !== sessionKey) return;
      if (p.runId && p.runId !== runRef.id) return;
      bumpProgress();
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
    if (p.runId && p.runId !== runRef.id) return;

    bumpProgress();
    const snap = extractMessageSnapshot(p.message);

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
      finishWaiter?.();
    } else if (p.state === "aborted") {
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
