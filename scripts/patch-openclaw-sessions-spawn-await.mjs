/**
 * Apply Open Studio parallel-barrier subagent orchestration onto an openclaw
 * tools bundle. Prefer shipping this via pnpm:
 *   patches/openclaw@2026.6.1.patch  (pnpm-workspace.yaml patchedDependencies)
 *
 * This script is NOT in postinstall. Use it only when regenerating the patch:
 *   pnpm patch openclaw@2026.6.1
 *   OPENCLAW_PATCH_ROOT=.../node_modules/.pnpm_patches/openclaw@2026.6.1 node scripts/patch-openclaw-sessions-spawn-await.mjs
 *   pnpm patch-commit ".../node_modules/.pnpm_patches/openclaw@2026.6.1"
 *
 * Also used by scripts/apply-openclaw-bundle-patches.mjs for packaged bundles.
 *
 * When OPEN_STUDIO_SUBAGENT_AWAIT=1:
 *   sessions_spawn({ task }) blocks until that child finishes (default)
 *   sessions_spawn({ tasks: [...] }) starts all in parallel and blocks until ALL finish
 *   awaitResult:false + sessions_yield remains available for detach/barrier mode
 *
 * Prefer regenerating via scripts/_tmp-hard-block-spawn.mjs against a pnpm patch
 * workspace when changing hard-barrier behavior, then pnpm patch-commit.
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
const toolsBundle =
  fs.existsSync(distDir) &&
  fs.readdirSync(distDir).find((name) => name.startsWith("openclaw-tools-") && name.endsWith(".js"));
const target = toolsBundle
  ? path.join(distDir, toolsBundle)
  : path.join(openclawRoot, "dist", "openclaw-tools-ChLzmhJi.js");

const MARKER = "OPEN_STUDIO_SESSIONS_SPAWN_AWAIT";
const MARKER_V2 = "OPEN_STUDIO_SESSIONS_SPAWN_PARALLEL_BARRIER";

const HELPER_FN = `
function isOpenStudioSubagentMode() {
	/* ${MARKER} */
	/* ${MARKER_V2} */
	const env = String(process.env.OPEN_STUDIO_SUBAGENT_AWAIT || "").trim().toLowerCase();
	return env === "1" || env === "true" || env === "on";
}
/** @deprecated use isOpenStudioSubagentMode / shouldAwaitOpenStudioSpawnResult */
function isOpenStudioSubagentAwaitEnabled(params) {
	/* ${MARKER} */
	return shouldAwaitOpenStudioSpawnResult(params);
}
function shouldAwaitOpenStudioSpawnResult(params) {
	/* ${MARKER} */
	if (!isOpenStudioSubagentMode()) return false;
	// Explicit false = fire-and-forget (then must sessions_yield).
	// Default true = block this spawn until its child finishes.
	if (params && params.awaitResult === false) return false;
	return true;
}
function resolveOpenStudioSpawnAwaitTimeoutSeconds(params) {
	const raw = params && typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds) ? params.timeoutSeconds : void 0;
	if (raw === void 0) return 600;
	return Math.max(0, Math.floor(raw));
}
function resolveOpenStudioPendingSpawnKey(opts) {
	const key = opts?.agentSessionKey || opts?.sessionId || opts?.completionOwnerKey || "default";
	return String(key);
}
const __openStudioPendingSpawnsBySession = globalThis.__openStudioPendingSpawnsBySession || new Map();
globalThis.__openStudioPendingSpawnsBySession = __openStudioPendingSpawnsBySession;
function trackOpenStudioPendingSpawn(opts, spawnResult, params) {
	if (!isOpenStudioSubagentMode()) return;
	if (shouldAwaitOpenStudioSpawnResult(params)) return;
	if (!spawnResult || typeof spawnResult !== "object") return;
	if (spawnResult.status !== "accepted") return;
	const runId = typeof spawnResult.runId === "string" ? spawnResult.runId.trim() : "";
	const childSessionKey = typeof spawnResult.childSessionKey === "string" ? spawnResult.childSessionKey.trim() : "";
	if (!runId || !childSessionKey) return;
	const key = resolveOpenStudioPendingSpawnKey(opts);
	const list = __openStudioPendingSpawnsBySession.get(key) || [];
	const task = typeof params?.task === "string" ? params.task.trim() : "";
	const label = typeof params?.label === "string" && params.label.trim() ? params.label.trim() : typeof params?.taskName === "string" && params.taskName.trim() ? params.taskName.trim() : task ? task.slice(0, 80) : "Subagent";
	list.push({
		runId,
		childSessionKey,
		label,
		task
	});
	__openStudioPendingSpawnsBySession.set(key, list);
}
async function openStudioWaitOneSpawn(spawnResult, params) {
	const runId = typeof spawnResult.runId === "string" ? spawnResult.runId.trim() : "";
	const childSessionKey = typeof spawnResult.childSessionKey === "string" ? spawnResult.childSessionKey.trim() : "";
	const timeoutSeconds = resolveOpenStudioSpawnAwaitTimeoutSeconds(params);
	if (timeoutSeconds === 0) return {
		...spawnResult,
		status: "accepted",
		runId,
		childSessionKey
	};
	const timeoutMs = finiteSecondsToTimerSafeMilliseconds(timeoutSeconds, { floorSeconds: true }) ?? timeoutSeconds * 1e3;
	const wait = await waitForAgentRunAndReadUpdatedAssistantReply({
		runId,
		sessionKey: childSessionKey,
		timeoutMs: timeoutMs || 6e5,
		limit: 50
	});
	if (wait.status === "timeout") return {
		...spawnResult,
		status: "timeout",
		error: wait.error || "subagent wait timed out",
		runId,
		childSessionKey
	};
	if (wait.status === "error" || wait.status === "pending") return {
		...spawnResult,
		status: wait.status === "pending" ? "timeout" : "error",
		error: wait.error || (wait.status === "pending" ? "subagent still pending" : "subagent wait failed"),
		runId,
		childSessionKey
	};
	return {
		...spawnResult,
		status: "completed",
		runId,
		childSessionKey,
		result: typeof wait.replyText === "string" ? wait.replyText : ""
	};
}
async function openStudioAwaitSpawnResult(spawnResult, params, opts) {
	/* ${MARKER} */
	if (!isOpenStudioSubagentMode()) return spawnResult;
	if (!spawnResult || typeof spawnResult !== "object") return spawnResult;
	if (spawnResult.status !== "accepted") return spawnResult;
	const runId = typeof spawnResult.runId === "string" ? spawnResult.runId.trim() : "";
	const childSessionKey = typeof spawnResult.childSessionKey === "string" ? spawnResult.childSessionKey.trim() : "";
	if (!runId || !childSessionKey) return spawnResult;
	if (!shouldAwaitOpenStudioSpawnResult(params)) {
		trackOpenStudioPendingSpawn(opts, spawnResult, params);
		const key = resolveOpenStudioPendingSpawnKey(opts);
		const pending = __openStudioPendingSpawnsBySession.get(key) || [];
		return {
			...spawnResult,
			pendingCount: pending.length,
			nextRequiredTool: "sessions_yield",
			instruction: "Child started and is working in the background. After you finish all parallel sessions_spawn calls, your NEXT tool MUST be sessions_yield (it blocks until EVERY pending child finishes and returns results[]). Do not call exec/read/other tools and do not poll with text."
		};
	}
	return openStudioWaitOneSpawn(spawnResult, params);
}
async function openStudioAwaitAllPendingSpawns(opts, params) {
	/* ${MARKER} */
	const key = resolveOpenStudioPendingSpawnKey(opts);
	const pending = __openStudioPendingSpawnsBySession.get(key) || [];
	__openStudioPendingSpawnsBySession.set(key, []);
	const message = typeof params?.message === "string" && params.message.trim() ? params.message.trim() : "Waiting for subagent results";
	if (!pending.length) return {
		status: "completed",
		message,
		results: []
	};
	const results = await Promise.all(pending.map(async (item) => {
		const waited = await openStudioWaitOneSpawn({
			status: "accepted",
			runId: item.runId,
			childSessionKey: item.childSessionKey
		}, params);
		return {
			runId: item.runId,
			childSessionKey: item.childSessionKey,
			label: item.label,
			task: item.task,
			status: waited.status,
			result: typeof waited.result === "string" ? waited.result : "",
			error: typeof waited.error === "string" ? waited.error : void 0
		};
	}));
	const failed = results.filter((row) => row.status !== "completed");
	return {
		status: failed.length ? "error" : "completed",
		message,
		results,
		error: failed.length ? (String(failed.length) + " of " + String(results.length) + " subagent(s) failed or timed out") : void 0
	};
}
`;

const FN_NEEDLE = `function createSessionsSpawnTool(opts) {`;

const SCHEMA_NEEDLE = `\t\tattachAs: Type.Optional(Type.Object({ mountPath: Type.Optional(Type.String()) })),
		...params.acpAvailable ? {`;

const SCHEMA_REPLACEMENT = `\t\tattachAs: Type.Optional(Type.Object({ mountPath: Type.Optional(Type.String()) })),
		awaitResult: Type.Optional(Type.Boolean({ description: "Open Studio: wait for THIS subagent before returning (default false). Prefer false + sessions_yield to run multiple subagents in parallel." })),
		timeoutSeconds: Type.Optional(Type.Integer({
			minimum: 0,
			description: "Open Studio: max seconds to wait (per child for awaitResult/yield; default 600). 0 = do not wait."
		})),
		...params.acpAvailable ? {`;

const TIMEOUT_CHECK_NEEDLE = `\t\t\tconst unsupportedTimeoutParam = UNSUPPORTED_SESSIONS_SPAWN_TIMEOUT_PARAM_KEYS.find((key) => resolveSnakeCaseParamKey(params, key));
			if (unsupportedTimeoutParam) throw new ToolInputError(\`sessions_spawn does not support per-call "\${resolveSnakeCaseParamKey(params, unsupportedTimeoutParam) ?? unsupportedTimeoutParam}". Configure agents.defaults.subagents.runTimeoutSeconds instead.\`);`;

const TIMEOUT_CHECK_REPLACEMENT = `\t\t\tconst studioMode = isOpenStudioSubagentMode();
			const studioAwait = shouldAwaitOpenStudioSpawnResult(params);
			const unsupportedTimeoutParam = studioMode ? void 0 : UNSUPPORTED_SESSIONS_SPAWN_TIMEOUT_PARAM_KEYS.find((key) => resolveSnakeCaseParamKey(params, key));
			if (unsupportedTimeoutParam) throw new ToolInputError(\`sessions_spawn does not support per-call "\${resolveSnakeCaseParamKey(params, unsupportedTimeoutParam) ?? unsupportedTimeoutParam}". Configure agents.defaults.subagents.runTimeoutSeconds instead.\`);`;

const EXPECTS_NEEDLE = `\t\t\tconst expectsCompletionMessage = params.expectsCompletionMessage !== false;
			const sandbox = params.sandbox === "require" ? "require" : "inherit";`;

const EXPECTS_REPLACEMENT = `\t\t\tconst expectsCompletionMessage = studioMode ? false : params.expectsCompletionMessage !== false;
			const sandbox = params.sandbox === "require" ? "require" : "inherit";`;

const ACP_RETURN_NEEDLE = `\t\t\t\treturn jsonResult(addRoleToFailureResult(result, requestedAgentId));
			}
			return jsonResult(addRoleToFailureResult(await spawnSubagentDirect({`;

const ACP_RETURN_REPLACEMENT = `\t\t\t\treturn jsonResult(addRoleToFailureResult(await openStudioAwaitSpawnResult(result, params, opts), requestedAgentId));
			}
			return jsonResult(addRoleToFailureResult(await openStudioAwaitSpawnResult(await spawnSubagentDirect({`;

const SPAWN_CLOSE_NEEDLE = `\t\t\t}), requestedAgentId));
		}
	};
}
//#endregion
//#region src/agents/tools/sessions-yield-tool.ts`;

const SPAWN_CLOSE_REPLACEMENT = `\t\t\t}), params, opts), requestedAgentId));
		}
	};
}
//#endregion
//#region src/agents/tools/sessions-yield-tool.ts`;

const YIELD_EXECUTE_NEEDLE = `\t\texecute: async (_toolCallId, args) => {
			const message = readStringParam(args, "message") || "Turn yielded.";
			if (!opts?.sessionId) return jsonResult({
				status: "error",
				error: "No session context"`;

const YIELD_EXECUTE_REPLACEMENT = `\t\texecute: async (_toolCallId, args) => {
			if (isOpenStudioSubagentMode()) return jsonResult(await openStudioAwaitAllPendingSpawns(opts, args));
			const message = readStringParam(args, "message") || "Turn yielded.";
			if (!opts?.sessionId) return jsonResult({
				status: "error",
				error: "No session context"`;

const DESC_NEEDLE = `\t\tdescription: describeSessionsSpawnTool({
			acpAvailable,
			threadAvailable
		}),`;

const DESC_REPLACEMENT = `\t\tdescription: isOpenStudioSubagentMode() ? "Spawn a subagent that starts working immediately (parallel-safe; does not block by default). For multiple children: call sessions_spawn for each, then you MUST call sessions_yield next — yield blocks the parent until ALL finish. Do not poll or take over their work. Set awaitResult:true only to block on a single child." : describeSessionsSpawnTool({
			acpAvailable,
			threadAvailable
		}),`;

const YIELD_DESC_NEEDLE = `\t\tdescription: "End current turn. Use after spawning subagents; results arrive as next message.",`;

const YIELD_DESC_REPLACEMENT = `\t\tdescription: isOpenStudioSubagentMode() ? "REQUIRED barrier after parallel sessions_spawn: blocks the parent until ALL pending subagents finish, then returns {status, results[]}. Call this immediately after your last sessions_spawn. Do not call other tools before this. Continue in the same turn after it returns." : "End current turn. Use after spawning subagents; results arrive as next message.",`;

/** Strings present in the previous (serial await) Studio patch — used to upgrade in place. */
const OLD_HELPER_START = `function isOpenStudioSubagentAwaitEnabled(params) {
	/* ${MARKER} */`;

const OLD_YIELD_DISABLED = `\t\texecute: async (_toolCallId, args) => {
			if (isOpenStudioSubagentAwaitEnabled(args)) return jsonResult({
				status: "error",
				error: "sessions_yield is disabled in Open Studio. Call sessions_spawn (it blocks until the subagent finishes) and continue in the same turn."
			});
			const message = readStringParam(args, "message") || "Turn yielded.";
			if (!opts?.sessionId) return jsonResult({
				status: "error",
				error: "No session context"`;

const OLD_SPAWN_DESC = `\t\tdescription: isOpenStudioSubagentAwaitEnabled() ? "Spawn a subagent and block until it finishes. Returns {status:\\"completed\\", result}. Do not call sessions_yield — keep working in the same turn after the tool returns." : describeSessionsSpawnTool({
			acpAvailable,
			threadAvailable
		}),`;

const OLD_TIMEOUT_STUDIO = `\t\t\tconst studioAwait = isOpenStudioSubagentAwaitEnabled(params);
			const unsupportedTimeoutParam = studioAwait ? void 0 : UNSUPPORTED_SESSIONS_SPAWN_TIMEOUT_PARAM_KEYS.find((key) => resolveSnakeCaseParamKey(params, key));
			if (unsupportedTimeoutParam) throw new ToolInputError(\`sessions_spawn does not support per-call "\${resolveSnakeCaseParamKey(params, unsupportedTimeoutParam) ?? unsupportedTimeoutParam}". Configure agents.defaults.subagents.runTimeoutSeconds instead.\`);`;

const OLD_EXPECTS = `\t\t\tconst expectsCompletionMessage = studioAwait ? false : params.expectsCompletionMessage !== false;
			const sandbox = params.sandbox === "require" ? "require" : "inherit";`;

const OLD_ACP_RETURN = `\t\t\t\treturn jsonResult(addRoleToFailureResult(await openStudioAwaitSpawnResult(result, params), requestedAgentId));
			}
			return jsonResult(addRoleToFailureResult(await openStudioAwaitSpawnResult(await spawnSubagentDirect({`;

const OLD_SPAWN_CLOSE = `\t\t\t}), params), requestedAgentId));
		}
	};
}
//#endregion
//#region src/agents/tools/sessions-yield-tool.ts`;

function replaceOldHelperBlock(src) {
  const start = src.indexOf(OLD_HELPER_START);
  if (start < 0) return null;
  const fnNeedleAt = src.indexOf(FN_NEEDLE, start);
  if (fnNeedleAt < 0) return null;
  return src.slice(0, start) + HELPER_FN.trimStart() + src.slice(fnNeedleAt);
}

function applyFresh(src) {
  const required = [
    FN_NEEDLE,
    SCHEMA_NEEDLE,
    TIMEOUT_CHECK_NEEDLE,
    EXPECTS_NEEDLE,
    ACP_RETURN_NEEDLE,
    SPAWN_CLOSE_NEEDLE,
    YIELD_EXECUTE_NEEDLE,
    DESC_NEEDLE,
    YIELD_DESC_NEEDLE,
  ];
  for (const needle of required) {
    if (!src.includes(needle)) {
      console.warn(
        "[patch-openclaw-sessions-spawn-await] skip — upstream openclaw-tools bundle changed; missing needle:",
        needle.slice(0, 80).replace(/\s+/g, " "),
      );
      process.exitCode = 1;
      return null;
    }
  }
  let next = src.replace(FN_NEEDLE, `${HELPER_FN}\n${FN_NEEDLE}`);
  next = next.replace(SCHEMA_NEEDLE, SCHEMA_REPLACEMENT);
  next = next.replace(TIMEOUT_CHECK_NEEDLE, TIMEOUT_CHECK_REPLACEMENT);
  next = next.replace(EXPECTS_NEEDLE, EXPECTS_REPLACEMENT);
  next = next.replace(DESC_NEEDLE, DESC_REPLACEMENT);
  next = next.replace(ACP_RETURN_NEEDLE, ACP_RETURN_REPLACEMENT);
  next = next.replace(SPAWN_CLOSE_NEEDLE, SPAWN_CLOSE_REPLACEMENT);
  next = next.replace(YIELD_EXECUTE_NEEDLE, YIELD_EXECUTE_REPLACEMENT);
  next = next.replace(YIELD_DESC_NEEDLE, YIELD_DESC_REPLACEMENT);
  return next;
}

const OLD_SCHEMA_FIELDS = `awaitResult: Type.Optional(Type.Boolean({ description: "Open Studio: wait for the subagent to finish before returning (default true when OPEN_STUDIO_SUBAGENT_AWAIT=1)." })),
		timeoutSeconds: Type.Optional(Type.Integer({
			minimum: 0,
			description: "Open Studio: max seconds to wait for the subagent (default 600). 0 = fire-and-forget (accepted)."
		})),`;

const NEW_SCHEMA_FIELDS = `awaitResult: Type.Optional(Type.Boolean({ description: "Open Studio: wait for THIS subagent before returning (default false). Prefer false + sessions_yield to run multiple subagents in parallel." })),
		timeoutSeconds: Type.Optional(Type.Integer({
			minimum: 0,
			description: "Open Studio: max seconds to wait (per child for awaitResult/yield; default 600). 0 = do not wait."
		})),`;

function upgradeExisting(src) {
  if (src.includes(MARKER_V2)) {
    console.log("[patch-openclaw-sessions-spawn-await] already at parallel-barrier");
    return src;
  }
  let next = replaceOldHelperBlock(src);
  if (!next) {
    console.warn("[patch-openclaw-sessions-spawn-await] upgrade failed — helper block not found");
    process.exitCode = 1;
    return null;
  }
  const swaps = [
    [OLD_SCHEMA_FIELDS, NEW_SCHEMA_FIELDS],
    [OLD_TIMEOUT_STUDIO, TIMEOUT_CHECK_REPLACEMENT],
    [OLD_EXPECTS, EXPECTS_REPLACEMENT],
    [OLD_SPAWN_DESC, DESC_REPLACEMENT],
    [OLD_ACP_RETURN, ACP_RETURN_REPLACEMENT],
    [OLD_SPAWN_CLOSE, SPAWN_CLOSE_REPLACEMENT],
    [OLD_YIELD_DISABLED, YIELD_EXECUTE_REPLACEMENT],
    [YIELD_DESC_NEEDLE, YIELD_DESC_REPLACEMENT],
  ];

  for (const [from, to] of swaps) {
    if (!next.includes(from)) {
      if (from === YIELD_DESC_NEEDLE && next.includes(YIELD_DESC_REPLACEMENT)) continue;
      console.warn(
        "[patch-openclaw-sessions-spawn-await] upgrade missing fragment:",
        from.slice(0, 70).replace(/\s+/g, " "),
      );
      process.exitCode = 1;
      return null;
    }
    next = next.replace(from, to);
  }
  if (!next.includes(MARKER_V2)) {
    console.warn("[patch-openclaw-sessions-spawn-await] upgrade did not install v2 marker");
    process.exitCode = 1;
    return null;
  }
  return next;
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sessions-spawn-await] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  let next;
  if (src.includes(MARKER)) {
    next = upgradeExisting(src);
  } else {
    next = applyFresh(src);
  }
  if (!next || next === src) {
    if (next === src && src.includes(MARKER_V2)) return;
    return;
  }
  fs.writeFileSync(target, next, "utf8");
  console.log("[patch-openclaw-sessions-spawn-await] applied (parallel barrier) →", path.relative(root, target));
}

main();
