"use strict";

const { randomUUID } = require("crypto");
const { dispatchOpenClawGatewayStream } = require("./openclaw-gateway-stream.cjs");
const { resolveStudioGatewaySessionKey } = require("./openclaw-gateway-session.cjs");
const { getStudioLog } = require("./studio-logger.cjs");

const CHAT_STREAM_IMMEDIATE = new Set(["meta", "text", "thinking", "content_sync", "error", "aborted", "done", "info"]);

/**
 * Isolated session key for orchestration worker turns — avoids multiplex collisions on shared WS.
 * @param {string} baseSessionKey
 * @param {string} runId
 * @param {string} [taskId]
 */
function orchestrationTurnSessionKey(baseSessionKey, runId, taskId) {
  const base = String(baseSessionKey ?? "").trim();
  const rid = String(runId ?? "").trim().slice(0, 48);
  if (!base || !rid) return base;
  if (taskId) {
    const tid = String(taskId).trim().slice(0, 48);
    return `${base}#studio-orch:${rid}:${tid}`;
  }
  return `${base}#studio-orch:${rid}:main`;
}

/**
 * Run one orchestration agent turn from the main process.
 * @param {{
 *   cfg: Record<string, unknown>;
 *   messages: unknown[];
 *   baseAgentSessionKey: string;
 *   conversationId: string;
 *   runId: string;
 *   taskId?: string;
 *   streamId: string;
 *   assistantMessageId: string;
 *   webContents: import("electron").WebContents;
 *   abortSignal?: AbortSignal;
 *   concurrent?: boolean;
 *   contextEmbedMode?: string;
 *   threadSummaryPrefix?: string;
 * }} opts
 * @returns {Promise<{ text: string }>}
 */
async function runOrchestrationTurn(opts) {
  const {
    cfg,
    messages,
    baseAgentSessionKey,
    conversationId,
    runId,
    taskId,
    streamId,
    assistantMessageId,
    webContents,
    abortSignal,
    concurrent = true,
    contextEmbedMode = "task",
    threadSummaryPrefix,
  } = opts;

  const orchSessionKey = orchestrationTurnSessionKey(baseAgentSessionKey, runId, taskId);
  const gatewayConversationId = conversationId;

  /** @type {string} */
  let text = "";
  /** @type {string} */
  let thinking = "";
  let terminalSent = false;

  const applyStreamEvent = (evt) => {
    if (!evt || typeof evt !== "object") return;
    if (evt.type === "text") {
      if (typeof evt.delta === "string") text += evt.delta;
      else if (typeof evt.content === "string") text = evt.content;
    }
    if (evt.type === "thinking") {
      if (typeof evt.delta === "string") thinking += evt.delta;
      else if (typeof evt.content === "string") thinking = evt.content;
    }
    if (evt.type === "content_sync") {
      if (typeof evt.content === "string") text = evt.content;
      if (typeof evt.thinking === "string") thinking = evt.thinking;
    }
    if (evt.type === "done") {
      if (typeof evt.content === "string" && evt.content.trim()) text = evt.content;
      if (typeof evt.thinking === "string" && evt.thinking.trim()) thinking = evt.thinking;
    }
  };

  const emit = (evt) => {
    if (webContents.isDestroyed()) return;
    webContents.send("studio:chatStream", {
      streamId,
      assistantMessageId,
      conversationId,
      ...evt,
    });
  };

  emit({ type: "meta", assistantMessageId });

  try {
    const streamResult = await dispatchOpenClawGatewayStream(
      cfg,
      messages,
      abortSignal,
      (evt) => {
        applyStreamEvent(evt);
        if (CHAT_STREAM_IMMEDIATE.has(evt.type)) {
          emit(evt);
        } else {
          emit(evt);
        }
      },
      {
        conversationId: gatewayConversationId,
        uiConversationId: conversationId,
        agentSessionKey: orchSessionKey,
        contextEmbedMode,
        concurrent,
        ...(threadSummaryPrefix ? { threadSummaryPrefix } : {}),
      },
    );
    if (String(streamResult?.text ?? "").trim()) {
      text = String(streamResult.text);
    }
    if (!webContents.isDestroyed()) {
      emit({ type: "done", content: text, thinking });
      terminalSent = true;
    }
  } catch (err) {
    if (abortSignal?.aborted || err?.name === "AbortError") {
      if (!webContents.isDestroyed()) {
        emit({ type: "aborted" });
        terminalSent = true;
      }
    } else {
      getStudioLog().warn("[orchestration-turn] failed", { runId, taskId, message: String(err?.message ?? err) });
      if (!webContents.isDestroyed()) {
        emit({ type: "error", message: String(err?.message ?? err) });
        terminalSent = true;
      }
      throw err;
    }
  } finally {
    if (!terminalSent && !webContents.isDestroyed()) {
      emit({ type: "done", content: text, thinking });
    }
  }

  return { text: String(text ?? "").trim(), thinking: String(thinking ?? "").trim() };
}

function newStreamId() {
  return randomUUID();
}

module.exports = {
  orchestrationTurnSessionKey,
  runOrchestrationTurn,
  newStreamId,
};
