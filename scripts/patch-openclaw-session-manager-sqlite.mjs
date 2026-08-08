/**
 * Wire OpenClaw SessionManager hot path to SQLite transcripts.
 *
 * Shipped via postinstall (and apply-openclaw-bundle-patches.mjs for packaged
 * builds). The base SQLite store still lives in patches/openclaw@2026.6.1.patch;
 * this script completes the agent hot-path migration that patch alone missed.
 *
 * Idempotent — safe to re-run. Override target with:
 *   OPENCLAW_PATCH_ROOT=.../openclaw node scripts/patch-openclaw-session-manager-sqlite.mjs
 *
 * Note: folding this into pnpm patchedDependencies via `pnpm patch-commit` fails
 * when the workspace path contains non-ASCII characters (bad absolute diff paths).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const openclawRoot = process.env.OPENCLAW_PATCH_ROOT
	? path.resolve(process.env.OPENCLAW_PATCH_ROOT)
	: path.join(root, "node_modules", "openclaw");
const distDir = path.join(openclawRoot, "dist");

const MARKER = "OPEN_STUDIO_SESSION_MANAGER_SQLITE";

function mustRead(filePath) {
	if (!fs.existsSync(filePath)) throw new Error(`missing ${filePath}`);
	// Normalize CRLF so patch needles stay LF-only and portable.
	return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(filePath, next) {
	const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n") : null;
	if (prev === next) {
		console.log(`[patch-openclaw-session-manager-sqlite] unchanged — ${path.relative(openclawRoot, filePath)}`);
		return false;
	}
	fs.writeFileSync(filePath, next, "utf8");
	console.log(`[patch-openclaw-session-manager-sqlite] applied — ${path.relative(openclawRoot, filePath)}`);
	return true;
}

function replaceOnce(src, find, replacement, label) {
	if (!src.includes(find)) throw new Error(`needle not found (${label})`);
	return src.replace(find, replacement);
}

function findDist(prefix, { contains = null, segments = null, contentIncludes = null } = {}) {
	const hits = fs.readdirSync(distDir).filter((name) => {
		if (!name.endsWith(".js")) return false;
		if (!name.startsWith(prefix)) return false;
		if (contains && !name.includes(contains)) return false;
		if (segments != null) {
			const body = name.slice(0, -3);
			if (body.split("-").length !== segments) return false;
		}
		if (contentIncludes) {
			const text = fs.readFileSync(path.join(distDir, name), "utf8");
			if (!text.includes(contentIncludes)) return false;
		}
		return true;
	});
	const preferred =
		hits.find((name) => {
			const body = name.slice(0, -3);
			return body.split("-").length === 2;
		}) || hits[0];
	if (!preferred) throw new Error(`dist file not found: ${prefix}*.js${contains ? ` contains=${contains}` : ""}${contentIncludes ? ` content=${contentIncludes}` : ""}`);
	return path.join(distDir, preferred);
}

function patchSqliteStore() {
	const filePath = path.join(distDir, "session-sqlite-store-OS1.js");
	let src = mustRead(filePath);
	if (src.includes(MARKER)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — session-sqlite-store-OS1.js already patched`);
		return;
	}

	src = replaceOnce(
		src,
		`import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";`,
		`import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";\n/* ${MARKER} */`,
		"sqlite-store fs import",
	);

	src = replaceOnce(
		src,
		`function cleanupLegacySessionFilesIfNeeded(db, storePath) {
	const meta = db.prepare("SELECT legacy_cleaned_at FROM session_store_meta WHERE store_path = ?").get(storePath);
	if (meta?.legacy_cleaned_at != null) return;
	const sessionsDir = path.dirname(storePath);
	const storeBasename = path.basename(storePath);
	let removed = 0;
	try {
		for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			if (!isLegacySessionArtifactName(entry.name, storeBasename)) continue;
			try {
				rmSync(path.join(sessionsDir, entry.name), { force: true });
				removed += 1;
			} catch {}
		}
		const legacyJsonPath = path.join(sessionsDir, storeBasename);
		if (existsSync(legacyJsonPath) && storeBasename.endsWith(".json")) try {
			rmSync(legacyJsonPath, { force: true });
			removed += 1;
		} catch {}
	} catch {}
	db.prepare("UPDATE session_store_meta SET legacy_cleaned_at = ? WHERE store_path = ?").run(Date.now(), storePath);
	if (removed > 0) bumpSessionStoreRevision(db, storePath);
}`,
		`function parseLegacyTranscriptFileEntries(transcriptPath) {
	if (!existsSync(transcriptPath)) return [];
	try {
		const content = readFileSync(transcriptPath, "utf8");
		const entries = [];
		for (const line of content.split(/\\r?\\n/)) {
			if (!line.trim()) continue;
			try {
				entries.push(JSON.parse(line));
			} catch {}
		}
		return entries;
	} catch {
		return [];
	}
}
function clearTranscriptRows(db, storePathKey, transcriptPathKey) {
	db.prepare("DELETE FROM session_transcripts WHERE store_path = ? AND transcript_path = ?").run(storePathKey, transcriptPathKey);
}
function insertTranscriptEntries(db, storePathKey, transcriptPathKey, entries) {
	let seq = 0;
	const insert = db.prepare("INSERT INTO session_transcripts (store_path, transcript_path, seq, entry_json, entry_id, parent_id, entry_type, timestamp, idempotency_key, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)");
	for (const entry of entries) {
		const fields = parseTranscriptEntryFields(entry);
		insert.run(storePathKey, transcriptPathKey, seq, JSON.stringify(entry), fields.entryId, fields.parentId, fields.entryType, fields.timestamp, fields.idempotencyKey);
		seq += 1;
	}
	return seq;
}
function migrateLegacyTranscriptFileIntoDb(db, storePathKey, transcriptPath) {
	const transcriptPathKey = normalizeTranscriptPath(transcriptPath);
	const fileEntries = parseLegacyTranscriptFileEntries(transcriptPath);
	if (fileEntries.length === 0) return true;
	const header = fileEntries[0];
	if (!header || header.type !== "session" || typeof header.id !== "string") return false;
	const activeCount = db.prepare("SELECT COUNT(*) AS count FROM session_transcripts WHERE store_path = ? AND transcript_path = ? AND archived = 0").get(storePathKey, transcriptPathKey)?.count ?? 0;
	if (fileEntries.length > activeCount) {
		// PRIMARY KEY is (store_path, transcript_path, seq); archived rows still occupy seq.
		clearTranscriptRows(db, storePathKey, transcriptPathKey);
		insertTranscriptEntries(db, storePathKey, transcriptPathKey, fileEntries);
		bumpSessionStoreRevision(db, storePathKey);
	}
	return true;
}
function removeLegacyTranscriptFileIfPresent(transcriptPath) {
	try {
		if (existsSync(transcriptPath)) rmSync(transcriptPath, { force: true });
	} catch {}
}
function cleanupLegacySessionFilesIfNeeded(db, storePath) {
	const meta = db.prepare("SELECT legacy_cleaned_at FROM session_store_meta WHERE store_path = ?").get(storePath);
	const alreadyCleaned = meta?.legacy_cleaned_at != null;
	const sessionsDir = path.dirname(storePath);
	const storeBasename = path.basename(storePath);
	let removed = 0;
	try {
		for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			const isPrimary = isPrimarySessionTranscriptFileName(entry.name) || isCompactionCheckpointTranscriptFileName(entry.name);
			// Keep migrating leftover primary transcripts even after the one-time cleanup mark.
			if (alreadyCleaned && !isPrimary) continue;
			if (!isLegacySessionArtifactName(entry.name, storeBasename)) continue;
			const fullPath = path.join(sessionsDir, entry.name);
			try {
				if (isPrimary) {
					if (!migrateLegacyTranscriptFileIntoDb(db, storePath, fullPath)) continue;
				}
				rmSync(fullPath, { force: true });
				removed += 1;
			} catch {}
		}
		if (!alreadyCleaned) {
			const legacyJsonPath = path.join(sessionsDir, storeBasename);
			if (existsSync(legacyJsonPath) && storeBasename.endsWith(".json")) try {
				rmSync(legacyJsonPath, { force: true });
				removed += 1;
			} catch {}
		}
	} catch {}
	if (!alreadyCleaned) db.prepare("UPDATE session_store_meta SET legacy_cleaned_at = ? WHERE store_path = ?").run(Date.now(), storePath);
	if (removed > 0) bumpSessionStoreRevision(db, storePath);
}`,
		"cleanupLegacySessionFilesIfNeeded",
	);

	src = replaceOnce(
		src,
		`function sessionTranscriptHasEntries(transcriptPath, storePath) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(transcriptPath);
	const storePathKey = resolveTranscriptStorePath(transcriptPath, storePath);
	try {
		const database = openSessionSqliteDatabase(storePathKey);
		const row = database.db.prepare("SELECT 1 AS ok FROM session_transcripts WHERE store_path = ? AND transcript_path = ? AND archived = 0 LIMIT 1").get(storePathKey, transcriptPathKey);
		return Boolean(row?.ok);
	} catch {
		return false;
	}
}
function ensureSessionTranscriptHeaderSqlite(params) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(params.transcriptPath);
	const storePathKey = resolveTranscriptStorePath(params.transcriptPath, params.storePath);
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const db = database.db;
		const existing = db.prepare("SELECT 1 AS ok FROM session_transcripts WHERE store_path = ? AND transcript_path = ? AND archived = 0 LIMIT 1").get(storePathKey, transcriptPathKey);
		if (existing?.ok) return false;
		const header = params.header ?? {
			type: "session",
			version: 3,
			id: params.sessionId,
			timestamp: new Date().toISOString(),
			cwd: params.cwd ?? process.cwd()
		};
		const fields = parseTranscriptEntryFields(header);
		db.prepare("INSERT INTO session_transcripts (store_path, transcript_path, seq, entry_json, entry_id, parent_id, entry_type, timestamp, idempotency_key, archived) VALUES (?, ?, 0, ?, ?, ?, ?, ?, NULL, 0)").run(storePathKey, transcriptPathKey, JSON.stringify(header), fields.entryId, fields.parentId, fields.entryType, fields.timestamp);
		bumpSessionStoreRevision(db, storePathKey);
		return true;
	});
}
function appendSessionTranscriptEntrySqlite(params) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(params.transcriptPath);
	const storePathKey = resolveTranscriptStorePath(params.transcriptPath, params.storePath);
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const db = database.db;
		const maxRow = db.prepare("SELECT MAX(seq) AS maxSeq FROM session_transcripts WHERE store_path = ? AND transcript_path = ?").get(storePathKey, transcriptPathKey);
		const nextSeq = (maxRow?.maxSeq ?? -1) + 1;
		const fields = parseTranscriptEntryFields(params.entry);
		db.prepare("INSERT INTO session_transcripts (store_path, transcript_path, seq, entry_json, entry_id, parent_id, entry_type, timestamp, idempotency_key, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").run(storePathKey, transcriptPathKey, nextSeq, JSON.stringify(params.entry), fields.entryId, fields.parentId, fields.entryType, fields.timestamp, fields.idempotencyKey);
		bumpSessionStoreRevision(db, storePathKey);
		return true;
	});
}
function replaceSessionTranscriptEntriesSqlite(params) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(params.transcriptPath);
	const storePathKey = resolveTranscriptStorePath(params.transcriptPath, params.storePath);
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const db = database.db;
		db.prepare("UPDATE session_transcripts SET archived = 1, archive_reason = ?, archived_at = ? WHERE store_path = ? AND transcript_path = ? AND archived = 0").run("rewrite", Date.now(), storePathKey, transcriptPathKey);
		let seq = 0;
		const insert = db.prepare("INSERT INTO session_transcripts (store_path, transcript_path, seq, entry_json, entry_id, parent_id, entry_type, timestamp, idempotency_key, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)");
		for (const entry of params.entries) {
			const fields = parseTranscriptEntryFields(entry);
			insert.run(storePathKey, transcriptPathKey, seq, JSON.stringify(entry), fields.entryId, fields.parentId, fields.entryType, fields.timestamp, fields.idempotencyKey);
			seq += 1;
		}
		bumpSessionStoreRevision(db, storePathKey);
		return true;
	});
}`,
		`function sessionTranscriptHasEntries(transcriptPath, storePath) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(transcriptPath);
	const storePathKey = resolveTranscriptStorePath(transcriptPath, storePath);
	try {
		const database = openSessionSqliteDatabase(storePathKey);
		const row = database.db.prepare("SELECT 1 AS ok FROM session_transcripts WHERE store_path = ? AND transcript_path = ? AND archived = 0 LIMIT 1").get(storePathKey, transcriptPathKey);
		return Boolean(row?.ok);
	} catch {
		return false;
	}
}
function sessionTranscriptExists(transcriptPath, storePath) {
	if (sessionTranscriptHasEntries(transcriptPath, storePath)) return true;
	try {
		return existsSync(normalizeTranscriptPath(transcriptPath));
	} catch {
		return false;
	}
}
function migrateLegacyTranscriptFileToSqlite(transcriptPath, storePath) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(transcriptPath);
	const storePathKey = resolveTranscriptStorePath(transcriptPath, storePath);
	if (!existsSync(transcriptPathKey)) return false;
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const migrated = migrateLegacyTranscriptFileIntoDb(database.db, storePathKey, transcriptPathKey);
		if (migrated) removeLegacyTranscriptFileIfPresent(transcriptPathKey);
		return migrated;
	});
}
function listSessionTranscriptPathsInDirSqlite(sessionsDir) {
	if (!isOpenStudioSessionSqliteEnabled()) return null;
	const storePathKey = normalizeStorePath(path.join(path.resolve(sessionsDir), "sessions.json"));
	try {
		const database = openSessionSqliteDatabase(storePathKey);
		const rows = database.db.prepare("SELECT DISTINCT transcript_path FROM session_transcripts WHERE store_path = ? AND archived = 0").all(storePathKey);
		return rows.map((row) => row.transcript_path).filter((value) => typeof value === "string" && value.length > 0);
	} catch {
		return [];
	}
}
function ensureSessionTranscriptHeaderSqlite(params) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(params.transcriptPath);
	const storePathKey = resolveTranscriptStorePath(params.transcriptPath, params.storePath);
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const db = database.db;
		// Prefer migrating a richer legacy JSONL body before creating/keeping a header-only row.
		if (existsSync(transcriptPathKey)) migrateLegacyTranscriptFileIntoDb(db, storePathKey, transcriptPathKey);
		const existing = db.prepare("SELECT 1 AS ok FROM session_transcripts WHERE store_path = ? AND transcript_path = ? AND archived = 0 LIMIT 1").get(storePathKey, transcriptPathKey);
		if (existing?.ok) {
			removeLegacyTranscriptFileIfPresent(transcriptPathKey);
			return false;
		}
		const header = params.header ?? {
			type: "session",
			version: 3,
			id: params.sessionId,
			timestamp: new Date().toISOString(),
			cwd: params.cwd ?? process.cwd()
		};
		clearTranscriptRows(db, storePathKey, transcriptPathKey);
		insertTranscriptEntries(db, storePathKey, transcriptPathKey, [header]);
		bumpSessionStoreRevision(db, storePathKey);
		removeLegacyTranscriptFileIfPresent(transcriptPathKey);
		return true;
	});
}
function appendSessionTranscriptEntrySqlite(params) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(params.transcriptPath);
	const storePathKey = resolveTranscriptStorePath(params.transcriptPath, params.storePath);
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const db = database.db;
		if (existsSync(transcriptPathKey)) migrateLegacyTranscriptFileIntoDb(db, storePathKey, transcriptPathKey);
		const activeMax = db.prepare("SELECT MAX(seq) AS maxSeq FROM session_transcripts WHERE store_path = ? AND transcript_path = ? AND archived = 0").get(storePathKey, transcriptPathKey);
		let nextSeq = (activeMax?.maxSeq ?? -1) + 1;
		if (activeMax?.maxSeq == null) {
			// Soft-deleted rows still occupy seq values in the primary key.
			clearTranscriptRows(db, storePathKey, transcriptPathKey);
			nextSeq = 0;
		}
		const fields = parseTranscriptEntryFields(params.entry);
		db.prepare("INSERT INTO session_transcripts (store_path, transcript_path, seq, entry_json, entry_id, parent_id, entry_type, timestamp, idempotency_key, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").run(storePathKey, transcriptPathKey, nextSeq, JSON.stringify(params.entry), fields.entryId, fields.parentId, fields.entryType, fields.timestamp, fields.idempotencyKey);
		bumpSessionStoreRevision(db, storePathKey);
		removeLegacyTranscriptFileIfPresent(transcriptPathKey);
		return true;
	});
}
function replaceSessionTranscriptEntriesSqlite(params) {
	if (!isOpenStudioSessionSqliteEnabled()) return false;
	const transcriptPathKey = normalizeTranscriptPath(params.transcriptPath);
	const storePathKey = resolveTranscriptStorePath(params.transcriptPath, params.storePath);
	return runSessionSqliteTransaction(storePathKey, (database) => {
		const db = database.db;
		clearTranscriptRows(db, storePathKey, transcriptPathKey);
		insertTranscriptEntries(db, storePathKey, transcriptPathKey, params.entries);
		bumpSessionStoreRevision(db, storePathKey);
		removeLegacyTranscriptFileIfPresent(transcriptPathKey);
		return true;
	});
}`,
		"transcript CRUD",
	);

	src = replaceOnce(
		src,
		`export { archiveSessionTranscriptSqlite as a, ensureSessionTranscriptHeaderSqlite as c, getSessionStoreRevisionSnapshot as d, findTranscriptMessageByIdempotencyKeySqlite as f, loadSessionStoreEntries as h, readTranscriptFileStateSqlite as i, sessionTranscriptHasEntries as l, readSessionTranscriptLinesSqlite as m, normalizeTranscriptPath as n, saveSessionStoreEntries as o, replaceSessionTranscriptEntriesSqlite as p, resolveStorePathFromTranscriptPath as r, appendSessionTranscriptEntrySqlite as s, streamSessionTranscriptLinesReverseSqlite as t, transcriptPathUsesSqlite as u, visitSessionTranscriptLinesSqlite as v, readTranscriptLeafInfoSqlite as x, streamSessionTranscriptLinesSqlite as y, sessionStoreUsesSqlite as z };`,
		`export { archiveSessionTranscriptSqlite as a, listSessionTranscriptPathsInDirSqlite as b, ensureSessionTranscriptHeaderSqlite as c, getSessionStoreRevisionSnapshot as d, sessionTranscriptExists as e, findTranscriptMessageByIdempotencyKeySqlite as f, removeLegacyTranscriptFileIfPresent as g, loadSessionStoreEntries as h, readTranscriptFileStateSqlite as i, migrateLegacyTranscriptFileToSqlite as j, sessionTranscriptHasEntries as l, readSessionTranscriptLinesSqlite as m, normalizeTranscriptPath as n, saveSessionStoreEntries as o, replaceSessionTranscriptEntriesSqlite as p, resolveStorePathFromTranscriptPath as r, appendSessionTranscriptEntrySqlite as s, streamSessionTranscriptLinesReverseSqlite as t, transcriptPathUsesSqlite as u, visitSessionTranscriptLinesSqlite as v, readTranscriptLeafInfoSqlite as x, streamSessionTranscriptLinesSqlite as y, sessionStoreUsesSqlite as z };`,
		"sqlite-store exports",
	);

	writeIfChanged(filePath, src);
}

function patchSessionManager() {
	const filePath = path.join(distDir, "session-manager-LJPhjpMG.js");
	let src = mustRead(filePath);
	if (src.includes(MARKER)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — session-manager already patched`);
		return;
	}

	src = replaceOnce(
		src,
		`import { i as writeJsonlEntriesSync, n as appendJsonlEntrySync } from "./transcript-jsonl-B-FDKU0h.js";
import { i as getAgentDir, l as getSessionsDir } from "./config-B-5YZEwW.js";`,
		`import { i as writeJsonlEntriesSync, n as appendJsonlEntrySync } from "./transcript-jsonl-B-FDKU0h.js";
import { b as listSessionTranscriptPathsInDirSqlite, e as sessionTranscriptExists, g as removeLegacyTranscriptFileIfPresent, i as readTranscriptFileStateSqlite, j as migrateLegacyTranscriptFileToSqlite, p as replaceSessionTranscriptEntriesSqlite, s as appendSessionTranscriptEntrySqlite, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";
/* ${MARKER} */
import { i as getAgentDir, l as getSessionsDir } from "./config-B-5YZEwW.js";`,
		"session-manager import",
	);

	src = replaceOnce(
		src,
		`/** Exported for testing */
function loadEntriesFromFile(filePath) {
	if (!existsSync(filePath)) return [];
	const entries = parseJsonlEntries(readFileSync(filePath, "utf8"));
	if (entries.length === 0) return entries;
	const header = entries[0];
	if (header.type !== "session" || typeof header.id !== "string") return [];
	return entries;
}`,
		`function loadEntriesFromSqliteOrFile(filePath) {
	if (transcriptPathUsesSqlite(filePath)) {
		migrateLegacyTranscriptFileToSqlite(filePath);
		const sqliteEntries = readTranscriptFileStateSqlite({ sessionFile: filePath });
		if (sqliteEntries.length > 0) {
			const header = sqliteEntries[0];
			if (header?.type === "session" && typeof header.id === "string") {
				removeLegacyTranscriptFileIfPresent(filePath);
				return sqliteEntries;
			}
			return [];
		}
	}
	if (!existsSync(filePath)) return [];
	const entries = parseJsonlEntries(readFileSync(filePath, "utf8"));
	if (entries.length === 0) return entries;
	const header = entries[0];
	if (header.type !== "session" || typeof header.id !== "string") return [];
	if (transcriptPathUsesSqlite(filePath)) {
		replaceSessionTranscriptEntriesSqlite({
			transcriptPath: filePath,
			entries
		});
		removeLegacyTranscriptFileIfPresent(filePath);
	}
	return entries;
}
/** Exported for testing */
function loadEntriesFromFile(filePath) {
	return loadEntriesFromSqliteOrFile(filePath);
}`,
		"loadEntriesFromFile",
	);

	src = replaceOnce(
		src,
		`function isValidSessionFile(filePath) {
	try {
		const fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(512);
		const bytesRead = readSync(fd, buffer, 0, 512, 0);
		closeSync(fd);
		const firstLine = buffer.toString("utf8", 0, bytesRead).split("\\n")[0];
		if (!firstLine) return false;
		const header = JSON.parse(firstLine);
		return header.type === "session" && typeof header.id === "string";
	} catch {
		return false;
	}
}
/** Exported for testing */
function findMostRecentSession(sessionDir) {
	try {
		return readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl")).map((f) => join(sessionDir, f)).filter(isValidSessionFile).map((path) => ({
			path,
			mtime: statSync(path).mtime
		})).toSorted((a, b) => b.mtime.getTime() - a.mtime.getTime())[0]?.path || null;
	} catch {
		return null;
	}
}`,
		`function isValidSessionFile(filePath) {
	try {
		if (transcriptPathUsesSqlite(filePath)) {
			const entries = loadEntriesFromFile(filePath);
			const header = entries[0];
			return header?.type === "session" && typeof header.id === "string";
		}
		const fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(512);
		const bytesRead = readSync(fd, buffer, 0, 512, 0);
		closeSync(fd);
		const firstLine = buffer.toString("utf8", 0, bytesRead).split("\\n")[0];
		if (!firstLine) return false;
		const header = JSON.parse(firstLine);
		return header.type === "session" && typeof header.id === "string";
	} catch {
		return false;
	}
}
function listSessionTranscriptCandidatePaths(sessionDir) {
	const paths = /* @__PURE__ */ new Set();
	if (transcriptPathUsesSqlite(sessionDir)) {
		for (const transcriptPath of listSessionTranscriptPathsInDirSqlite(sessionDir) ?? []) paths.add(resolve(transcriptPath));
	}
	try {
		for (const name of readdirSync(sessionDir)) {
			if (!name.endsWith(".jsonl")) continue;
			if (name.includes(".trajectory") || name.includes(".corrupt-") || name.endsWith(".bak")) continue;
			paths.add(resolve(join(sessionDir, name)));
		}
	} catch {}
	return [...paths];
}
/** Exported for testing */
function findMostRecentSession(sessionDir) {
	try {
		return listSessionTranscriptCandidatePaths(sessionDir).filter(isValidSessionFile).map((path) => {
			let mtime = /* @__PURE__ */ new Date(0);
			try {
				if (existsSync(path)) mtime = statSync(path).mtime;
				else {
					const entries = loadEntriesFromFile(path);
					const header = entries.find((entry) => entry.type === "session");
					const headerTime = typeof header?.timestamp === "string" ? new Date(header.timestamp) : null;
					if (headerTime && !Number.isNaN(headerTime.getTime())) mtime = headerTime;
				}
			} catch {}
			return {
				path,
				mtime
			};
		}).toSorted((a, b) => b.mtime.getTime() - a.mtime.getTime())[0]?.path || null;
	} catch {
		return null;
	}
}`,
		"findMostRecentSession",
	);

	src = replaceOnce(
		src,
		`async function buildSessionInfo(filePath) {
	try {
		const content = await readFile(filePath, "utf8");
		const entries = [];
		const lines = content.trim().split("\\n");
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				entries.push(JSON.parse(line));
			} catch {}
		}
		if (entries.length === 0) return null;
		const header = entries[0];
		if (header.type !== "session") return null;
		const stats = await stat(filePath);
		let messageCount = 0;
		let firstMessage = "";
		const allMessages = [];
		let name;
		for (const entry of entries) {
			if (entry.type === "session_info") name = entry.name?.trim() || void 0;
			if (entry.type !== "message") continue;
			messageCount++;
			const message = entry.message;
			if (!isMessageWithContent(message)) continue;
			if (message.role !== "user" && message.role !== "assistant") continue;
			const textContent = extractTextContent(message);
			if (!textContent) continue;
			allMessages.push(textContent);
			if (!firstMessage && message.role === "user") firstMessage = textContent;
		}
		const cwd = typeof header.cwd === "string" ? header.cwd : "";
		const parentSessionPath = header.parentSession;
		const modified = getSessionModifiedDate(entries, header, stats.mtime);
		return {
			path: filePath,
			id: header.id,
			cwd,
			name,
			parentSessionPath,
			created: new Date(header.timestamp),
			modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
			allMessagesText: allMessages.join(" ")
		};
	} catch {
		return null;
	}
}`,
		`async function buildSessionInfo(filePath) {
	try {
		const entries = loadEntriesFromFile(filePath);
		if (entries.length === 0) return null;
		const header = entries[0];
		if (header.type !== "session") return null;
		let statsMtime = /* @__PURE__ */ new Date(0);
		try {
			statsMtime = (await stat(filePath)).mtime;
		} catch {
			const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp) : null;
			if (headerTime && !Number.isNaN(headerTime.getTime())) statsMtime = headerTime;
		}
		let messageCount = 0;
		let firstMessage = "";
		const allMessages = [];
		let name;
		for (const entry of entries) {
			if (entry.type === "session_info") name = entry.name?.trim() || void 0;
			if (entry.type !== "message") continue;
			messageCount++;
			const message = entry.message;
			if (!isMessageWithContent(message)) continue;
			if (message.role !== "user" && message.role !== "assistant") continue;
			const textContent = extractTextContent(message);
			if (!textContent) continue;
			allMessages.push(textContent);
			if (!firstMessage && message.role === "user") firstMessage = textContent;
		}
		const cwd = typeof header.cwd === "string" ? header.cwd : "";
		const parentSessionPath = header.parentSession;
		const modified = getSessionModifiedDate(entries, header, statsMtime);
		return {
			path: filePath,
			id: header.id,
			cwd,
			name,
			parentSessionPath,
			created: new Date(header.timestamp),
			modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
			allMessagesText: allMessages.join(" ")
		};
	} catch {
		return null;
	}
}`,
		"buildSessionInfo",
	);

	src = replaceOnce(
		src,
		`async function listSessionsFromDir(dir, onProgress, progressOffset = 0, progressTotal) {
	const sessions = [];
	if (!existsSync(dir)) return sessions;
	try {
		const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
		const total = progressTotal ?? files.length;
		let loaded = 0;
		const results = await buildSessionInfosWithConcurrency(files, () => {
			loaded++;
			onProgress?.(progressOffset + loaded, total);
		});
		for (const info of results) if (info) sessions.push(info);
	} catch {}
	return sessions;
}`,
		`async function listSessionsFromDir(dir, onProgress, progressOffset = 0, progressTotal) {
	const sessions = [];
	if (!existsSync(dir) && !(transcriptPathUsesSqlite(dir) && (listSessionTranscriptPathsInDirSqlite(dir) ?? []).length > 0)) return sessions;
	try {
		const files = listSessionTranscriptCandidatePaths(dir);
		const total = progressTotal ?? files.length;
		let loaded = 0;
		const results = await buildSessionInfosWithConcurrency(files, () => {
			loaded++;
			onProgress?.(progressOffset + loaded, total);
		});
		for (const info of results) if (info) sessions.push(info);
	} catch {}
	return sessions;
}`,
		"listSessionsFromDir",
	);

	src = replaceOnce(
		src,
		`	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(sessionFile) {
		this.sessionFile = resolve(sessionFile);
		this.recoveredCorruptHeader = false;
		if (existsSync(this.sessionFile)) {
			this.fileEntries = loadEntriesFromFile(this.sessionFile);
			if (this.fileEntries.length === 0) {
				const recoveredEntries = recoverCorruptSessionEntries(this.sessionFile, this.cwd);`,
		`	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(sessionFile) {
		this.sessionFile = resolve(sessionFile);
		this.recoveredCorruptHeader = false;
		const hasExisting = sessionTranscriptExists(this.sessionFile) || existsSync(this.sessionFile);
		if (hasExisting) {
			this.fileEntries = loadEntriesFromFile(this.sessionFile);
			if (this.fileEntries.length === 0) {
				const recoveredEntries = !transcriptPathUsesSqlite(this.sessionFile) || existsSync(this.sessionFile) ? recoverCorruptSessionEntries(this.sessionFile, this.cwd) : null;`,
		"setSessionFile",
	);

	src = replaceOnce(
		src,
		`	rewriteFile() {
		if (!this.shouldPersist || !this.sessionFile) return;
		writeJsonlEntriesSync(this.sessionFile, this.fileEntries);
	}`,
		`	rewriteFile() {
		if (!this.shouldPersist || !this.sessionFile) return;
		if (transcriptPathUsesSqlite(this.sessionFile)) {
			replaceSessionTranscriptEntriesSqlite({
				transcriptPath: this.sessionFile,
				entries: this.fileEntries
			});
			return;
		}
		writeJsonlEntriesSync(this.sessionFile, this.fileEntries);
	}`,
		"rewriteFile",
	);

	src = replaceOnce(
		src,
		`	persist(entry) {
		if (!this.shouldPersist || !this.sessionFile) return;
		if (!this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant")) {
			this.flushed = false;
			return;
		}
		if (!this.flushed) {
			writeJsonlEntriesSync(this.sessionFile, this.fileEntries);
			this.flushed = true;
		} else appendJsonlEntrySync(this.sessionFile, entry);
	}`,
		`	persist(entry) {
		if (!this.shouldPersist || !this.sessionFile) return;
		if (!this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant")) {
			this.flushed = false;
			return;
		}
		if (transcriptPathUsesSqlite(this.sessionFile)) {
			if (!this.flushed) {
				replaceSessionTranscriptEntriesSqlite({
					transcriptPath: this.sessionFile,
					entries: this.fileEntries
				});
				this.flushed = true;
			} else appendSessionTranscriptEntrySqlite({
				transcriptPath: this.sessionFile,
				entry
			});
			return;
		}
		if (!this.flushed) {
			writeJsonlEntriesSync(this.sessionFile, this.fileEntries);
			this.flushed = true;
		} else appendJsonlEntrySync(this.sessionFile, entry);
	}`,
		"persist",
	);

	src = replaceOnce(
		src,
		`		const newSessionFile = join(dir, \`\${timestamp.replace(/[:.]/g, "-")}_\${newSessionId}.jsonl\`);
		appendJsonlEntrySync(newSessionFile, {
			type: "session",
			version: 3,
			id: newSessionId,
			timestamp,
			cwd: targetCwd,
			parentSession: sourcePath
		});
		for (const entry of sourceEntries) if (entry.type !== "session") appendJsonlEntrySync(newSessionFile, entry);
		return new SessionManager(targetCwd, dir, newSessionFile, true);`,
		`		const newSessionFile = join(dir, \`\${timestamp.replace(/[:.]/g, "-")}_\${newSessionId}.jsonl\`);
		const header = {
			type: "session",
			version: 3,
			id: newSessionId,
			timestamp,
			cwd: targetCwd,
			parentSession: sourcePath
		};
		if (transcriptPathUsesSqlite(newSessionFile)) {
			const entries = [header, ...sourceEntries.filter((entry) => entry.type !== "session")];
			replaceSessionTranscriptEntriesSqlite({
				transcriptPath: newSessionFile,
				entries
			});
		} else {
			appendJsonlEntrySync(newSessionFile, header);
			for (const entry of sourceEntries) if (entry.type !== "session") appendJsonlEntrySync(newSessionFile, entry);
		}
		return new SessionManager(targetCwd, dir, newSessionFile, true);`,
		"forkFrom",
	);

	src = replaceOnce(
		src,
		`			for (const dir of dirs) try {
				const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
				dirFiles.push(files.map((f) => join(dir, f)));
				totalFiles += files.length;
			} catch {
				dirFiles.push([]);
			}`,
		`			for (const dir of dirs) try {
				const files = listSessionTranscriptCandidatePaths(dir);
				dirFiles.push(files);
				totalFiles += files.length;
			} catch {
				dirFiles.push([]);
			}`,
		"listAll",
	);

	writeIfChanged(filePath, src);
}

function upgradeSelectionSqliteFingerprint(src) {
	const bad = `function readSqliteSessionFileFingerprint(sessionFile) {
	if (!transcriptPathUsesSqlite(sessionFile)) return null;
	if (!sessionTranscriptHasEntries(sessionFile)) return { exists: false };
	const snapshot = getSessionStoreRevisionSnapshot(resolveStorePathFromTranscriptPath(sessionFile));
	const revision = BigInt(snapshot?.mtimeMs ?? 0);
	const size = BigInt(snapshot?.sizeBytes ?? 0);
	return {
		exists: true,
		dev: 0n,
		ino: 0n,
		size,
		mtimeNs: revision * 1000000n,
		ctimeNs: revision * 1000000n
	};
}`;
	const good = `function readSqliteSessionFileFingerprint(sessionFile) {
	if (!transcriptPathUsesSqlite(sessionFile)) return null;
	// Stable logical identity for SQLite-backed transcripts.
	// Do NOT key this off store revision/entry counts: SessionManager writes and
	// session-index updates bump those during a normal run, which false-triggers
	// EmbeddedAttemptSessionTakeoverError when the prompt lock is reacquired.
	// SQLite transactions already serialize concurrent writers.
	const key = resolveStorePathFromTranscriptPath(sessionFile) + "\\0" + sessionFile;
	let hash = 0n;
	for (let i = 0; i < key.length; i++) hash = (hash * 131n + BigInt(key.charCodeAt(i))) & 0xffffffffffffffffn;
	return {
		exists: true,
		dev: 0n,
		ino: hash === 0n ? 1n : hash,
		size: 1n,
		mtimeNs: 0n,
		ctimeNs: 0n
	};
}`;
	return src.includes(bad) ? src.replace(bad, good) : src;
}

function upgradeSelectionUnusedImports(src) {
	const unused =
		`import { d as getSessionStoreRevisionSnapshot, e as sessionTranscriptExists, i as readTranscriptFileStateSqlite, l as sessionTranscriptHasEntries, p as replaceSessionTranscriptEntriesSqlite, r as resolveStorePathFromTranscriptPath, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";`;
	const cleaned =
		`import { e as sessionTranscriptExists, i as readTranscriptFileStateSqlite, l as sessionTranscriptHasEntries, p as replaceSessionTranscriptEntriesSqlite, r as resolveStorePathFromTranscriptPath, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";`;
	return src.includes(unused) ? src.replace(unused, cleaned) : src;
}

function patchSelection() {
	const filePath = findDist("selection-", { segments: 2 });
	let src = mustRead(filePath);
	if (src.includes(MARKER)) {
		const next = upgradeSelectionUnusedImports(upgradeSelectionSqliteFingerprint(src));
		writeIfChanged(filePath, next);
		console.log(`[patch-openclaw-session-manager-sqlite] skip — selection already patched`);
		return;
	}

	src = replaceOnce(
		src,
		`import { o as writeJsonlLines, r as serializeJsonlLine } from "./transcript-jsonl-B-FDKU0h.js";`,
		`import { o as writeJsonlLines, r as serializeJsonlLine } from "./transcript-jsonl-B-FDKU0h.js";
import { e as sessionTranscriptExists, i as readTranscriptFileStateSqlite, l as sessionTranscriptHasEntries, p as replaceSessionTranscriptEntriesSqlite, r as resolveStorePathFromTranscriptPath, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";
/* ${MARKER} */`,
		"selection import",
	);

	src = replaceOnce(
		src,
		`async function readSessionFileFingerprint(sessionFile) {
	try {
		const stat = await fs$1.stat(sessionFile, { bigint: true });
		return {
			exists: true,
			dev: stat.dev,
			ino: stat.ino,
			size: stat.size,
			mtimeNs: stat.mtimeNs,
			ctimeNs: stat.ctimeNs
		};
	} catch (err) {
		if (err.code === "ENOENT") return { exists: false };
		throw err;
	}
}
function readSessionFileFingerprintSync(sessionFile) {
	try {
		const stat = statSync(sessionFile, { bigint: true });
		return {
			exists: true,
			dev: stat.dev,
			ino: stat.ino,
			size: stat.size,
			mtimeNs: stat.mtimeNs,
			ctimeNs: stat.ctimeNs
		};
	} catch (err) {
		if (err.code === "ENOENT") return { exists: false };
		throw err;
	}
}`,
		`function readSqliteSessionFileFingerprint(sessionFile) {
	if (!transcriptPathUsesSqlite(sessionFile)) return null;
	// Stable logical identity for SQLite-backed transcripts.
	// Do NOT key this off store revision/entry counts: SessionManager writes and
	// session-index updates bump those during a normal run, which false-triggers
	// EmbeddedAttemptSessionTakeoverError when the prompt lock is reacquired.
	// SQLite transactions already serialize concurrent writers.
	const key = resolveStorePathFromTranscriptPath(sessionFile) + "\\0" + sessionFile;
	let hash = 0n;
	for (let i = 0; i < key.length; i++) hash = (hash * 131n + BigInt(key.charCodeAt(i))) & 0xffffffffffffffffn;
	return {
		exists: true,
		dev: 0n,
		ino: hash === 0n ? 1n : hash,
		size: 1n,
		mtimeNs: 0n,
		ctimeNs: 0n
	};
}
async function readSessionFileFingerprint(sessionFile) {
	try {
		const stat = await fs$1.stat(sessionFile, { bigint: true });
		return {
			exists: true,
			dev: stat.dev,
			ino: stat.ino,
			size: stat.size,
			mtimeNs: stat.mtimeNs,
			ctimeNs: stat.ctimeNs
		};
	} catch (err) {
		if (err.code === "ENOENT") {
			const sqliteFingerprint = readSqliteSessionFileFingerprint(sessionFile);
			if (sqliteFingerprint) return sqliteFingerprint;
			return { exists: false };
		}
		throw err;
	}
}
function readSessionFileFingerprintSync(sessionFile) {
	try {
		const stat = statSync(sessionFile, { bigint: true });
		return {
			exists: true,
			dev: stat.dev,
			ino: stat.ino,
			size: stat.size,
			mtimeNs: stat.mtimeNs,
			ctimeNs: stat.ctimeNs
		};
	} catch (err) {
		if (err.code === "ENOENT") {
			const sqliteFingerprint = readSqliteSessionFileFingerprint(sessionFile);
			if (sqliteFingerprint) return sqliteFingerprint;
			return { exists: false };
		}
		throw err;
	}
}`,
		"fingerprint",
	);

	src = replaceOnce(
		src,
		`async function assertExistingHeaderIsReadable(sessionFile) {
	const firstLine = (await fs$1.readFile(sessionFile, "utf-8")).split("\\n").find((line) => line.trim());
	if (!firstLine) return;
	let parsed;
	try {
		parsed = JSON.parse(firstLine);
	} catch (error) {
		throw new Error(\`Refusing to reset session transcript with unreadable header: \${sessionFile}\`, { cause: error });
	}
	if (!isRecord$1(parsed) || parsed.type !== "session") throw new Error(\`Refusing to reset session transcript with invalid header: \${sessionFile}\`);
}
/**
* session runtime SessionManager persistence quirk:`,
		`async function assertExistingHeaderIsReadable(sessionFile) {
	if (transcriptPathUsesSqlite(sessionFile)) {
		if (!sessionTranscriptHasEntries(sessionFile)) return;
		const header = readTranscriptFileStateSqlite({ sessionFile })[0];
		if (!isRecord$1(header) || header.type !== "session") throw new Error(\`Refusing to reset session transcript with invalid header: \${sessionFile}\`);
		return;
	}
	const firstLine = (await fs$1.readFile(sessionFile, "utf-8")).split("\\n").find((line) => line.trim());
	if (!firstLine) return;
	let parsed;
	try {
		parsed = JSON.parse(firstLine);
	} catch (error) {
		throw new Error(\`Refusing to reset session transcript with unreadable header: \${sessionFile}\`, { cause: error });
	}
	if (!isRecord$1(parsed) || parsed.type !== "session") throw new Error(\`Refusing to reset session transcript with invalid header: \${sessionFile}\`);
}
/**
* session runtime SessionManager persistence quirk:`,
		"assertExistingHeaderIsReadable",
	);

	src = replaceOnce(
		src,
		`async function prepareSessionManagerForRun(params) {
	const sm = params.sessionManager;
	const header = sm.fileEntries.find((e) => e.type === "session");
	const hasAssistant = sm.fileEntries.some((e) => e.type === "message" && e.message?.role === "assistant");
	if (!params.hadSessionFile && header) {
		header.id = params.sessionId;
		header.cwd = params.cwd;
		sm.sessionId = params.sessionId;
		sm.cwd = params.cwd;
		return;
	}
	if (params.hadSessionFile && header && !hasAssistant) {
		if (sm.wasRecoveredFromCorruptHeader?.()) {
			header.id = params.sessionId;
			header.cwd = params.cwd;
			sm.sessionId = params.sessionId;
			sm.cwd = params.cwd;
			await writeJsonlLines(params.sessionFile, sm.fileEntries.map(serializeJsonlLine), { mode: 384 });
			sm.flushed = true;
			return;
		}
		await assertExistingHeaderIsReadable(params.sessionFile);
		await fs$1.writeFile(params.sessionFile, "", "utf-8");
		header.id = params.sessionId;
		header.cwd = params.cwd;
		sm.sessionId = params.sessionId;
		sm.cwd = params.cwd;
		sm.fileEntries = [header];
		sm.byId?.clear?.();
		sm.labelsById?.clear?.();
		sm.leafId = null;
		sm.flushed = false;
		return;
	}
	if (params.hadSessionFile && header) {
		header.id = params.sessionId;
		header.cwd = params.cwd;
		sm.sessionId = params.sessionId;
		sm.cwd = params.cwd;
		await writeJsonlLines(params.sessionFile, sm.fileEntries.map(serializeJsonlLine), { mode: 384 });
		sm.flushed = true;
	}
}`,
		`async function persistSessionManagerEntriesForRun(sessionFile, entries) {
	if (transcriptPathUsesSqlite(sessionFile)) {
		replaceSessionTranscriptEntriesSqlite({
			transcriptPath: sessionFile,
			entries
		});
		return;
	}
	await writeJsonlLines(sessionFile, entries.map(serializeJsonlLine), { mode: 384 });
}
async function prepareSessionManagerForRun(params) {
	const sm = params.sessionManager;
	const header = sm.fileEntries.find((e) => e.type === "session");
	const hasAssistant = sm.fileEntries.some((e) => e.type === "message" && e.message?.role === "assistant");
	if (!params.hadSessionFile && header) {
		header.id = params.sessionId;
		header.cwd = params.cwd;
		sm.sessionId = params.sessionId;
		sm.cwd = params.cwd;
		return;
	}
	if (params.hadSessionFile && header && !hasAssistant) {
		if (sm.wasRecoveredFromCorruptHeader?.()) {
			header.id = params.sessionId;
			header.cwd = params.cwd;
			sm.sessionId = params.sessionId;
			sm.cwd = params.cwd;
			await persistSessionManagerEntriesForRun(params.sessionFile, sm.fileEntries);
			sm.flushed = true;
			return;
		}
		await assertExistingHeaderIsReadable(params.sessionFile);
		header.id = params.sessionId;
		header.cwd = params.cwd;
		sm.sessionId = params.sessionId;
		sm.cwd = params.cwd;
		sm.fileEntries = [header];
		sm.byId?.clear?.();
		sm.labelsById?.clear?.();
		sm.leafId = null;
		sm.flushed = false;
		if (transcriptPathUsesSqlite(params.sessionFile)) replaceSessionTranscriptEntriesSqlite({
			transcriptPath: params.sessionFile,
			entries: [header]
		});
		else await fs$1.writeFile(params.sessionFile, "", "utf-8");
		return;
	}
	if (params.hadSessionFile && header) {
		header.id = params.sessionId;
		header.cwd = params.cwd;
		sm.sessionId = params.sessionId;
		sm.cwd = params.cwd;
		await persistSessionManagerEntriesForRun(params.sessionFile, sm.fileEntries);
		sm.flushed = true;
	}
}`,
		"prepareSessionManagerForRun",
	);

	src = replaceOnce(
		src,
		`			const hadSessionFile = await fs$1.stat(params.sessionFile).then(() => true).catch(() => false);`,
		`			const hadSessionFile = sessionTranscriptExists(params.sessionFile) || await fs$1.stat(params.sessionFile).then(() => true).catch(() => false);`,
		"hadSessionFile",
	);

	writeIfChanged(filePath, src);
}

function patchChat() {
	const filePath = findDist("chat-", {
		segments: 2,
		contentIncludes: "function ensureTranscriptFile(params)",
	});
	let src = mustRead(filePath);
	if (src.includes(`${MARKER}_CHAT`)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — chat already patched`);
		return;
	}

	src = replaceOnce(
		src,
		`import { o as resolveMirroredTranscriptText, s as appendSessionTranscriptMessage } from "./transcript-DJ0xrK51.js";
import { t as emitSessionTranscriptUpdate } from "./transcript-events-_AiEotlV.js";
import "./transcript-jsonl-B-FDKU0h.js";`,
		`import { o as resolveMirroredTranscriptText, s as appendSessionTranscriptMessage } from "./transcript-DJ0xrK51.js";
import { t as emitSessionTranscriptUpdate } from "./transcript-events-_AiEotlV.js";
import "./transcript-jsonl-B-FDKU0h.js";
import { c as ensureSessionTranscriptHeaderSqlite, e as sessionTranscriptExists, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";
/* ${MARKER}_CHAT */`,
		"chat import",
	);

	src = replaceOnce(
		src,
		`function ensureTranscriptFile(params) {
	if (fs.existsSync(params.transcriptPath)) return { ok: true };
	try {
		fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
		const header = {
			type: "session",
			version: 3,
			id: params.sessionId,
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			cwd: process.cwd()
		};
		fs.writeFileSync(params.transcriptPath, \`\${JSON.stringify(header)}\\n\`, {
			encoding: "utf-8",
			mode: 384
		});
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}`,
		`function ensureTranscriptFile(params) {
	if (sessionTranscriptExists(params.transcriptPath)) return { ok: true };
	try {
		const header = {
			type: "session",
			version: 3,
			id: params.sessionId,
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			cwd: process.cwd()
		};
		if (transcriptPathUsesSqlite(params.transcriptPath)) {
			ensureSessionTranscriptHeaderSqlite({
				transcriptPath: params.transcriptPath,
				sessionId: params.sessionId,
				header
			});
			return { ok: true };
		}
		fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
		fs.writeFileSync(params.transcriptPath, \`\${JSON.stringify(header)}\\n\`, {
			encoding: "utf-8",
			mode: 384
		});
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}`,
		"ensureTranscriptFile",
	);

	src = replaceOnce(
		src,
		`	if (!fs.existsSync(transcriptPath)) {
		if (!params.createIfMissing) return {
			ok: false,
			error: "transcript file not found"
		};`,
		`	if (!sessionTranscriptExists(transcriptPath)) {
		if (!params.createIfMissing) return {
			ok: false,
			error: "transcript file not found"
		};`,
		"appendAssistant exists",
	);

	writeIfChanged(filePath, src);
}

function patchCompaction() {
	const filePath = findDist("compaction-successor-transcript-", {
		contentIncludes: "async function repairSessionFileIfNeeded",
	});
	let src = mustRead(filePath);
	if (src.includes(`${MARKER}_COMPACTION`)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — compaction already patched`);
		return;
	}

	src = replaceOnce(
		src,
		`import { f as redactTranscriptMessage } from "./transcript-DJ0xrK51.js";
import { t as emitSessionTranscriptUpdate } from "./transcript-events-_AiEotlV.js";
import "./transcript-jsonl-B-FDKU0h.js";`,
		`import { f as redactTranscriptMessage } from "./transcript-DJ0xrK51.js";
import { t as emitSessionTranscriptUpdate } from "./transcript-events-_AiEotlV.js";
import "./transcript-jsonl-B-FDKU0h.js";
import { e as sessionTranscriptExists, i as readTranscriptFileStateSqlite, l as sessionTranscriptHasEntries, p as replaceSessionTranscriptEntriesSqlite, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";
/* ${MARKER}_COMPACTION */`,
		"compaction import",
	);

	src = replaceOnce(
		src,
		`async function repairSessionFileIfNeeded(params) {
	const sessionFile = params.sessionFile.trim();
	if (!sessionFile) return {
		repaired: false,
		droppedLines: 0,
		reason: "missing session file"
	};
	let content;
	try {
		content = await fs$1.readFile(sessionFile, "utf-8");
	} catch (err) {
		if (err?.code === "ENOENT") return {
			repaired: false,
			droppedLines: 0,
			reason: "missing session file"
		};
		const reason = \`failed to read session file: \${err instanceof Error ? err.message : "unknown error"}\`;
		params.warn?.(\`session file repair skipped: \${reason} (\${path.basename(sessionFile)})\`);
		return {
			repaired: false,
			droppedLines: 0,
			reason
		};
	}
	const lines = content.split(/\\r?\\n/);
	const entries = [];
	let droppedLines = 0;
	let rewrittenAssistantMessages = 0;
	let droppedBlankUserMessages = 0;
	let rewrittenUserMessages = 0;
	let insertedToolResults;
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);
			if (isStructurallyInvalidMessageEntry(entry)) {
				droppedLines += 1;
				continue;
			}
			if (isAssistantEntryWithEmptyContent(entry)) {
				entries.push(rewriteAssistantEntryWithEmptyContent(entry));
				rewrittenAssistantMessages += 1;
				continue;
			}
			if (entry && typeof entry === "object" && entry.type === "message" && typeof entry.message === "object" && (entry.message?.role ?? void 0) === "user") {
				const repairedUser = repairUserEntryWithBlankTextContent(entry);
				if (repairedUser.kind === "drop") {
					droppedBlankUserMessages += 1;
					continue;
				}
				if (repairedUser.kind === "rewrite") {
					entries.push(repairedUser.entry);
					rewrittenUserMessages += 1;
					continue;
				}
			}
			entries.push(entry);
		} catch {
			droppedLines += 1;
		}
	}`,
		`async function repairSessionFileIfNeeded(params) {
	const sessionFile = params.sessionFile.trim();
	if (!sessionFile) return {
		repaired: false,
		droppedLines: 0,
		reason: "missing session file"
	};
	const useSqlite = transcriptPathUsesSqlite(sessionFile);
	let content = "";
	let sourceEntries = null;
	if (useSqlite) {
		if (!sessionTranscriptHasEntries(sessionFile)) return {
			repaired: false,
			droppedLines: 0,
			reason: "missing session file"
		};
		sourceEntries = readTranscriptFileStateSqlite({ sessionFile });
	} else try {
		content = await fs$1.readFile(sessionFile, "utf-8");
	} catch (err) {
		if (err?.code === "ENOENT") return {
			repaired: false,
			droppedLines: 0,
			reason: "missing session file"
		};
		const reason = \`failed to read session file: \${err instanceof Error ? err.message : "unknown error"}\`;
		params.warn?.(\`session file repair skipped: \${reason} (\${path.basename(sessionFile)})\`);
		return {
			repaired: false,
			droppedLines: 0,
			reason
		};
	}
	const lines = sourceEntries ? null : content.split(/\\r?\\n/);
	const entries = [];
	let droppedLines = 0;
	let rewrittenAssistantMessages = 0;
	let droppedBlankUserMessages = 0;
	let rewrittenUserMessages = 0;
	let insertedToolResults;
	const consumeEntry = (entry) => {
		if (isStructurallyInvalidMessageEntry(entry)) {
			droppedLines += 1;
			return;
		}
		if (isAssistantEntryWithEmptyContent(entry)) {
			entries.push(rewriteAssistantEntryWithEmptyContent(entry));
			rewrittenAssistantMessages += 1;
			return;
		}
		if (entry && typeof entry === "object" && entry.type === "message" && typeof entry.message === "object" && (entry.message?.role ?? void 0) === "user") {
			const repairedUser = repairUserEntryWithBlankTextContent(entry);
			if (repairedUser.kind === "drop") {
				droppedBlankUserMessages += 1;
				return;
			}
			if (repairedUser.kind === "rewrite") {
				entries.push(repairedUser.entry);
				rewrittenUserMessages += 1;
				return;
			}
		}
		entries.push(entry);
	};
	if (sourceEntries) {
		for (const entry of sourceEntries) consumeEntry(entry);
	} else for (const line of lines) {
		if (!line.trim()) continue;
		try {
			consumeEntry(JSON.parse(line));
		} catch {
			droppedLines += 1;
		}
	}`,
		"repair read",
	);

	src = replaceOnce(
		src,
		`	const cleaned = \`\${entries.map((entry) => JSON.stringify(entry)).join("\\n")}\\n\`;
	const backupPath = \`\${sessionFile}.bak-\${process.pid}-\${Date.now()}\`;
	let retainedBackupPath;
	try {
		const stat = await fs$1.stat(sessionFile).catch(() => null);
		await fs$1.writeFile(backupPath, content, "utf-8");
		if (stat) await fs$1.chmod(backupPath, stat.mode);
		await replaceFileAtomic({
			filePath: sessionFile,
			content: cleaned,
			preserveExistingMode: true,
			tempPrefix: \`\${path.basename(sessionFile)}.repair\`
		});
		await fs$1.unlink(backupPath).catch((cleanupErr) => {
			retainedBackupPath = backupPath;
			params.debug?.(\`session file repair backup cleanup failed: \${cleanupErr instanceof Error ? cleanupErr.message : "unknown error"} (\${path.basename(backupPath)})\`);
		});
	} catch (err) {`,
		`	const cleaned = \`\${entries.map((entry) => JSON.stringify(entry)).join("\\n")}\\n\`;
	const backupPath = \`\${sessionFile}.bak-\${process.pid}-\${Date.now()}\`;
	let retainedBackupPath;
	try {
		if (useSqlite) {
			replaceSessionTranscriptEntriesSqlite({
				transcriptPath: sessionFile,
				entries
			});
		} else {
			const stat = await fs$1.stat(sessionFile).catch(() => null);
			await fs$1.writeFile(backupPath, content, "utf-8");
			if (stat) await fs$1.chmod(backupPath, stat.mode);
			await replaceFileAtomic({
				filePath: sessionFile,
				content: cleaned,
				preserveExistingMode: true,
				tempPrefix: \`\${path.basename(sessionFile)}.repair\`
			});
			await fs$1.unlink(backupPath).catch((cleanupErr) => {
				retainedBackupPath = backupPath;
				params.debug?.(\`session file repair backup cleanup failed: \${cleanupErr instanceof Error ? cleanupErr.message : "unknown error"} (\${path.basename(backupPath)})\`);
			});
		}
	} catch (err) {`,
		"repair write",
	);

	src = replaceOnce(
		src,
		`		prewarmSessionFile: async (sessionFile) => {
			if (!isCacheEnabled(getTtlMs())) return;
			if (cache.get(sessionFile) === true) return;
			try {
				const handle = await fsModule.open(sessionFile, "r");
				try {
					const buffer = Buffer.alloc(4096);
					await handle.read(buffer, 0, buffer.length, 0);
				} finally {
					await handle.close();
				}
				cache.set(sessionFile, true);
			} catch {}
		},`,
		`		prewarmSessionFile: async (sessionFile) => {
			if (!isCacheEnabled(getTtlMs())) return;
			if (cache.get(sessionFile) === true) return;
			try {
				if (transcriptPathUsesSqlite(sessionFile)) {
					if (sessionTranscriptExists(sessionFile)) cache.set(sessionFile, true);
					return;
				}
				const handle = await fsModule.open(sessionFile, "r");
				try {
					const buffer = Buffer.alloc(4096);
					await handle.read(buffer, 0, buffer.length, 0);
				} finally {
					await handle.close();
				}
				cache.set(sessionFile, true);
			} catch {}
		},`,
		"prewarm",
	);

	writeIfChanged(filePath, src);
}

function patchRunAttempt() {
	const filePath = findDist("run-attempt-", { segments: 3 });
	let src = mustRead(filePath);
	if (src.includes(`${MARKER}_RUN_ATTEMPT`)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — run-attempt already patched`);
		return;
	}
	src = replaceOnce(
		src,
		`import { s as appendSessionTranscriptMessage } from "./transcript-DJ0xrK51.js";
import { t as emitSessionTranscriptUpdate } from "./transcript-events-_AiEotlV.js";`,
		`import { s as appendSessionTranscriptMessage } from "./transcript-DJ0xrK51.js";
import { t as emitSessionTranscriptUpdate } from "./transcript-events-_AiEotlV.js";
import { e as sessionTranscriptExists } from "./session-sqlite-store-OS1.js";
/* ${MARKER}_RUN_ATTEMPT */`,
		"run-attempt import",
	);
	src = replaceOnce(
		src,
		`	const hadSessionFile = await pathExists(activeSessionFile);`,
		`	const hadSessionFile = sessionTranscriptExists(activeSessionFile) || await pathExists(activeSessionFile);`,
		"run-attempt hadSessionFile",
	);
	writeIfChanged(filePath, src);
}

function patchRunSessionState() {
	const direct = path.join(distDir, "run-session-state-D-DIroy6.js");
	const filePath = fs.existsSync(direct)
		? direct
		: findDist("run-session-state-", {
			contentIncludes: "function cronTranscriptExists",
		});
	let src = mustRead(filePath);
	if (src.includes(`${MARKER}_RUN_SESSION_STATE`)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — run-session-state already patched`);
		return;
	}
	src = replaceOnce(
		src,
		`import fs from "node:fs";
//#region src/cron/isolated-agent/channel-output-policy.ts`,
		`import fs from "node:fs";
import { e as sessionTranscriptExists } from "./session-sqlite-store-OS1.js";
/* ${MARKER}_RUN_SESSION_STATE */
//#region src/cron/isolated-agent/channel-output-policy.ts`,
		"run-session-state import",
	);
	src = replaceOnce(
		src,
		`function cronTranscriptExists(entry) {
	const sessionFile = entry.sessionFile?.trim();
	return Boolean(sessionFile && fs.existsSync(sessionFile));
}`,
		`function cronTranscriptExists(entry) {
	const sessionFile = entry.sessionFile?.trim();
	return Boolean(sessionFile && (sessionTranscriptExists(sessionFile) || fs.existsSync(sessionFile)));
}`,
		"cronTranscriptExists",
	);
	writeIfChanged(filePath, src);
}

function patchSessions7() {
	const filePath = findDist("sessions-7_"); // sessions-7_zgwGXH.js
	let src = mustRead(filePath);
	if (src.includes(`${MARKER}_SESSIONS7`)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — sessions-7 already patched`);
		return;
	}
	src = replaceOnce(
		src,
		`import "./transcript-DJ0xrK51.js";
import fs from "node:fs";`,
		`import "./transcript-DJ0xrK51.js";
import { e as sessionTranscriptExists, i as readTranscriptFileStateSqlite, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";
/* ${MARKER}_SESSIONS7 */
import fs from "node:fs";`,
		"sessions-7 import",
	);
	src = replaceOnce(
		src,
		`function transcriptHasNoMessageRecords(transcriptPath) {
	let stat;
	try {
		stat = fs.statSync(transcriptPath);
	} catch {
		return false;
	}`,
		`function transcriptHasNoMessageRecords(transcriptPath) {
	if (transcriptPathUsesSqlite(transcriptPath)) {
		if (!sessionTranscriptExists(transcriptPath)) return false;
		const entries = readTranscriptFileStateSqlite({ sessionFile: transcriptPath });
		if (entries.length === 0) return true;
		const serialized = \`\${entries.map((entry) => JSON.stringify(entry)).join("\\n")}\\n\`;
		if (Buffer.byteLength(serialized, "utf8") > EMPTY_TRANSCRIPT_MAX_BYTES) return false;
		for (const entry of entries) if (isTranscriptMessageRecord(entry)) return false;
		return true;
	}
	let stat;
	try {
		stat = fs.statSync(transcriptPath);
	} catch {
		return false;
	}`,
		"transcriptHasNoMessageRecords",
	);
	src = replaceOnce(
		src,
		`		if (!transcriptPath || !fs.existsSync(transcriptPath) || transcriptHasNoMessageRecords(transcriptPath)) {`,
		`		if (!transcriptPath || !(sessionTranscriptExists(transcriptPath) || fs.existsSync(transcriptPath)) || transcriptHasNoMessageRecords(transcriptPath)) {`,
		"pruneMissing",
	);
	writeIfChanged(filePath, src);
}

function patchSessionsCVs() {
	const filePath = path.join(distDir, "sessions-CVsVn4wz.js");
	let src = mustRead(filePath);
	if (src.includes(`${MARKER}_SESSIONSCVS`)) {
		console.log(`[patch-openclaw-session-manager-sqlite] skip — sessions-CVs already patched`);
		return;
	}
	if (src.includes(`from "./session-sqlite-store-OS1.js"`)) {
		src = src.replace(
			/import \{([^}]+)\} from "\.\/session-sqlite-store-OS1\.js";/,
			(full, inner) => {
				let next = inner;
				if (!next.includes("sessionTranscriptExists")) next = ` e as sessionTranscriptExists,${next}`;
				if (!next.includes("ensureSessionTranscriptHeaderSqlite")) next = ` c as ensureSessionTranscriptHeaderSqlite,${next}`;
				if (!next.includes("transcriptPathUsesSqlite")) next = `${next} u as transcriptPathUsesSqlite,`;
				return `import {${next} } from "./session-sqlite-store-OS1.js";\n/* ${MARKER}_SESSIONSCVS */`;
			},
		);
	} else {
		src = replaceOnce(
			src,
			`import { a as resolveSessionTranscriptCandidates, t as archiveFileOnDisk } from "./session-transcript-files.fs-OVGfH0_W.js";`,
			`import { a as resolveSessionTranscriptCandidates, t as archiveFileOnDisk } from "./session-transcript-files.fs-OVGfH0_W.js";
import { c as ensureSessionTranscriptHeaderSqlite, e as sessionTranscriptExists, u as transcriptPathUsesSqlite } from "./session-sqlite-store-OS1.js";
/* ${MARKER}_SESSIONSCVS */`,
			"sessions-CVs import",
		);
	}
	if (src.includes("function ensureSessionTranscriptFile(params)") && !src.includes("ensureSessionTranscriptHeaderSqlite({")) {
		src = replaceOnce(
			src,
			`function ensureSessionTranscriptFile(params) {
	try {
		const transcriptPath = resolveSessionFilePath(params.sessionId, params.sessionFile ? { sessionFile: params.sessionFile } : void 0, resolveSessionFilePathOptions({
			storePath: params.storePath,
			agentId: params.agentId
		}));
		if (!fs.existsSync(transcriptPath)) {
			fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
			const header = {
				type: "session",
				version: 3,
				id: params.sessionId,
				timestamp: (/* @__PURE__ */ new Date()).toISOString(),
				cwd: process.cwd()
			};
			fs.writeFileSync(transcriptPath, \`\${JSON.stringify(header)}\\n\`, {
				encoding: "utf-8",
				mode: 384
			});
		}
		return {
			ok: true,
			transcriptPath
		};
	} catch (err) {
		return {
			ok: false,
			error: formatErrorMessage(err)
		};
	}
}`,
			`function ensureSessionTranscriptFile(params) {
	try {
		const transcriptPath = resolveSessionFilePath(params.sessionId, params.sessionFile ? { sessionFile: params.sessionFile } : void 0, resolveSessionFilePathOptions({
			storePath: params.storePath,
			agentId: params.agentId
		}));
		const header = {
			type: "session",
			version: 3,
			id: params.sessionId,
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			cwd: process.cwd()
		};
		if (transcriptPathUsesSqlite(transcriptPath)) {
			ensureSessionTranscriptHeaderSqlite({
				transcriptPath,
				sessionId: params.sessionId,
				header
			});
		} else if (!fs.existsSync(transcriptPath)) {
			fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
			fs.writeFileSync(transcriptPath, \`\${JSON.stringify(header)}\\n\`, {
				encoding: "utf-8",
				mode: 384
			});
		}
		return {
			ok: true,
			transcriptPath
		};
	} catch (err) {
		return {
			ok: false,
			error: formatErrorMessage(err)
		};
	}
}`,
			"ensureSessionTranscriptFile",
		);
	}
	src = replaceOnce(
		src,
		`.find((candidate) => fs.existsSync(candidate));`,
		`.find((candidate) => sessionTranscriptExists(candidate) || fs.existsSync(candidate));`,
		"sessions-CVs find",
	);
	writeIfChanged(filePath, src);
}

function main() {
	if (!fs.existsSync(distDir)) throw new Error(`openclaw dist missing: ${distDir}`);
	patchSqliteStore();
	patchSessionManager();
	patchSelection();
	patchChat();
	patchCompaction();
	patchRunAttempt();
	patchRunSessionState();
	patchSessions7();
	patchSessionsCVs();
	console.log(`[patch-openclaw-session-manager-sqlite] done — ${openclawRoot}`);
}

main();
