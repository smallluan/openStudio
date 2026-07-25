const fs = require("fs");
const path = require("path");

const STORE_VERSION = 1;
const DIR_NAME = "automation-tasks";
const INDEX_FILE = "tasks.json";

/** @param {string} userDataDir */
function createAutomationTasksStore(userDataDir) {
  const rootDir = () => path.join(userDataDir, DIR_NAME);
  const indexPath = () => path.join(rootDir(), INDEX_FILE);

  /** @returns {Record<string, unknown>[]} */
  function readAll() {
    const file = indexPath();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row) => row && typeof row === "object" && typeof row.cronJobId === "string");
    } catch {
      return [];
    }
  }

  /** @param {Record<string, unknown>[]} rows */
  function writeAll(rows) {
    fs.mkdirSync(rootDir(), { recursive: true });
    const tmp = `${indexPath()}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf8");
    fs.renameSync(tmp, indexPath());
  }

  return {
    list() {
      return readAll();
    },

    /** @param {string} cronJobId */
    get(cronJobId) {
      const id = String(cronJobId ?? "").trim();
      if (!id) return null;
      return readAll().find((row) => row.cronJobId === id) ?? null;
    },

    /** @param {Record<string, unknown>} row */
    upsert(row) {
      const cronJobId = typeof row?.cronJobId === "string" ? row.cronJobId.trim() : "";
      if (!cronJobId) return { ok: false, error: "missing_cron_job_id" };
      const rows = readAll();
      const next = {
        version: STORE_VERSION,
        ...row,
        cronJobId,
        updatedAtMs: Date.now(),
      };
      const idx = rows.findIndex((r) => r.cronJobId === cronJobId);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...next };
      else rows.push({ ...next, createdAtMs: Date.now() });
      writeAll(rows);
      return { ok: true, row: next };
    },

    /** @param {string} cronJobId */
    deleteOne(cronJobId) {
      const id = String(cronJobId ?? "").trim();
      if (!id) return { ok: false, error: "missing_cron_job_id" };
      const rows = readAll();
      const next = rows.filter((r) => r.cronJobId !== id);
      if (next.length === rows.length) return { ok: false, error: "not_found" };
      writeAll(next);
      return { ok: true };
    },

    /** @param {string[]} cronJobIds */
    pruneMissing(cronJobIds) {
      const keep = new Set(cronJobIds.filter((id) => typeof id === "string" && id.trim()));
      const rows = readAll();
      const next = rows.filter((r) => keep.has(r.cronJobId));
      if (next.length !== rows.length) writeAll(next);
      return { ok: true, removed: rows.length - next.length };
    },
  };
}

module.exports = { createAutomationTasksStore };
