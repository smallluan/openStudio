/**
 * Inject native `browser_debug` + `browser_screenshot` tools into OpenClaw createOpenClawTools.
 * Runs after patch-openclaw-sidebar-action.mjs (shares the same HTTP bridge base URL).
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

const MARKER = "OPEN_STUDIO_BROWSER_PREVIEW_TOOLS";

const TOOL_FN = `
function createBrowserDebugTool() {
	/* ${MARKER} */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	return {
		label: "Browser Debug",
		name: "browser_debug",
		displaySummary: "Preview console/network debug",
		description: "Read buffered console logs and record network for Open Studio preview / Web Explore. User asks what is in the console → op=console (or fetch with fetchLogs:true). Console is buffered continuously; no start needed. For first-load network only: op=start with reload=true, then catalog/fetch. Ops: start|stop|clear|status|catalog|console|logs|fetch|reload. Do NOT use browser_debugger to read console output.",
		parameters: Type.Object({
			op: Type.String({
				description: "console | logs | start | stop | clear | status | catalog | fetch | reload"
			}),
			clear: Type.Optional(Type.Boolean({ description: "For start: clear prior buffers (default true)" })),
			reload: Type.Optional(Type.Boolean({ description: "For start: reload webview after recording starts (capture first-load requests). Or use op=reload." })),
			waitMs: Type.Optional(Type.Number({ description: "After reload, wait before returning (default 1200)" })),
			ignoreCache: Type.Optional(Type.Boolean({ description: "Reload ignoring HTTP cache" })),
			max: Type.Optional(Type.Number({ description: "Max catalog/fetch rows" })),
			networkIds: Type.Optional(Type.Array(Type.String(), { description: "Fetch these network entry ids (req_N)" })),
			logIds: Type.Optional(Type.Array(Type.String(), { description: "Fetch these console entry ids (log_N)" })),
			logLevels: Type.Optional(Type.Array(Type.String(), { description: "Filter: error|warn|info|log" })),
			contains: Type.Optional(Type.String({ description: "Substring filter for console messages" })),
			urlContains: Type.Optional(Type.String({ description: "Substring filter for request URLs" })),
			onlyErrors: Type.Optional(Type.Boolean({ description: "Prefer failed/4xx/5xx + warn/error logs" })),
			includeResponseBody: Type.Optional(Type.Boolean({ description: "For fetch: include response body (default true)" })),
			maxChars: Type.Optional(Type.Number({ description: "Truncate body/message chars" })),
			fetchLogs: Type.Optional(Type.Boolean()),
			fetchNetwork: Type.Optional(Type.Boolean()),
			statusMin: Type.Optional(Type.Number()),
			statusMax: Type.Optional(Type.Number())
		}, { additionalProperties: true }),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const op = String(params.op || "").trim();
			if (!op) throw new ToolInputError("op is required");
			const url = \`\${baseUrl}/v1/browser_debug\`;
			const headers = {
				"content-type": "application/json",
				accept: "application/json"
			};
			if (token) headers.authorization = \`Bearer \${token}\`;
			let response;
			try {
				response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(params),
					signal: AbortSignal.timeout(12e4)
				});
			} catch (error) {
				return jsonResult({
					ok: false,
					error: "bridge_unreachable",
					message: formatErrorMessage(error),
					hint: "Ensure Open Studio is running (browser tools bridge on OPEN_STUDIO_SIDEBAR_TOOL_URL)."
				});
			}
			const text = await response.text();
			let payload;
			try {
				payload = text ? JSON.parse(text) : {};
			} catch {
				payload = {
					ok: false,
					error: "invalid_bridge_json",
					raw: text.slice(0, 500)
				};
			}
			if (!response.ok) return jsonResult({
				ok: false,
				error: "bridge_http_error",
				status: response.status,
				...payload && typeof payload === "object" ? payload : { raw: payload }
			});
			return jsonResult(payload);
		}
	};
}

function createBrowserScreenshotTool() {
	/* ${MARKER}_SHOT */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	return {
		label: "Browser Screenshot",
		name: "browser_screenshot",
		displaySummary: "Capture preview screenshot",
		description: "Capture a viewport screenshot of the Open Studio preview panel or Web Explore page. Use when the DOM inventory is insufficient (icon-only controls, canvas, visual layout). Returns a PNG path (and optional base64). Does not replace browser_action for clicking — use observation refs after visual inspection when possible.",
		parameters: Type.Object({
			includeBase64: Type.Optional(Type.Boolean({
				description: "Include base64 PNG in the tool result when small enough (default false)"
			}))
		}, { additionalProperties: true }),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const url = \`\${baseUrl}/v1/browser_screenshot\`;
			const headers = {
				"content-type": "application/json",
				accept: "application/json"
			};
			if (token) headers.authorization = \`Bearer \${token}\`;
			let response;
			try {
				response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(params || {}),
					signal: AbortSignal.timeout(12e4)
				});
			} catch (error) {
				return jsonResult({
					ok: false,
					error: "bridge_unreachable",
					message: formatErrorMessage(error),
					hint: "Ensure Open Studio is running (browser tools bridge on OPEN_STUDIO_SIDEBAR_TOOL_URL)."
				});
			}
			const text = await response.text();
			let payload;
			try {
				payload = text ? JSON.parse(text) : {};
			} catch {
				payload = {
					ok: false,
					error: "invalid_bridge_json",
					raw: text.slice(0, 500)
				};
			}
			if (!response.ok) return jsonResult({
				ok: false,
				error: "bridge_http_error",
				status: response.status,
				...payload && typeof payload === "object" ? payload : { raw: payload }
			});
			return jsonResult(payload);
		}
	};
}
`;

const FN_NEEDLE = `function createGetGoalTool(options) {`;

const RELOAD_MARKER = "OPEN_STUDIO_browser_debug_RELOAD";
const CONSOLE_MARKER = "OPEN_STUDIO_browser_debug_CONSOLE";
const LIST_MARKER = "OPEN_STUDIO_BROWSER_DEBUG_TOOL_LIST";

/** Ensure browser_debug / browser_screenshot are registered in the core tool list. */
function upgradeToolListRegistration(src) {
  if (src.includes(LIST_MARKER)) return { src, changed: false };
  if (!src.includes("const browserDebugTool = createBrowserDebugTool();")) {
    return { src, changed: false };
  }
  let next = src;
  const patterns = [
    [
      `pdfTool,
			browserActionTool,
			browserDebuggerTool
		])`,
      `pdfTool,
			browserActionTool,
			browserDebugTool,
			browserScreenshotTool,
			browserDebuggerTool
		]) /* ${LIST_MARKER} */`,
    ],
    [
      `pdfTool,
			browserActionTool
		])`,
      `pdfTool,
			browserActionTool,
			browserDebugTool,
			browserScreenshotTool
		]) /* ${LIST_MARKER} */`,
    ],
    [
      `pdfTool,
			browserDebuggerTool
		])`,
      `pdfTool,
			browserActionTool,
			browserDebugTool,
			browserScreenshotTool,
			browserDebuggerTool
		]) /* ${LIST_MARKER} */`,
    ],
  ];
  for (const [from, to] of patterns) {
    if (next.includes(from) && !next.includes("browserDebugTool,")) {
      next = next.replace(from, to);
      return { src: next, changed: true };
    }
  }
  if (
    next.includes("browserDebugTool") &&
    next.includes("browserScreenshotTool") &&
    !next.includes("browserDebugTool,")
  ) {
    next = next.replace(
      /browserActionTool,\s*\n\s*browserDebuggerTool\s*\n\s*\]\)/,
      `browserActionTool,
			browserDebugTool,
			browserScreenshotTool,
			browserDebuggerTool
		]) /* ${LIST_MARKER} */`,
    );
    if (next !== src) return { src: next, changed: true };
  }
  return { src, changed: false };
}

/** Update browser_debug copy for op=console. */
function upgradeConsoleOp(src) {
  if (src.includes(CONSOLE_MARKER)) return { src, changed: false };
  if (!src.includes('name: "browser_debug"')) return { src, changed: false };
  let next = src;
  const newDesc =
    "Read buffered console logs and record network for Open Studio preview / Web Explore. User asks what is in the console → op=console (or fetch with fetchLogs:true). Console is buffered continuously; no start needed. For first-load network only: op=start with reload=true, then catalog/fetch. Ops: start|stop|clear|status|catalog|console|logs|fetch|reload. Do NOT use browser_debugger to read console output. /* " +
    CONSOLE_MARKER +
    " */";
  next = next.replace(
    /description: "Record and inspect console logs[\s\S]*?Large payloads are NOT auto-injected\.[^"]*"/,
    `description: "${newDesc.replace(/"/g, '\\"')}"`,
  );
  next = next.replace(
    /description: "Read buffered console logs[\s\S]*?Do NOT use browser_debugger to read console output\.[^"]*"/,
    `description: "${newDesc.replace(/"/g, '\\"')}"`,
  );
  const oldOp = 'description: "start | stop | clear | status | catalog | fetch | reload"';
  const newOp = 'description: "console | logs | start | stop | clear | status | catalog | fetch | reload"';
  if (next.includes(oldOp)) next = next.replace(oldOp, newOp);
  if (!next.includes(CONSOLE_MARKER) && next.includes(MARKER)) {
    next = next.replace(`/* ${MARKER} */`, `/* ${MARKER} */\n\t/* ${CONSOLE_MARKER} */`);
  }
  return { src: next, changed: next !== src };
}

/** Update already-injected tool text when reload support is missing. */
function upgradeReloadSupport(src) {
  if (src.includes(RELOAD_MARKER)) return { src, changed: false };
  let next = src;
  const oldDesc =
    "Record and inspect console logs + network requests for the Open Studio preview panel or Web Explore page. Workflow: op=start (before reproducing) → use browser_action → op=catalog (summaries only) → op=fetch (selected ids/filters). Large payloads are NOT auto-injected; pull only what you need. Ops: start|stop|clear|status|catalog|fetch.";
  const newDesc =
    "Record and inspect console logs + network requests for the Open Studio preview panel or Web Explore page. For first-load requests/logs: op=start with reload=true (starts recording then reloads the webview). Or op=reload while already recording. Then op=catalog → op=fetch. Also: start|stop|clear|status|catalog|fetch|reload. Large payloads are NOT auto-injected. /* " +
    RELOAD_MARKER +
    " */";
  if (next.includes(oldDesc)) {
    next = next.replace(oldDesc, newDesc);
  } else if (next.includes('name: "browser_debug"') && !next.includes("reload=true")) {
    next = next.replace(
      /description: "Record and inspect console logs[\s\S]*?Ops: start\|stop\|clear\|status\|catalog\|fetch\."/,
      `description: "${newDesc.replace(/"/g, '\\"')}"`,
    );
  }
  const oldOp = 'description: "start | stop | clear | status | catalog | fetch"';
  const newOp = 'description: "start | stop | clear | status | catalog | fetch | reload"';
  if (next.includes(oldOp)) next = next.replace(oldOp, newOp);

  if (
    next.includes('name: "browser_debug"') &&
    !next.includes('description: "For start: reload the webview after recording starts')
  ) {
    next = next.replace(
      'clear: Type.Optional(Type.Boolean({ description: "For start: clear prior buffers (default true)" })),',
      `clear: Type.Optional(Type.Boolean({ description: "For start: clear prior buffers (default true)" })),
			reload: Type.Optional(Type.Boolean({ description: "For start: reload the webview after recording starts (capture first-load network/console). Also use op=reload." })),
			waitMs: Type.Optional(Type.Number({ description: "After reload, wait this many ms before returning (default 1200)" })),
			ignoreCache: Type.Optional(Type.Boolean({ description: "Reload ignoring HTTP cache" })),`,
    );
  }
  // Ensure RELOAD_MARKER is present even if desc already differed
  if (!next.includes(RELOAD_MARKER) && next.includes(MARKER)) {
    next = next.replace(`/* ${MARKER} */`, `/* ${MARKER} */\n\t/* ${RELOAD_MARKER} */`);
  }
  return { src: next, changed: next !== src };
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-preview-tools] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER)) {
    let next = src;
    let changed = false;
    for (const upgrade of [upgradeToolListRegistration, upgradeConsoleOp, upgradeReloadSupport]) {
      const result = upgrade(next);
      next = result.src;
      changed = changed || result.changed;
    }
    if (changed) {
      fs.writeFileSync(target, next, "utf8");
      console.log("[patch-openclaw-sidebar-preview-tools] upgraded existing injection →", path.relative(root, target));
    } else {
      console.log("[patch-openclaw-sidebar-preview-tools] already applied");
    }
    return;
  }
  if (!src.includes(FN_NEEDLE)) {
    console.warn(
      "[patch-openclaw-sidebar-preview-tools] skip — upstream openclaw-tools bundle changed; update patch for this openclaw version",
    );
    process.exitCode = 1;
    return;
  }

  src = src.replace(FN_NEEDLE, `${TOOL_FN}\n${FN_NEEDLE}`);

  // Inject create calls after browser_action prep stage when present; else after web-fetch.
  if (src.includes("const browserDebugTool = createBrowserDebugTool();")) {
    // already applied
  } else if (src.includes("const browserDebuggerTool = createBrowserDebuggerTool();")) {
    src = src.replace(
      `const browserActionTool = createBrowserActionTool();
	const browserDebuggerTool = createBrowserDebuggerTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	options?.recordToolPrepStage?.("openclaw-tools:browser-debugger-tool");`,
      `const browserActionTool = createBrowserActionTool();
	const browserDebugTool = createBrowserDebugTool();
	const browserScreenshotTool = createBrowserScreenshotTool();
	const browserDebuggerTool = createBrowserDebuggerTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	options?.recordToolPrepStage?.("openclaw-tools:browser-preview-tools");
	options?.recordToolPrepStage?.("openclaw-tools:browser-debugger-tool");`,
    );
  } else if (src.includes(`options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");`)) {
    src = src.replace(
      `\toptions?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`,
      `\toptions?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	const browserDebugTool = createBrowserDebugTool();
	const browserScreenshotTool = createBrowserScreenshotTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-preview-tools");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`,
    );
  } else if (src.includes(`options?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");`)) {
    src = src.replace(
      `\toptions?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`,
      `\toptions?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");
	const browserDebugTool = createBrowserDebugTool();
	const browserScreenshotTool = createBrowserScreenshotTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-preview-tools");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`,
    );
  } else {
    console.warn("[patch-openclaw-sidebar-preview-tools] skip — create call inject point not found");
    process.exitCode = 1;
    return;
  }

  // Tool list: prefer inserting after browserActionTool if present.
  const listUpgraded = upgradeToolListRegistration(src);
  src = listUpgraded.src;
  if (!listUpgraded.changed && !src.includes(LIST_MARKER)) {
    if (src.includes(`pdfTool,
			browserActionTool,
			browserDebuggerTool
		])`)) {
      src = src.replace(
        `pdfTool,
			browserActionTool,
			browserDebuggerTool
		])`,
        `pdfTool,
			browserActionTool,
			browserDebugTool,
			browserScreenshotTool,
			browserDebuggerTool
		]) /* ${LIST_MARKER} */`,
      );
    } else if (src.includes(`pdfTool,
			browserActionTool
		])`)) {
      src = src.replace(
        `pdfTool,
			browserActionTool
		])`,
        `pdfTool,
			browserActionTool,
			browserDebugTool,
			browserScreenshotTool
		]) /* ${LIST_MARKER} */`,
      );
    } else if (src.includes(`imageTool,
			pdfTool
		])`)) {
      src = src.replace(
        `imageTool,
			pdfTool
		])`,
        `imageTool,
			pdfTool,
			browserDebugTool,
			browserScreenshotTool
		]) /* ${LIST_MARKER} */`,
      );
    } else {
      console.warn("[patch-openclaw-sidebar-preview-tools] skip — tool list inject point not found");
      process.exitCode = 1;
      return;
    }
  }

  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-preview-tools] applied →", path.relative(root, target));
}

main();
