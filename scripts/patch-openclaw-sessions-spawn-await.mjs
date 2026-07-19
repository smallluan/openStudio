/**
 * Open Studio: make sessions_spawn a mid-turn blocking tool when
 * OPEN_STUDIO_SUBAGENT_AWAIT=1 (set by the gateway supervisor).
 *
 * Flow: spawn → waitForAgentRunAndReadUpdatedAssistantReply → return completed + result.
 * Also disables sessions_yield in Studio so the model cannot end the turn early.
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

const HELPER_FN = `
function isOpenStudioSubagentAwaitEnabled(params) {
	/* ${MARKER} */
	if (params && params.awaitResult === false) return false;
	if (params && params.awaitResult === true) return true;
	const env = String(process.env.OPEN_STUDIO_SUBAGENT_AWAIT || "").trim().toLowerCase();
	return env === "1" || env === "true" || env === "on";
}
function resolveOpenStudioSpawnAwaitTimeoutSeconds(params) {
	const raw = params && typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds) ? params.timeoutSeconds : void 0;
	if (raw === void 0) return 600;
	return Math.max(0, Math.floor(raw));
}
async function openStudioAwaitSpawnResult(spawnResult, params) {
	/* ${MARKER} */
	if (!isOpenStudioSubagentAwaitEnabled(params)) return spawnResult;
	if (!spawnResult || typeof spawnResult !== "object") return spawnResult;
	if (spawnResult.status !== "accepted") return spawnResult;
	const runId = typeof spawnResult.runId === "string" ? spawnResult.runId.trim() : "";
	const childSessionKey = typeof spawnResult.childSessionKey === "string" ? spawnResult.childSessionKey.trim() : "";
	if (!runId || !childSessionKey) return spawnResult;
	const timeoutSeconds = resolveOpenStudioSpawnAwaitTimeoutSeconds(params);
	if (timeoutSeconds === 0) return spawnResult;
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
`;

const FN_NEEDLE = `function createSessionsSpawnTool(opts) {`;

const SCHEMA_NEEDLE = `\t\tattachAs: Type.Optional(Type.Object({ mountPath: Type.Optional(Type.String()) })),
		...params.acpAvailable ? {`;

const SCHEMA_REPLACEMENT = `\t\tattachAs: Type.Optional(Type.Object({ mountPath: Type.Optional(Type.String()) })),
		awaitResult: Type.Optional(Type.Boolean({ description: "Open Studio: wait for the subagent to finish before returning (default true when OPEN_STUDIO_SUBAGENT_AWAIT=1)." })),
		timeoutSeconds: Type.Optional(Type.Integer({
			minimum: 0,
			description: "Open Studio: max seconds to wait for the subagent (default 600). 0 = fire-and-forget (accepted)."
		})),
		...params.acpAvailable ? {`;

const TIMEOUT_CHECK_NEEDLE = `\t\t\tconst unsupportedTimeoutParam = UNSUPPORTED_SESSIONS_SPAWN_TIMEOUT_PARAM_KEYS.find((key) => resolveSnakeCaseParamKey(params, key));
			if (unsupportedTimeoutParam) throw new ToolInputError(\`sessions_spawn does not support per-call "\${resolveSnakeCaseParamKey(params, unsupportedTimeoutParam) ?? unsupportedTimeoutParam}". Configure agents.defaults.subagents.runTimeoutSeconds instead.\`);`;

const TIMEOUT_CHECK_REPLACEMENT = `\t\t\tconst studioAwait = isOpenStudioSubagentAwaitEnabled(params);
			const unsupportedTimeoutParam = studioAwait ? void 0 : UNSUPPORTED_SESSIONS_SPAWN_TIMEOUT_PARAM_KEYS.find((key) => resolveSnakeCaseParamKey(params, key));
			if (unsupportedTimeoutParam) throw new ToolInputError(\`sessions_spawn does not support per-call "\${resolveSnakeCaseParamKey(params, unsupportedTimeoutParam) ?? unsupportedTimeoutParam}". Configure agents.defaults.subagents.runTimeoutSeconds instead.\`);`;

const EXPECTS_NEEDLE = `\t\t\tconst expectsCompletionMessage = params.expectsCompletionMessage !== false;
			const sandbox = params.sandbox === "require" ? "require" : "inherit";`;

const EXPECTS_REPLACEMENT = `\t\t\tconst expectsCompletionMessage = studioAwait ? false : params.expectsCompletionMessage !== false;
			const sandbox = params.sandbox === "require" ? "require" : "inherit";`;

const ACP_RETURN_NEEDLE = `\t\t\t\treturn jsonResult(addRoleToFailureResult(result, requestedAgentId));
			}
			return jsonResult(addRoleToFailureResult(await spawnSubagentDirect({`;

const ACP_RETURN_REPLACEMENT = `\t\t\t\treturn jsonResult(addRoleToFailureResult(await openStudioAwaitSpawnResult(result, params), requestedAgentId));
			}
			return jsonResult(addRoleToFailureResult(await openStudioAwaitSpawnResult(await spawnSubagentDirect({`;

const SPAWN_CLOSE_NEEDLE = `\t\t\t}), requestedAgentId));
		}
	};
}
//#endregion
//#region src/agents/tools/sessions-yield-tool.ts`;

const SPAWN_CLOSE_REPLACEMENT = `\t\t\t}), params), requestedAgentId));
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
			if (isOpenStudioSubagentAwaitEnabled(args)) return jsonResult({
				status: "error",
				error: "sessions_yield is disabled in Open Studio. Call sessions_spawn (it blocks until the subagent finishes) and continue in the same turn."
			});
			const message = readStringParam(args, "message") || "Turn yielded.";
			if (!opts?.sessionId) return jsonResult({
				status: "error",
				error: "No session context"`;

const DESC_NEEDLE = `\t\tdescription: describeSessionsSpawnTool({
			acpAvailable,
			threadAvailable
		}),`;

const DESC_REPLACEMENT = `\t\tdescription: isOpenStudioSubagentAwaitEnabled() ? "Spawn a subagent and block until it finishes. Returns {status:\\"completed\\", result}. Do not call sessions_yield — keep working in the same turn after the tool returns." : describeSessionsSpawnTool({
			acpAvailable,
			threadAvailable
		}),`;

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sessions-spawn-await] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER)) {
    console.log("[patch-openclaw-sessions-spawn-await] already applied");
    return;
  }
  const required = [
    FN_NEEDLE,
    SCHEMA_NEEDLE,
    TIMEOUT_CHECK_NEEDLE,
    EXPECTS_NEEDLE,
    ACP_RETURN_NEEDLE,
    SPAWN_CLOSE_NEEDLE,
    YIELD_EXECUTE_NEEDLE,
    DESC_NEEDLE,
  ];
  for (const needle of required) {
    if (!src.includes(needle)) {
      console.warn(
        "[patch-openclaw-sessions-spawn-await] skip — upstream openclaw-tools bundle changed; missing needle:",
        needle.slice(0, 80).replace(/\s+/g, " "),
      );
      process.exitCode = 1;
      return;
    }
  }
  src = src.replace(FN_NEEDLE, `${HELPER_FN}\n${FN_NEEDLE}`);
  src = src.replace(SCHEMA_NEEDLE, SCHEMA_REPLACEMENT);
  src = src.replace(TIMEOUT_CHECK_NEEDLE, TIMEOUT_CHECK_REPLACEMENT);
  src = src.replace(EXPECTS_NEEDLE, EXPECTS_REPLACEMENT);
  src = src.replace(DESC_NEEDLE, DESC_REPLACEMENT);
  src = src.replace(ACP_RETURN_NEEDLE, ACP_RETURN_REPLACEMENT);
  src = src.replace(SPAWN_CLOSE_NEEDLE, SPAWN_CLOSE_REPLACEMENT);
  src = src.replace(YIELD_EXECUTE_NEEDLE, YIELD_EXECUTE_REPLACEMENT);
  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sessions-spawn-await] applied →", path.relative(root, target));
}

main();
