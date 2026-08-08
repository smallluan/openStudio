const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  resolveConversationIdsForCleanup,
  collectStudioGatewaySessionKeys,
  purgeStudioConversationsFromAgentSqlite,
} = require("./openclaw-disk-cleanup.cjs");
const { removeAgentDirectory } = require("./openclaw-agent-crud.cjs");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("resolveConversationIdsForCleanup prefers gatewayConversationId and session id", () => {
  const ids = resolveConversationIdsForCleanup({
    id: "wechat:thread:abc",
    gatewayConversationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    channel: "wechat",
  });
  assert.deepEqual(ids, ["f47ac10b-58cc-4372-a567-0e02b2c3d479", "wechat:thread:abc"]);
});

test("collectStudioGatewaySessionKeys builds per-agent studio suffix keys", () => {
  const stateDir = tempDir("oc-cleanup-keys-");
  writeJson(path.join(stateDir, "openclaw.json"), {
    agents: {
      list: [{ id: "dev" }, { id: "helper" }],
    },
  });
  const keys = collectStudioGatewaySessionKeys(stateDir, ["conv-1"]).sort();
  assert.deepEqual(keys, ["agent:dev:dev#studio:conv-1", "agent:helper:main#studio:conv-1"]);
});

test("purgeStudioConversationsFromAgentSqlite removes matching store + transcript rows", () => {
  const dir = tempDir("oc-cleanup-sqlite-");
  const sessionsDir = path.join(dir, "agents", "dev", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const storePath = path.join(sessionsDir, "sessions.json");
  const sqlitePath = path.join(sessionsDir, "sessions.sqlite");
  const transcriptPath = path.join(sessionsDir, "sess-a.jsonl");
  const sessionKey = "agent:dev:dev#studio:conv-1";

  const db = new DatabaseSync(sqlitePath);
  db.exec(`
CREATE TABLE session_store_meta (
  store_path TEXT NOT NULL PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  legacy_cleaned_at INTEGER
);
CREATE TABLE session_store_entries (
  store_path TEXT NOT NULL,
  session_key TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  updated_at INTEGER,
  session_id TEXT,
  PRIMARY KEY (store_path, session_key)
);
CREATE TABLE session_transcripts (
  store_path TEXT NOT NULL,
  transcript_path TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store_path, transcript_path, seq)
);
`);
  db.prepare(
    "INSERT INTO session_store_meta (store_path, schema_version, revision) VALUES (?, 1, 0)",
  ).run(storePath);
  db.prepare(
    "INSERT INTO session_store_entries (store_path, session_key, entry_json) VALUES (?, ?, ?)",
  ).run(
    storePath,
    sessionKey,
    JSON.stringify({ sessionId: "sess-a", sessionFile: transcriptPath }),
  );
  db.prepare(
    "INSERT INTO session_transcripts (store_path, transcript_path, seq, entry_json, archived) VALUES (?, ?, 1, ?, 0)",
  ).run(storePath, transcriptPath, JSON.stringify({ type: "message" }));
  db.close();

  const removed = purgeStudioConversationsFromAgentSqlite(sqlitePath, storePath, ["conv-1"]);
  assert.equal(removed, 1);

  const verify = new DatabaseSync(sqlitePath);
  const leftEntries = verify
    .prepare("SELECT COUNT(*) AS c FROM session_store_entries WHERE store_path = ?")
    .get(storePath);
  const leftTranscripts = verify
    .prepare("SELECT COUNT(*) AS c FROM session_transcripts WHERE store_path = ?")
    .get(storePath);
  verify.close();
  assert.equal(leftEntries.c, 0);
  assert.equal(leftTranscripts.c, 0);
});

test("removeAgentDirectory deletes the entire agent tree", () => {
  const stateDir = tempDir("oc-cleanup-agent-");
  const agentRoot = path.join(stateDir, "agents", "helper");
  fs.mkdirSync(path.join(agentRoot, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(agentRoot, "sessions", "sessions.sqlite"), "x");
  const result = removeAgentDirectory(stateDir, "helper");
  assert.equal(result.ok, true);
  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(agentRoot), false);
});
