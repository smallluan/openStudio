const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { mergeUsage } = require("./token-usage-extract.cjs");

const STORE_VERSION = 1;
const FILE_NAME = "studio-token-usage.json";
const MAX_RECORDS = 8000;

/**
 * @typedef {{
 *   estSystemTokens?: number;
 *   estHistoryTokens?: number;
 *   estUserTokens?: number;
 *   estStudioInputTokens?: number;
 *   estGatewayOverheadTokens?: number;
 *   outboundChars?: number;
 *   priorTurnCount?: number;
 *   contextEmbedMode?: string;
 *   llmCallCount?: number;
 *   toolCallCount?: number;
 *   cacheReadTokens?: number;
 *   cacheWriteTokens?: number;
 * }} TokenUsageBreakdown
 */

/**
 * @typedef {{
 *   id: string;
 *   timestamp: number;
 *   streamId: string;
 *   conversationId: string;
 *   conversationTitle?: string;
 *   assistantMessageId?: string;
 *   userMessageId?: string;
 *   userContentPreview?: string;
 *   modelProfileId?: string;
 *   modelLabel?: string;
 *   provider?: string;
 *   modelId?: string;
 *   agentId?: string;
 *   gatewayAgentId?: string;
 *   channel?: "internal" | "wechat";
 *   source?: "gateway" | "direct" | "title";
 *   inputTokens: number;
 *   outputTokens: number;
 *   totalTokens: number;
 *   usageBreakdown?: TokenUsageBreakdown;
 * }} TokenUsageRecord
 */

/** @param {unknown} raw */
function sanitizeBreakdown(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const b = /** @type {Record<string, unknown>} */ (raw);
  /** @param {string} key */
  const num = (key) => {
    const n = Number(b[key]);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  /** @type {TokenUsageBreakdown} */
  const out = {};
  const estSystemTokens = num("estSystemTokens");
  const estHistoryTokens = num("estHistoryTokens");
  const estUserTokens = num("estUserTokens");
  const estStudioInputTokens = num("estStudioInputTokens");
  const estGatewayOverheadTokens = num("estGatewayOverheadTokens");
  const outboundChars = num("outboundChars");
  const priorTurnCount = num("priorTurnCount");
  const llmCallCount = num("llmCallCount");
  const toolCallCount = num("toolCallCount");
  const cacheReadTokens = num("cacheReadTokens");
  const cacheWriteTokens = num("cacheWriteTokens");
  if (estSystemTokens != null) out.estSystemTokens = estSystemTokens;
  if (estHistoryTokens != null) out.estHistoryTokens = estHistoryTokens;
  if (estUserTokens != null) out.estUserTokens = estUserTokens;
  if (estStudioInputTokens != null) out.estStudioInputTokens = estStudioInputTokens;
  if (estGatewayOverheadTokens != null) out.estGatewayOverheadTokens = estGatewayOverheadTokens;
  if (outboundChars != null) out.outboundChars = outboundChars;
  if (priorTurnCount != null) out.priorTurnCount = priorTurnCount;
  if (llmCallCount != null) out.llmCallCount = llmCallCount;
  if (toolCallCount != null) out.toolCallCount = toolCallCount;
  if (cacheReadTokens != null) out.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens != null) out.cacheWriteTokens = cacheWriteTokens;
  const embed = typeof b.contextEmbedMode === "string" ? b.contextEmbedMode.trim() : "";
  if (embed) out.contextEmbedMode = embed.slice(0, 24);
  return Object.keys(out).length ? out : undefined;
}

/** @param {TokenUsageBreakdown | undefined} a @param {TokenUsageBreakdown | undefined} b */
function mergeBreakdown(a, b) {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  const pick = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
  return {
    estSystemTokens: pick(a.estSystemTokens, b.estSystemTokens),
    estHistoryTokens: pick(a.estHistoryTokens, b.estHistoryTokens),
    estUserTokens: pick(a.estUserTokens, b.estUserTokens),
    estStudioInputTokens: pick(a.estStudioInputTokens, b.estStudioInputTokens),
    outboundChars: pick(a.outboundChars, b.outboundChars),
    priorTurnCount: pick(a.priorTurnCount, b.priorTurnCount),
    llmCallCount: pick(a.llmCallCount, b.llmCallCount),
    toolCallCount: pick(a.toolCallCount, b.toolCallCount),
    cacheReadTokens: pick(a.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: pick(a.cacheWriteTokens, b.cacheWriteTokens),
    contextEmbedMode: b.contextEmbedMode || a.contextEmbedMode,
  };
}

/**
 * Reconcile breakdown numbers against authoritative billed input.
 * @param {number} inputTokens
 * @param {TokenUsageBreakdown | undefined} raw
 * @returns {TokenUsageBreakdown | undefined}
 */
function finalizeBreakdown(inputTokens, raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const b = { ...raw };
  const billed = Math.max(0, Math.round(Number(inputTokens) || 0));
  if (billed <= 0) return sanitizeBreakdown(b);

  const studio = Math.min(
    billed,
    Math.max(
      b.estStudioInputTokens ?? 0,
      (b.estSystemTokens ?? 0) + (b.estHistoryTokens ?? 0) + (b.estUserTokens ?? 0),
    ),
  );
  b.estGatewayOverheadTokens = Math.max(0, billed - studio);

  return sanitizeBreakdown(b);
}

/** @param {unknown} raw */
function sanitizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const inputTokens = Number(r.inputTokens);
  const outputTokens = Number(r.outputTokens);
  const totalTokens = Number(r.totalTokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens) && !Number.isFinite(totalTokens)) {
    return null;
  }
  const inTok = Number.isFinite(inputTokens) && inputTokens >= 0 ? Math.round(inputTokens) : 0;
  const outTok = Number.isFinite(outputTokens) && outputTokens >= 0 ? Math.round(outputTokens) : 0;
  const tot =
    Number.isFinite(totalTokens) && totalTokens >= 0 ? Math.round(totalTokens) : inTok + outTok;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : randomUUID();
  const streamId = typeof r.streamId === "string" ? r.streamId.trim() : id;
  const conversationId = typeof r.conversationId === "string" ? r.conversationId.trim() : "";
  const timestamp = typeof r.timestamp === "number" && Number.isFinite(r.timestamp) ? r.timestamp : Date.now();
  /** @type {TokenUsageRecord} */
  const row = {
    id,
    timestamp,
    streamId,
    conversationId,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: tot,
  };
  const str = (k, max) => {
    const v = typeof r[k] === "string" ? String(r[k]).trim() : "";
    if (v) row[k] = v.slice(0, max);
  };
  str("conversationTitle", 160);
  str("assistantMessageId", 80);
  str("userMessageId", 80);
  str("userContentPreview", 240);
  str("modelProfileId", 80);
  str("modelLabel", 120);
  str("provider", 40);
  str("modelId", 120);
  str("agentId", 80);
  str("gatewayAgentId", 80);
  if (r.channel === "wechat" || r.channel === "internal") row.channel = r.channel;
  if (r.source === "gateway" || r.source === "direct" || r.source === "title") row.source = r.source;
  const breakdown = sanitizeBreakdown(r.usageBreakdown);
  if (breakdown) row.usageBreakdown = breakdown;
  return row;
}

/** @param {string} userDataDir */
function createTokenUsageStore(userDataDir) {
  const filePath = () => path.join(userDataDir, FILE_NAME);

  /** @type {{ version: number; records: TokenUsageRecord[] } | null} */
  let cache = null;
  /** @type {Map<string, Partial<TokenUsageRecord> & { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; toolCallIds?: Set<string> }>} */
  const pendingByStream = new Map();

  function readRaw() {
    if (cache) return cache;
    /** @type {{ version: number; records: TokenUsageRecord[] }} */
    let data = { version: STORE_VERSION, records: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
      if (parsed && typeof parsed === "object") {
        const recs = Array.isArray(parsed.records) ? parsed.records : [];
        data = {
          version: STORE_VERSION,
          records: recs.map(sanitizeRecord).filter(Boolean),
        };
      }
    } catch {
      /* fresh store */
    }
    cache = data;
    return data;
  }

  function writeRaw() {
    if (!cache) return;
    try {
      fs.mkdirSync(path.dirname(filePath()), { recursive: true });
      fs.writeFileSync(filePath(), JSON.stringify(cache, null, 0), "utf8");
    } catch {
      /* ignore disk errors */
    }
  }

  /**
   * @param {string} streamId
   * @param {Partial<TokenUsageRecord>} meta
   */
  function beginStream(streamId, meta) {
    const sid = String(streamId ?? "").trim();
    if (!sid) return;
    const prev = pendingByStream.get(sid) ?? {};
    const breakdown = sanitizeBreakdown(meta?.usageBreakdown);
    pendingByStream.set(sid, {
      ...prev,
      ...meta,
      streamId: sid,
      ...(breakdown ? { usageBreakdown: breakdown } : {}),
    });
  }

  /**
   * @param {string} streamId
   * @param {TokenUsageBreakdown} patch
   */
  function patchStreamBreakdown(streamId, patch) {
    const sid = String(streamId ?? "").trim();
    if (!sid || !patch) return;
    const prev = pendingByStream.get(sid) ?? { streamId: sid };
    const merged = mergeBreakdown(prev.usageBreakdown, sanitizeBreakdown(patch));
    pendingByStream.set(sid, { ...prev, ...(merged ? { usageBreakdown: merged } : {}) });
  }

  /** @param {string} streamId @param {string} toolCallId */
  function noteStreamToolCall(streamId, toolCallId) {
    const sid = String(streamId ?? "").trim();
    const id = String(toolCallId ?? "").trim();
    if (!sid || !id) return;
    const prev = pendingByStream.get(sid) ?? { streamId: sid };
    const ids = prev.toolCallIds ?? new Set();
    ids.add(id);
    pendingByStream.set(sid, {
      ...prev,
      toolCallIds: ids,
      usageBreakdown: mergeBreakdown(prev.usageBreakdown, { toolCallCount: ids.size }),
    });
  }

  /**
   * @param {string} streamId
   * @param {{ inputTokens?: number; outputTokens?: number; totalTokens?: number }} usage
   */
  function noteStreamUsage(streamId, usage) {
    const sid = String(streamId ?? "").trim();
    if (!sid || !usage) return;
    const prev = pendingByStream.get(sid) ?? { streamId: sid };
    const merged = mergeUsage(prev.usage ?? null, usage);
    pendingByStream.set(sid, { ...prev, usage: merged ?? undefined });
  }

  /**
   * @param {string} streamId
   * @param {{ inputTokens?: number; outputTokens?: number; totalTokens?: number }} usage
   */
  function replaceStreamUsage(streamId, usage) {
    const sid = String(streamId ?? "").trim();
    if (!sid || !usage) return;
    const prev = pendingByStream.get(sid) ?? { streamId: sid };
    pendingByStream.set(sid, { ...prev, usage: { ...usage } });
  }

  /** @param {string} streamId */
  function finalizeStream(streamId) {
    const sid = String(streamId ?? "").trim();
    if (!sid) return null;
    const pending = pendingByStream.get(sid);
    pendingByStream.delete(sid);
    if (!pending?.usage) return null;
    const u = pending.usage;
    const inputTokens = u.inputTokens ?? 0;
    const outputTokens = u.outputTokens ?? 0;
    const totalTokens = u.totalTokens ?? inputTokens + outputTokens;
    if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return null;

    let usageBreakdown = finalizeBreakdown(inputTokens, pending.usageBreakdown);

    const data = readRaw();
    const existingIdx = data.records.findIndex((r) => r.streamId === sid);
    /** @type {TokenUsageRecord} */
    const row = sanitizeRecord({
      ...(existingIdx >= 0 ? data.records[existingIdx] : {}),
      ...pending,
      id: existingIdx >= 0 ? data.records[existingIdx].id : randomUUID(),
      timestamp: Date.now(),
      streamId: sid,
      inputTokens,
      outputTokens,
      totalTokens,
      ...(usageBreakdown ? { usageBreakdown } : {}),
    });
    if (!row) return null;

    if (existingIdx >= 0) data.records[existingIdx] = row;
    else data.records.push(row);

    if (data.records.length > MAX_RECORDS) {
      data.records = data.records.slice(data.records.length - MAX_RECORDS);
    }
    writeRaw();
    return row;
  }

  /** @param {Partial<TokenUsageRecord>} entry */
  function recordImmediate(entry) {
    const row = sanitizeRecord({
      ...entry,
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? Date.now(),
      streamId: entry.streamId ?? randomUUID(),
    });
    if (!row) return null;
    const data = readRaw();
    data.records.push(row);
    if (data.records.length > MAX_RECORDS) {
      data.records = data.records.slice(data.records.length - MAX_RECORDS);
    }
    writeRaw();
    return row;
  }

  function resetAll() {
    cache = { version: STORE_VERSION, records: [] };
    pendingByStream.clear();
    writeRaw();
  }

  /** @param {number} ts */
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** @param {TokenUsageRecord[]} records */
  function sumRecords(records) {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    for (const r of records) {
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      totalTokens += r.totalTokens;
    }
    return { inputTokens, outputTokens, totalTokens, requestCount: records.length };
  }

  /**
   * @param {{ range?: "7d" | "30d" | "all"; groupBy?: "day" | "model" | "conversation" }} [opts]
   */
  function queryStats(opts = {}) {
    const range = opts.range === "7d" || opts.range === "30d" ? opts.range : "all";
    const now = Date.now();
    const cutoff =
      range === "7d"
        ? now - 7 * 86400000
        : range === "30d"
          ? now - 30 * 86400000
          : 0;

    const data = readRaw();
    const filtered = data.records.filter((r) => r.timestamp >= cutoff);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const todayRecords = filtered.filter((r) => r.timestamp >= startOfToday.getTime());
    const monthRecords = filtered.filter((r) => r.timestamp >= startOfMonth.getTime());

    /** @type {Map<string, { inputTokens: number; outputTokens: number; totalTokens: number; count: number }>} */
    const byDay = new Map();
    for (const r of filtered) {
      const key = dayKey(r.timestamp);
      const prev = byDay.get(key) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, count: 0 };
      prev.inputTokens += r.inputTokens;
      prev.outputTokens += r.outputTokens;
      prev.totalTokens += r.totalTokens;
      prev.count += 1;
      byDay.set(key, prev);
    }
    const dayLabels = [...byDay.keys()].sort();
    const dailySeries = dayLabels.map((k) => byDay.get(k) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, count: 0 });

    /** @type {Map<string, { modelLabel: string; provider?: string; modelId?: string; inputTokens: number; outputTokens: number; totalTokens: number; count: number }>} */
    const byModel = new Map();
    for (const r of filtered) {
      const key = r.modelProfileId || r.modelLabel || r.modelId || "unknown";
      const prev = byModel.get(key) ?? {
        modelLabel: r.modelLabel || r.modelId || key,
        provider: r.provider,
        modelId: r.modelId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        count: 0,
      };
      prev.inputTokens += r.inputTokens;
      prev.outputTokens += r.outputTokens;
      prev.totalTokens += r.totalTokens;
      prev.count += 1;
      byModel.set(key, prev);
    }
    const modelRows = [...byModel.entries()]
      .map(([modelProfileId, row]) => ({ modelProfileId, ...row }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    /** @type {Map<string, { conversationTitle?: string; inputTokens: number; outputTokens: number; totalTokens: number; count: number; lastAt: number }>} */
    const byConversation = new Map();
    for (const r of filtered) {
      if (!r.conversationId) continue;
      const prev = byConversation.get(r.conversationId) ?? {
        conversationTitle: r.conversationTitle,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        count: 0,
        lastAt: 0,
      };
      if (r.conversationTitle) prev.conversationTitle = r.conversationTitle;
      prev.inputTokens += r.inputTokens;
      prev.outputTokens += r.outputTokens;
      prev.totalTokens += r.totalTokens;
      prev.count += 1;
      prev.lastAt = Math.max(prev.lastAt, r.timestamp);
      byConversation.set(r.conversationId, prev);
    }
    const conversationRows = [...byConversation.entries()]
      .map(([conversationId, row]) => ({ conversationId, ...row }))
      .sort((a, b) => b.lastAt - a.lastAt);

    return {
      range,
      summary: sumRecords(filtered),
      today: sumRecords(todayRecords),
      month: sumRecords(monthRecords),
      daily: {
        labels: dayLabels,
        inputTokens: dailySeries.map((d) => d.inputTokens),
        outputTokens: dailySeries.map((d) => d.outputTokens),
        totalTokens: dailySeries.map((d) => d.totalTokens),
        requestCount: dailySeries.map((d) => d.count),
      },
      byModel: modelRows,
      byConversation: conversationRows.slice(0, 80),
    };
  }

  /**
   * @param {{ limit?: number; offset?: number; conversationId?: string }} [opts]
   */
  function queryRecords(opts = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const conversationId =
      typeof opts.conversationId === "string" ? opts.conversationId.trim() : "";

    let rows = readRaw().records;
    if (conversationId) rows = rows.filter((r) => r.conversationId === conversationId);
    rows = [...rows].sort((a, b) => b.timestamp - a.timestamp);
    const total = rows.length;
    const slice = rows.slice(offset, offset + limit);
    return { total, records: slice };
  }

  return {
    beginStream,
    noteStreamUsage,
    replaceStreamUsage,
    patchStreamBreakdown,
    noteStreamToolCall,
    finalizeStream,
    recordImmediate,
    resetAll,
    queryStats,
    queryRecords,
  };
}

module.exports = { createTokenUsageStore };
