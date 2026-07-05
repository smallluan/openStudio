const fs = require("fs");
const path = require("path");

const STORE_VERSION = 1;
const DIR_NAME = "chat-sessions";
const INDEX_FILE = "sessions.jsonl";
const MESSAGES_DIR = "messages";

/** @param {string} id */
function sessionFileKey(id) {
  return Buffer.from(String(id ?? ""), "utf8").toString("base64url");
}

/** @param {string} filePath @param {string} content */
function atomicWriteFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function asObject(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : null;
}

/** @param {string} userDataDir */
function createChatSessionsStore(userDataDir) {
  const rootDir = () => path.join(userDataDir, DIR_NAME);
  const indexPath = () => path.join(rootDir(), INDEX_FILE);
  const messagesDir = () => path.join(rootDir(), MESSAGES_DIR);

  /** @param {string} id */
  function messagesPath(id) {
    return path.join(messagesDir(), `${sessionFileKey(id)}.jsonl`);
  }

  /** @returns {Record<string, unknown>[]} */
  function readIndexRows() {
    const file = indexPath();
    if (!fs.existsSync(file)) return [];
    /** @type {Record<string, unknown>[]} */
    const out = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const row = asObject(parsed);
        if (row && typeof row.id === "string" && row.id.trim()) out.push(row);
      } catch {
        /* skip bad line */
      }
    }
    return out;
  }

  /** @param {Record<string, unknown>[]} rows */
  function writeIndexRows(rows) {
    const body = rows.map((row) => JSON.stringify(row)).join("\n");
    atomicWriteFile(indexPath(), body ? `${body}\n` : "");
  }

  /** @param {string} id @returns {unknown[]} */
  function readMessages(id) {
    const file = messagesPath(id);
    if (!fs.existsSync(file)) return [];
    /** @type {unknown[]} */
    const out = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        /* skip bad line */
      }
    }
    return out;
  }

  /** @param {string} id @param {unknown[]} messages */
  function writeMessages(id, messages) {
    const list = Array.isArray(messages) ? messages : [];
    const body = list.map((m) => JSON.stringify(m)).join("\n");
    atomicWriteFile(messagesPath(id), body ? `${body}\n` : "");
  }

  /** @param {string} id */
  function deleteMessages(id) {
    try {
      fs.unlinkSync(messagesPath(id));
    } catch {
      /* ignore */
    }
  }

  /** @param {Record<string, unknown>} session @returns {Record<string, unknown>} */
  function metaFromSession(session) {
    const row = { ...session };
    delete row.messages;
    row.v = STORE_VERSION;
    return row;
  }

  /** @param {Record<string, unknown>[]} indexRows @returns {Record<string, unknown>[]} */
  function sortIndex(indexRows) {
    return [...indexRows]
      .filter((r) => typeof r.id === "string" && r.id.trim())
      .sort((a, b) => {
        const au = typeof a.updatedAt === "number" ? a.updatedAt : 0;
        const bu = typeof b.updatedAt === "number" ? b.updatedAt : 0;
        return bu - au;
      });
  }

  /** @param {Record<string, unknown>[]} nextIndex */
  function pruneMessageFiles(nextIndex) {
    const keep = new Set(nextIndex.map((r) => String(r.id)));
    const dir = messagesDir();
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const key = name.slice(0, -".jsonl".length);
      let id = "";
      try {
        id = Buffer.from(key, "base64url").toString("utf8");
      } catch {
        continue;
      }
      if (!keep.has(id)) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  }

  function loadAll() {
    return readIndexRows().map((meta) => ({
      ...meta,
      messages: readMessages(String(meta.id)),
    }));
  }

  /** @param {Record<string, unknown>} session */
  function upsert(session) {
    const id = typeof session?.id === "string" ? session.id.trim() : "";
    if (!id) return { ok: false, error: "missing_id" };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const meta = metaFromSession(session);

    const index = readIndexRows().filter((r) => String(r.id) !== id);
    index.push(meta);
    const nextIndex = sortIndex(index);
    writeIndexRows(nextIndex);
    writeMessages(id, messages);
    pruneMessageFiles(nextIndex);
    return { ok: true };
  }

  /** @param {Record<string, unknown>[]} sessions */
  function importLegacy(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    if (list.length === 0) return { ok: true, imported: 0 };
    /** @type {Record<string, unknown>[]} */
    const index = readIndexRows();
    const byId = new Map(index.map((r) => [String(r.id), r]));
    for (const session of list) {
      const row = asObject(session);
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      if (!id) continue;
      byId.set(id, metaFromSession(row));
      writeMessages(id, Array.isArray(row.messages) ? row.messages : []);
    }
    const nextIndex = sortIndex([...byId.values()]);
    writeIndexRows(nextIndex);
    pruneMessageFiles(nextIndex);
    return { ok: true, imported: nextIndex.length };
  }

  /** @param {string} id */
  function deleteOne(id) {
    const sid = String(id ?? "").trim();
    if (!sid) return { ok: false, error: "missing_id" };
    const nextIndex = readIndexRows().filter((r) => String(r.id) !== sid);
    writeIndexRows(nextIndex);
    deleteMessages(sid);
    return { ok: true };
  }

  /** @param {string[]} ids */
  function deleteMany(ids) {
    const drop = new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean));
    if (drop.size === 0) return { ok: true };
    const nextIndex = readIndexRows().filter((r) => !drop.has(String(r.id)));
    writeIndexRows(nextIndex);
    for (const id of drop) deleteMessages(id);
    return { ok: true };
  }

  return {
    loadAll,
    upsert,
    importLegacy,
    deleteOne,
    deleteMany,
  };
}

module.exports = {
  createChatSessionsStore,
};
