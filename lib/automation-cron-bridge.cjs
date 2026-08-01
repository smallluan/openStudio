const { defaultGatewayAgentIdFromConfig } = require("./openclaw-agent-crud.cjs");
const { mapStudioProfileToOpenClaw } = require("./sync-openclaw-agent-from-studio.cjs");
const { resolveDefaultModelProfileId } = require("./automation-defaults.cjs");

/**
 * @param {string} timeStr
 * @returns {{ hour: number; minute: number }}
 */
function parseClockTime(timeStr) {
  const raw = String(timeStr ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return { hour: 9, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number.parseInt(m[1], 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(m[2], 10)));
  return { hour, minute };
}

/**
 * @param {string} dateStr
 * @param {string} timeStr
 */
function combineLocalDateTimeIso(dateStr, timeStr) {
  const d = String(dateStr ?? "").trim();
  if (!d) throw new Error("missing_once_date");
  const parts = d.split("-").map((x) => Number.parseInt(x, 10));
  if (parts.length < 3 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || !Number.isFinite(parts[2])) {
    throw new Error("invalid_once_date");
  }
  const { hour, minute } = parseClockTime(timeStr);
  const dt = new Date(parts[0], parts[1] - 1, parts[2], hour, minute, 0, 0);
  if (Number.isNaN(dt.getTime())) throw new Error("invalid_once_date");
  return dt.toISOString();
}

/**
 * @param {number} value
 * @param {string} unit
 */
function intervalUnitToMs(value, unit) {
  const n = Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  const u = String(unit ?? "hour").trim();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  switch (u) {
    case "minute":
      return n * minute;
    case "hour":
      return n * hour;
    case "day":
      return n * day;
    case "month":
      return n * 30 * day;
    case "quarter":
      return n * 90 * day;
    case "year":
      return n * 365 * day;
    default:
      return n * hour;
  }
}

/**
 * @param {{
 *   frequencyMode?: string;
 *   periodCycle?: string;
 *   periodTime?: string;
 *   intervalValue?: number;
 *   intervalUnit?: string;
 *   onceDate?: string;
 *   onceTime?: string;
 * }} draft
 */
function draftToCronSchedule(draft) {
  const mode = String(draft?.frequencyMode ?? "period").trim();
  if (mode === "once") {
    return {
      kind: "at",
      at: combineLocalDateTimeIso(draft.onceDate, draft.onceTime),
    };
  }
  if (mode === "interval") {
    return {
      kind: "every",
      everyMs: intervalUnitToMs(draft.intervalValue ?? 1, draft.intervalUnit ?? "hour"),
    };
  }
  const { hour, minute } = parseClockTime(draft.periodTime);
  const cycle = String(draft.periodCycle ?? "daily").trim();
  if (cycle === "weekly") {
    return { kind: "cron", expr: `${minute} ${hour} * * 1` };
  }
  if (cycle === "monthly") {
    return { kind: "cron", expr: `${minute} ${hour} 1 * *` };
  }
  return { kind: "cron", expr: `${minute} ${hour} * * *` };
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {string} modelProfileId
 */
function resolveCronModelFromProfile(cfg, modelProfileId) {
  const id = String(modelProfileId ?? "").trim();
  if (!id) return undefined;
  const profiles = Array.isArray(cfg?.modelProfiles) ? cfg.modelProfiles : [];
  const profile = profiles.find((p) => p && p.id === id);
  if (!profile) return undefined;
  const mapped = mapStudioProfileToOpenClaw({
    provider: String(profile.provider ?? "").trim(),
    modelId: String(profile.modelId ?? "").trim(),
    baseUrl: String(profile.baseUrl ?? "").trim(),
  });
  if (mapped?.modelRef) return mapped.modelRef;
  const modelId = String(profile.modelId ?? "").trim();
  if (!modelId) return undefined;
  if (modelId.includes("/")) return modelId;
  const provider = String(profile.provider ?? "").trim();
  // Studio-only provider ids must not be sent to OpenClaw verbatim.
  if (provider === "anthropic-compatible") return `anthropic/${modelId}`;
  if (provider === "openai-compatible") return `openai/${modelId}`;
  if (provider) return `${provider}/${modelId}`;
  return modelId;
}

/**
 * @param {string} channel
 */
function draftToCronDelivery(channel) {
  const ch = String(channel ?? "").trim();
  if (ch === "wechat") {
    return { mode: "announce", channel: "wechat" };
  }
  return { mode: "none" };
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {{
 *   name?: string;
 *   prompt?: string;
 *   modelId?: string;
 *   channel?: string;
 *   frequencyMode?: string;
 *   periodCycle?: string;
 *   periodTime?: string;
 *   intervalValue?: number;
 *   intervalUnit?: string;
 *   onceDate?: string;
 *   onceTime?: string;
 *   effectiveRange?: string[];
 * }} draft
 * @param {string} message
 */
function buildCronAddParams(cfg, draft, message) {
  const name = String(draft?.name ?? "").trim();
  const promptMessage = String(message ?? draft?.prompt ?? "").trim();
  if (!name) throw new Error("missing_name");
  if (!promptMessage) throw new Error("missing_prompt");

  const frequencyMode = String(draft?.frequencyMode ?? "period").trim();
  const schedule = draftToCronSchedule(draft);
  const modelProfileId =
    String(draft?.modelId ?? "").trim() || resolveDefaultModelProfileId(cfg);
  const model = resolveCronModelFromProfile(cfg, modelProfileId);
  const agentId = defaultGatewayAgentIdFromConfig(cfg);

  /** @type {Record<string, unknown>} */
  const payload = {
    kind: "agentTurn",
    message: promptMessage,
  };
  if (model) payload.model = model;

  /** @type {Record<string, unknown>} */
  const params = {
    name,
    schedule,
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload,
    delivery: draftToCronDelivery(draft.channel),
    enabled: true,
    deleteAfterRun: frequencyMode === "once",
  };
  if (agentId) params.agentId = agentId;
  return params;
}

/**
 * @param {import("./config-store.cjs").UserConfig} cfg
 * @param {{
 *   name?: string;
 *   prompt?: string;
 *   modelId?: string;
 *   channel?: string;
 *   frequencyMode?: string;
 *   periodCycle?: string;
 *   periodTime?: string;
 *   intervalValue?: number;
 *   intervalUnit?: string;
 *   onceDate?: string;
 *   onceTime?: string;
 *   effectiveRange?: string[];
 * }} draft
 * @param {string} message
 * @param {{ sessionTarget?: string }} [options]
 */
function buildCronUpdatePatch(cfg, draft, message, options = {}) {
  const name = String(draft?.name ?? "").trim();
  const promptMessage = String(message ?? draft?.prompt ?? "").trim();
  if (!name) throw new Error("missing_name");
  if (!promptMessage) throw new Error("missing_prompt");

  const frequencyMode = String(draft?.frequencyMode ?? "period").trim();
  const schedule = draftToCronSchedule(draft);
  const modelProfileId =
    String(draft?.modelId ?? "").trim() || resolveDefaultModelProfileId(cfg);
  const model = resolveCronModelFromProfile(cfg, modelProfileId);

  /** @type {Record<string, unknown>} */
  const isMainSession = String(options.sessionTarget ?? "").trim() === "main";
  const payload = isMainSession
    ? {
        kind: "systemEvent",
        text: promptMessage,
      }
    : {
        kind: "agentTurn",
        message: promptMessage,
      };
  if (model && !isMainSession) payload.model = model;

  return {
    name,
    schedule,
    payload,
    delivery: draftToCronDelivery(draft.channel),
    deleteAfterRun: frequencyMode === "once",
  };
}

module.exports = {
  buildCronAddParams,
  buildCronUpdatePatch,
  draftToCronSchedule,
  intervalUnitToMs,
  parseClockTime,
  resolveCronModelFromProfile,
};
