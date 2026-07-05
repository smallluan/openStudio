const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createChatSessionsStore } = require("./chat-sessions-store.cjs");

/** @param {string} prefix */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("chat-sessions-store upserts and loads jsonl sessions", () => {
  const dir = tempDir("os-chat-sessions-");
  const store = createChatSessionsStore(dir);

  assert.deepEqual(store.loadAll(), []);

  store.upsert({
    id: "conv-1",
    title: "Hello",
    updatedAt: 100,
    messages: [{ id: "m1", role: "user", content: "hi" }],
  });

  const loaded = store.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "conv-1");
  assert.equal(loaded[0].title, "Hello");
  assert.equal(loaded[0].messages.length, 1);
  assert.equal(loaded[0].messages[0].content, "hi");

  store.upsert({
    id: "conv-1",
    title: "Hello",
    updatedAt: 200,
    messages: [
      { id: "m1", role: "user", content: "hi" },
      { id: "m2", role: "assistant", content: "hey" },
    ],
  });

  const updated = store.loadAll().find((s) => s.id === "conv-1");
  assert.equal(updated?.messages.length, 2);
});

test("chat-sessions-store deletes and imports legacy", () => {
  const dir = tempDir("os-chat-sessions-");
  const store = createChatSessionsStore(dir);

  store.importLegacy([
    { id: "a", title: "A", updatedAt: 1, messages: [{ id: "m", role: "user", content: "a" }] },
    { id: "b", title: "B", updatedAt: 2, messages: [{ id: "m", role: "user", content: "b" }] },
  ]);
  assert.equal(store.loadAll().length, 2);

  store.deleteOne("a");
  const remaining = store.loadAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "b");

  store.deleteMany(["b"]);
  assert.deepEqual(store.loadAll(), []);
});

test("chat-sessions-store supports colon ids via base64url filenames", () => {
  const dir = tempDir("os-chat-sessions-");
  const store = createChatSessionsStore(dir);
  const id = "wechat:thread:abc-123";

  store.upsert({
    id,
    title: "WeChat",
    updatedAt: 50,
    channel: "wechat",
    messages: [{ id: "m1", role: "user", content: "wx" }],
  });

  const messagesDir = path.join(dir, "chat-sessions", "messages");
  const files = fs.readdirSync(messagesDir);
  assert.equal(files.length, 1);
  assert.match(files[0], /\.jsonl$/);

  const loaded = store.loadAll();
  assert.equal(loaded[0].id, id);
});
