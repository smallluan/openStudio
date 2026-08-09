/**
 * Regression: chat.history recent reads must work after SQLite migration
 * deletes legacy .jsonl transcript files.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const openclawDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/openclaw/dist");
const sessionUtilsPath = fs
	.readdirSync(openclawDist)
	.find((name) => name.startsWith("session-utils.fs-") && name.endsWith(".js"));
assert.ok(sessionUtilsPath, "session-utils.fs bundle missing");

const mod = await import(pathToFileURL(path.join(openclawDist, sessionUtilsPath)).href);
const readRecentSessionMessagesAsync = mod.i;
assert.equal(typeof readRecentSessionMessagesAsync, "function");

const histTextPath = fs
	.readdirSync(openclawDist)
	.find((name) => name.startsWith("chat-history-text-") && name.endsWith(".js"));
const histText = await import(pathToFileURL(path.join(openclawDist, histTextPath)).href);
const stripToolMessages = histText.r;
const extractAssistantText = histText.t;

test("patched readRecentSessionMessagesAsync reads sqlite-only child transcripts", async () => {
	const sessionsDir = path.join(os.homedir(), ".openclaw-dev", "agents", "dev", "sessions");
	const storePath = path.join(sessionsDir, "sessions.json");
	const childId = "81e67037-c2c9-4c1f-aad5-df7756af6c61";
	const sessionFile = path.join(sessionsDir, `${childId}.jsonl`);
	assert.equal(fs.existsSync(sessionFile), false, "legacy jsonl should be absent (sqlite-only)");
	assert.ok(fs.existsSync(path.join(sessionsDir, "sessions.sqlite")), "sessions.sqlite missing");

	const messages = await readRecentSessionMessagesAsync(childId, storePath, sessionFile, {
		maxMessages: 50,
	});
	assert.ok(messages.length > 0, "expected messages from sqlite-backed transcript");
	const stripped = stripToolMessages(messages);
	let reply = "";
	for (let i = stripped.length - 1; i >= 0; i -= 1) {
		if (stripped[i]?.role !== "assistant") continue;
		reply = extractAssistantText(stripped[i]) || "";
		if (reply.trim()) break;
	}
	assert.ok(reply.includes("西安"), `expected itinerary text, got: ${reply.slice(0, 120)}`);
	assert.ok(reply.length > 500, `expected substantial reply, got len=${reply.length}`);
});
