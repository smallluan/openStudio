/**
 * Next fire time for OpenClaw `every` schedules (wall-clock slots from anchor + everyMs).
 * @param {{ kind?: string; everyMs?: number; anchorMs?: number } | null | undefined} schedule
 * @param {number} nowMs
 */
export function computeEveryScheduleNextMs(schedule, nowMs) {
  if (!schedule || schedule.kind !== "every") return null;
  const everyMs = Number(schedule.everyMs);
  if (!Number.isFinite(everyMs) || everyMs <= 0) return null;
  const anchorRaw = Number(schedule.anchorMs);
  const anchorMs = Number.isFinite(anchorRaw) ? anchorRaw : nowMs;
  if (nowMs <= anchorMs) return anchorMs;
  const periods = Math.ceil((nowMs - anchorMs) / everyMs);
  return anchorMs + periods * everyMs;
}

/**
 * @param {string} expr
 */
function parseCronExpr(expr) {
  const parts = String(expr ?? "").trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = Number.parseInt(parts[0], 10);
  const hour = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  return {
    minute,
    hour,
    dayOfMonth: parts[2],
    dayOfWeek: parts[4],
  };
}

/**
 * @param {number} year
 * @param {number} monthIndex
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 */
function localDateMs(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();
}

/**
 * @param {{ kind?: string; expr?: string } | null | undefined} schedule
 * @param {number} nowMs
 */
export function computeCronScheduleNextMs(schedule, nowMs) {
  if (!schedule || schedule.kind !== "cron") return null;
  const parsed = parseCronExpr(schedule.expr);
  if (!parsed) return null;
  const { minute, hour, dayOfMonth, dayOfWeek } = parsed;
  const now = new Date(nowMs);

  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    const targetDom = Number.parseInt(dayOfMonth, 10);
    if (!Number.isFinite(targetDom)) return null;
    let year = now.getFullYear();
    let month = now.getMonth();
    let candidate = localDateMs(year, month, targetDom, hour, minute);
    if (candidate <= nowMs) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = localDateMs(year, month, targetDom, hour, minute);
    }
    return candidate;
  }

  if (dayOfWeek !== "*" && dayOfMonth === "*") {
    const targetDow = Number.parseInt(dayOfWeek, 10);
    if (!Number.isFinite(targetDow)) return null;
    const current = new Date(nowMs);
    current.setHours(hour, minute, 0, 0);
    let delta = targetDow - current.getDay();
    if (delta < 0 || (delta === 0 && current.getTime() <= nowMs)) delta += 7;
    current.setDate(current.getDate() + delta);
    return current.getTime();
  }

  if (dayOfMonth === "*" && dayOfWeek === "*") {
    const current = new Date(nowMs);
    current.setHours(hour, minute, 0, 0);
    if (current.getTime() <= nowMs) {
      current.setDate(current.getDate() + 1);
    }
    return current.getTime();
  }

  return null;
}

/**
 * @param {{ kind?: string; at?: string } | null | undefined} schedule
 * @param {number} nowMs
 */
export function computeAtScheduleNextMs(schedule, nowMs) {
  if (!schedule || schedule.kind !== "at") return null;
  const atMs = Date.parse(String(schedule.at ?? ""));
  if (!Number.isFinite(atMs) || atMs <= nowMs) return null;
  return atMs;
}

/**
 * @param {{ kind?: string; everyMs?: number; anchorMs?: number; expr?: string; at?: string } | null | undefined} schedule
 * @param {number} nowMs
 */
export function computeAutomationScheduleNextMs(schedule, nowMs) {
  if (!schedule || typeof schedule !== "object") return null;
  const kind = String(schedule.kind ?? "").trim();
  if (kind === "every") return computeEveryScheduleNextMs(schedule, nowMs);
  if (kind === "cron") return computeCronScheduleNextMs(schedule, nowMs);
  if (kind === "at") return computeAtScheduleNextMs(schedule, nowMs);
  return null;
}

/**
 * @param {{ kind?: string; everyMs?: number; anchorMs?: number; expr?: string; at?: string } | null | undefined} schedule
 * @param {number} nowMs
 */
export function resolveAutomationDisplayNextRunAtMs(schedule, gatewayNextRunAtMs, nowMs) {
  const scheduleNext = computeAutomationScheduleNextMs(schedule, nowMs);
  if (scheduleNext != null) return scheduleNext;
  const gatewayNext = Number(gatewayNextRunAtMs);
  if (Number.isFinite(gatewayNext) && gatewayNext > 0) return gatewayNext;
  return null;
}

/**
 * OpenClaw error backoff can push the real retry later than the schedule slot.
 * @param {{
 *   lastRunStatus?: string;
 *   nextRunAtMs?: number;
 *   consecutiveErrors?: number;
 *   schedule?: { kind?: string; everyMs?: number; anchorMs?: number; expr?: string; at?: string };
 * }} task
 * @param {number} nowMs
 */
export function isAutomationBackoffActive(task, nowMs) {
  const consecutive = Number(task.consecutiveErrors) || 0;
  if (consecutive <= 0 || String(task.lastRunStatus ?? "") !== "error") return false;
  const gatewayNext = Number(task.nextRunAtMs);
  const scheduleNext = computeAutomationScheduleNextMs(task.schedule, nowMs);
  if (!Number.isFinite(gatewayNext) || scheduleNext == null) return false;
  return gatewayNext > scheduleNext + 15_000;
}

/**
 * Prefer gateway retry time while backoff is active; otherwise show the schedule slot.
 * @param {{
 *   nextRunAtMs?: number;
 *   schedule?: { kind?: string; everyMs?: number; anchorMs?: number; expr?: string; at?: string };
 * }} task
 * @param {number} nowMs
 */
export function resolveAutomationEffectiveNextRunAtMs(task, nowMs) {
  if (isAutomationBackoffActive(task, nowMs)) {
    return Number(task.nextRunAtMs);
  }
  return resolveAutomationDisplayNextRunAtMs(task.schedule, task.nextRunAtMs, nowMs);
}
