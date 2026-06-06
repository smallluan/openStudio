/**
 * LLM streaming dispatcher (main-process side).
 *
 * Reads the user config (API key + active model profile), dispatches a streaming
 * chat request to the configured provider, and forwards events back through a
 * caller-supplied callback. Supports graceful cancellation via AbortSignal.
 *
 * Events emitted (shape passed to `onEvent`):
 *   { type: "meta",     vendor, model, profileId }
 *   { type: "thinking", delta: string }
 *   { type: "text",     delta: string }
 *   { type: "usage",    usage: { inputTokens?, outputTokens?, totalTokens? } }
 *
 * The caller (main.js) additionally appends { type: "aborted" | "error" | "done" }
 * on top of whatever this module emits. That keeps the IPC contract clean.
 */

const {
  KNOWN_PROVIDER_IDS,
  OPENAI_LIKE_PROVIDER_IDS,
  resolveProviderBaseUrl,
  mapNativeProviderToOpenClaw,
} = require("./model-providers.cjs");
const {
  extractActiveProfile,
  findProfileRow,
  readLegacyAgentModelApiKey,
  credentialLikelyMatchesProvider,
} = require("./model-profile-credentials.cjs");
const {
  resolveOpenClawStateDir,
  parseAgentIdFromSessionKey,
} = require("./sync-openclaw-agent-from-studio.cjs");

const ANTHROPIC_VERSION = "2023-06-01";

/** @param {unknown} cfg @param {{ id?: string; provider?: string }} profile */
function extractApiKey(cfg, profile) {
  const row = findProfileRow(cfg, String(profile?.id ?? "").trim());
  if (row && typeof row.apiKey === "string" && row.apiKey.trim()) {
    return row.apiKey.trim();
  }
  const oc = cfg?.openclaw && typeof cfg.openclaw === "object" ? cfg.openclaw : {};
  const gatewayBaseUrl =
    typeof oc.gatewayBaseUrl === "string" && oc.gatewayBaseUrl.trim() ? oc.gatewayBaseUrl.trim() : "";
  const mapped = mapNativeProviderToOpenClaw(String(profile?.provider ?? "").trim(), profile);
  if (gatewayBaseUrl && mapped) {
    const stateDir = resolveOpenClawStateDir(gatewayBaseUrl);
    const agentId = parseAgentIdFromSessionKey(
      typeof oc.sessionKey === "string" ? oc.sessionKey : undefined,
    );
    const legacy = readLegacyAgentModelApiKey(stateDir, agentId, mapped.openClawProvider);
    if (legacy && credentialLikelyMatchesProvider(legacy, mapped.openClawProvider)) return legacy;
  }
  const raw = cfg?.credentials?.providerApiKey;
  const globalKey = typeof raw === "string" ? raw.trim() : "";
  if (globalKey && mapped && credentialLikelyMatchesProvider(globalKey, mapped.openClawProvider)) {
    return globalKey;
  }
  return "";
}

/**
 * Validate config and resolve endpoint/auth details before dispatch.
 * Throws with a machine-friendly message so the UI can surface it verbatim.
 * @param {unknown} cfg
 */
function resolveDispatch(cfg) {
  const profile = extractActiveProfile(cfg);
  if (!profile) throw new Error("no_active_model_profile");
  const provider = String(profile.provider || "").trim();
  if (!KNOWN_PROVIDER_IDS.includes(provider)) throw new Error("invalid_provider");
  const modelId = String(profile.modelId || "").trim();
  if (!modelId) throw new Error("missing_model_id");

  const apiKey = extractApiKey(cfg, profile);
  if (!apiKey) throw new Error("missing_api_key");

  const baseUrl = resolveProviderBaseUrl(provider, String(profile.baseUrl || ""), profile);
  if (!baseUrl) throw new Error(provider === "openai-compatible" ? "missing_base_url" : "missing_provider_base_url");

  return {
    provider,
    modelId,
    baseUrl,
    apiKey,
    profileId: String(profile.id || ""),
    profileLabel: String(profile.label || "").trim(),
  };
}

/**
 * Turn a raw fetch Response stream into an async iterable of SSE "data:" payload
 * strings. Each yielded item is the payload of one SSE event (still unparsed
 * text). We tolerate CRLF, blank keep-alive lines, and chunked partial frames.
 *
 * @param {Response} resp
 * @param {AbortSignal} signal
 */
async function* iterateSseDataLines(resp, signal) {
  const body = resp.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = indexOfEventBoundary(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, idx.end);
        buffer = buffer.slice(idx.end);
        const payload = extractSseDataPayload(rawEvent);
        if (payload != null) yield payload;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const payload = extractSseDataPayload(buffer);
      if (payload != null) yield payload;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/**
 * SSE events are separated by a blank line ("\n\n" or "\r\n\r\n"). Return the
 * position of the terminator and where the next event begins, or null.
 * @param {string} s
 */
function indexOfEventBoundary(s) {
  const crlf = s.indexOf("\r\n\r\n");
  const lf = s.indexOf("\n\n");
  let pick = -1;
  let end = -1;
  if (crlf !== -1) {
    pick = crlf;
    end = crlf + 4;
  }
  if (lf !== -1 && (pick === -1 || lf < pick)) {
    pick = lf;
    end = lf + 2;
  }
  return pick === -1 ? -1 : { start: pick, end };
}

/**
 * Extract the concatenated `data:` payload lines from one raw SSE event.
 * Per the SSE spec multi-line data is joined with newlines. Returns null if
 * this event has no `data:` field (e.g. a comment or keep-alive only).
 * @param {string} raw
 */
function extractSseDataPayload(raw) {
  /** @type {string[]} */
  const parts = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      parts.push(line.slice(5).replace(/^\s/, ""));
    }
  }
  if (parts.length === 0) return null;
  return parts.join("\n");
}

/**
 * @param {string} url
 * @param {RequestInit & { signal: AbortSignal }} init
 */
async function beginStream(url, init) {
  const resp = await fetch(url, init);
  if (!resp.ok || !resp.body) {
    let detail = "";
    try {
      detail = await resp.text();
    } catch {
      /* ignore */
    }
    const snippet = detail ? ` — ${detail.slice(0, 600)}` : "";
    throw new Error(`http_${resp.status}${snippet}`);
  }
  return resp;
}

/**
 * @param {Array<{ role: string; content: string }>} messages
 */
function normalizeMessagesForOpenAI(messages) {
  /** @type {Array<{role: string; content: string}>} */
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "system" || m.role === "assistant" ? m.role : "user";
    const content = typeof m.content === "string" ? m.content : "";
    if (!content && role !== "system") continue;
    out.push({ role, content });
  }
  return out;
}

/**
 * OpenAI / OpenAI-compatible Chat Completions streaming.
 *
 * Reasoning deltas:
 *   - Providers like DeepSeek-R1 / Moonshot Kimi stream `delta.reasoning_content`.
 *   - OpenAI o-series reasoning models may stream `delta.reasoning` (string) or
 *     an object with `content[].text`. Both shapes are handled defensively.
 */
async function streamOpenAiLike({ baseUrl, apiKey, modelId, provider }, messages, signal, onEvent) {
  const body = {
    model: modelId,
    stream: true,
    messages: normalizeMessagesForOpenAI(messages),
  };
  if (provider === "openai") {
    body.stream_options = { include_usage: true };
  }

  const url = `${baseUrl}/chat/completions`;
  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${apiKey}`,
  };

  const resp = await beginStream(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  for await (const payload of iterateSseDataLines(resp, signal)) {
    if (payload === "[DONE]") return;
    /** @type {*} */
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    const choice = parsed?.choices?.[0];
    const delta = choice?.delta ?? {};

    const reasoningText = extractOpenAiReasoningDelta(delta);
    if (reasoningText) onEvent({ type: "thinking", delta: reasoningText });

    if (typeof delta?.content === "string" && delta.content.length > 0) {
      onEvent({ type: "text", delta: delta.content });
    } else if (Array.isArray(delta?.content)) {
      for (const part of delta.content) {
        if (!part) continue;
        if (part.type === "text" && typeof part.text === "string") {
          onEvent({ type: "text", delta: part.text });
        } else if (part.type === "reasoning" && typeof part.text === "string") {
          onEvent({ type: "thinking", delta: part.text });
        }
      }
    }

    if (parsed?.usage && typeof parsed.usage === "object") {
      onEvent({
        type: "usage",
        usage: {
          inputTokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens,
          outputTokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens,
          totalTokens: parsed.usage.total_tokens,
        },
      });
    }
  }
}

/** @param {*} delta */
function extractOpenAiReasoningDelta(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (delta.reasoning && typeof delta.reasoning === "object") {
    const arr = Array.isArray(delta.reasoning.content) ? delta.reasoning.content : [];
    return arr
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

/**
 * Anthropic Messages API streaming.
 *
 * System prompts live in the top-level `system` field, not in messages.
 * `thinking` content blocks stream with `thinking_delta` deltas.
 */
async function streamAnthropic({ baseUrl, apiKey, modelId }, messages, signal, onEvent) {
  /** @type {string[]} */
  const sysParts = [];
  /** @type {Array<{ role: "user" | "assistant"; content: string }>} */
  const turns = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (m.role === "system") {
      if (content) sysParts.push(content);
    } else if (m.role === "assistant") {
      if (content) turns.push({ role: "assistant", content });
    } else {
      if (content) turns.push({ role: "user", content });
    }
  }

  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    throw new Error("anthropic_requires_trailing_user");
  }

  const body = {
    model: modelId,
    max_tokens: 4096,
    stream: true,
    messages: turns,
  };
  if (sysParts.length > 0) body.system = sysParts.join("\n\n");

  const resp = await beginStream(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal,
  });

  for await (const payload of iterateSseDataLines(resp, signal)) {
    /** @type {*} */
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    const t = evt?.type;
    if (t === "content_block_delta") {
      const d = evt.delta ?? {};
      if (d.type === "text_delta" && typeof d.text === "string") {
        onEvent({ type: "text", delta: d.text });
      } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
        onEvent({ type: "thinking", delta: d.thinking });
      }
    } else if (t === "message_delta" && evt.usage && typeof evt.usage === "object") {
      onEvent({
        type: "usage",
        usage: {
          inputTokens: evt.usage.input_tokens,
          outputTokens: evt.usage.output_tokens,
          totalTokens:
            (evt.usage.input_tokens ?? 0) + (evt.usage.output_tokens ?? 0) || undefined,
        },
      });
    } else if (t === "message_stop") {
      return;
    } else if (t === "error") {
      const msg = evt.error?.message ? String(evt.error.message) : "anthropic_stream_error";
      throw new Error(msg);
    }
  }
}

/**
 * Google Gemini streaming via REST `streamGenerateContent?alt=sse`.
 *
 * Thinking parts are marked by `part.thought === true`. Older responses may
 * omit the flag; we fall back to emitting as text in that case.
 */
async function streamGoogle({ baseUrl, apiKey, modelId }, messages, signal, onEvent) {
  /** @type {string[]} */
  const sysParts = [];
  /** @type {Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>} */
  const contents = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content) continue;
    if (m.role === "system") {
      sysParts.push(content);
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: content }] });
  }

  if (contents.length === 0) throw new Error("google_requires_user_message");

  const body = { contents };
  if (sysParts.length > 0) {
    body.systemInstruction = { role: "system", parts: [{ text: sysParts.join("\n\n") }] };
  }

  const encodedModel = encodeURIComponent(modelId);
  const url = `${baseUrl}/models/${encodedModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const resp = await beginStream(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  for await (const payload of iterateSseDataLines(resp, signal)) {
    /** @type {*} */
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    const cand = evt?.candidates?.[0];
    const parts = cand?.content?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (!p || typeof p !== "object") continue;
        const text = typeof p.text === "string" ? p.text : "";
        if (!text) continue;
        if (p.thought === true) onEvent({ type: "thinking", delta: text });
        else onEvent({ type: "text", delta: text });
      }
    }
    if (evt?.usageMetadata && typeof evt.usageMetadata === "object") {
      onEvent({
        type: "usage",
        usage: {
          inputTokens: evt.usageMetadata.promptTokenCount,
          outputTokens: evt.usageMetadata.candidatesTokenCount,
          totalTokens: evt.usageMetadata.totalTokenCount,
        },
      });
    }
  }
}

/**
 * Dispatch a streaming chat request.
 *
 * @param {unknown} cfg
 * @param {Array<{ role: string; content: string }>} messages
 * @param {AbortSignal} signal
 * @param {(evt: { type: string } & Record<string, unknown>) => void} onEvent
 */
async function dispatchStream(cfg, messages, signal, onEvent) {
  const resolved = resolveDispatch(cfg);
  onEvent({
    type: "meta",
    vendor: resolved.provider,
    model: resolved.modelId,
    profileId: resolved.profileId,
    profileLabel: resolved.profileLabel,
  });

  if (OPENAI_LIKE_PROVIDER_IDS.has(resolved.provider)) {
    await streamOpenAiLike(resolved, messages, signal, onEvent);
    return;
  }
  if (resolved.provider === "anthropic") {
    await streamAnthropic(resolved, messages, signal, onEvent);
    return;
  }
  if (resolved.provider === "google") {
    await streamGoogle(resolved, messages, signal, onEvent);
    return;
  }
  throw new Error("unsupported_provider");
}

module.exports = { dispatchStream };
