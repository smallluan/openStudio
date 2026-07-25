/**
 * Map Automation task dialog drafts to OpenClaw cron schedules.
 */

/** @param {string} timeStr */
function parseClock(timeStr) {
  const raw = String(timeStr ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return { hour: 9, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number.parseInt(m[1], 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(m[2], 10)));
  return { hour, minute };
}

/** @param {number} value @param {string} unit */
function intervalToMs(value, unit) {
  const n = Number.isFinite(value) && value > 0 ? value : 1;
  const u = String(unit ?? "hour");
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (u === "minute") return n * minute;
  if (u === "hour") return n * hour;
  if (u === "day") return n * day;
  if (u === "month") return n * 30 * day;
  if (u === "quarter") return n * 90 * day;
  if (u === "year") return n * 365 * day;
  return n * hour;
}

/** @param {string} dateStr @param {string} timeStr */
function buildAtIso(dateStr, timeStr) {
  const date = String(dateStr ?? "").trim();
  if (!date) throw new Error("once_date_required");
  const { hour, minute } = parseClock(timeStr);
  const parts = date.split("-").map((x) => Number.parseInt(x, 10));
  if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) throw new Error("once_date_invalid");
  const local = new Date(parts[0], parts[1] - 1, parts[2], hour, minute, 0, 0);
  if (Number.isNaN(local.getTime())) throw new Error("once_date_invalid");
  return local.toISOString();
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
  const mode = String(draft?.frequencyMode ?? "period");
  if (mode === "once") {
    return {
      kind: "at",
      at: buildAtIso(draft.onceDate, draft.onceTime),
    };
  }
  if (mode === "interval") {
    return {
      kind: "every",
      everyMs: intervalToMs(draft.intervalValue, draft.intervalUnit),
    };
  }
  const { hour, minute } = parseClock(draft.periodTime);
  const cycle = String(draft.periodCycle ?? "daily");
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
function resolveModelFromProfile(cfg, modelProfileId) {
  const id = String(modelProfileId ?? "").trim();
  const profiles = Array.isArray(cfg?.modelProfiles) ? cfg.modelProfiles : [];
  const profile = id ? profiles.find((p) => p && p.id === id) : profiles[0];
  if (!profile) return "";
  const modelId = typeof profile.modelId === "string" ? profile.modelId.trim() : "";
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
 * @param {Record<string, unknown>} draft
 * @param {string} message
 * @param {import("./config-store.cjs").UserConfig} cfg
 */
function buildCronJobCreateFromDraft(draft, message, cfg) {
  const name = String(draft?.name ?? "").trim();
  const prompt = String(message ?? draft?.prompt ?? "").trim();
  if (!name) throw new Error("task_name_required");
  if (!prompt) throw new Error("task_prompt_required");

  const schedule = draftToCronSchedule(draft);
  const model = resolveModelFromProfile(cfg, String(draft?.modelId ?? ""));
  const delivery = draftToCronDelivery(String(draft?.channel ?? ""));

  /** @type {Record<string, unknown>} */
  const payload = {
    kind: "agentTurn",
    message: prompt,
  };
  if (model) payload.model = model;

  /** @type {Record<string, unknown>} */
  const jobCreate = {
    name,
    schedule,
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload,
    delivery,
    enabled: true,
    deleteAfterRun: schedule.kind === "at",
  };

  return jobCreate;
}

module.exports = {
  draftToCronSchedule,
  buildCronJobCreateFromDraft,
  buildAtIso,
  intervalToMs,
};
