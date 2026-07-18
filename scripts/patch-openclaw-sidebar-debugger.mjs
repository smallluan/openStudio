/**
 * Inject native `sidebar_debugger` tool into OpenClaw createOpenClawTools.
 * Runs after patch-openclaw-sidebar-preview-tools.mjs (shares HTTP bridge).
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

const MARKER = "OPEN_STUDIO_SIDEBAR_DEBUGGER_TOOL";

const TOOL_FN = `
function createSidebarDebuggerTool() {
	/* ${MARKER} */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	return {
		label: "Sidebar Debugger",
		name: "sidebar_debugger",
		displaySummary: "Preview JS breakpoints",
		description: "Set breakpoints and inspect paused JavaScript on the Open Studio preview / Web Explore page via CDP Debugger. Workflow: op=enable → op=break_on_text → reproduce with sidebar_action. On hit, sidebar_action returns debuggerPaused:true with inspect (pause bar on preview). After inspect/evaluate you MUST op=resume before any retry or further clicks — leaving the page paused blocks the user. Do not treat freeze/timeout as a miss. No source maps yet. Do not open guest DevTools while using this tool.",
		parameters: Type.Object({
			op: Type.String({
				description: "enable | disable | status | search | break_on_text | break_on_location | clear_breakpoints | wait_paused | inspect | evaluate | resume | step_over | step_into | step_out"
			}),
			text: Type.Optional(Type.String({ description: "For search/break_on_text: substring to find in loaded JS sources" })),
			query: Type.Optional(Type.String({ description: "Alias for text" })),
			url: Type.Optional(Type.String({ description: "For break_on_location: script URL from search or console stack" })),
			line: Type.Optional(Type.Number({ description: "0-based line number for break_on_location" })),
			column: Type.Optional(Type.Number({ description: "0-based column for break_on_location" })),
			maxMatches: Type.Optional(Type.Number({ description: "Max search matches (default 8)" })),
			maxBreakpoints: Type.Optional(Type.Number({ description: "For break_on_text: max breakpoints to set (default 3)" })),
			caseSensitive: Type.Optional(Type.Boolean()),
			timeoutMs: Type.Optional(Type.Number({ description: "For wait_paused (default 10000, max 60000)" })),
			frameIndex: Type.Optional(Type.Number({ description: "For inspect/evaluate: paused call frame index" })),
			callFrameId: Type.Optional(Type.String({ description: "For evaluate: explicit callFrameId" })),
			expression: Type.Optional(Type.String({ description: "For evaluate: JS expression in paused frame" }))
		}, { additionalProperties: true }),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const op = String(params.op || "").trim();
			if (!op) throw new ToolInputError("op is required");
			const url = \`\${baseUrl}/v1/sidebar_debugger\`;
			const headers = {
				"content-type": "application/json",
				accept: "application/json"
			};
			if (token) headers.authorization = \`Bearer \${token}\`;
			const timeoutMs = op === "wait_paused" || op === "waitpaused"
				? Math.max(5e3, Math.min(12e4, Number(params.timeoutMs) || 1e4) + 5e3)
				: 12e4;
			let response;
			try {
				response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(params),
					signal: AbortSignal.timeout(timeoutMs)
				});
			} catch (error) {
				return jsonResult({
					ok: false,
					error: "bridge_unreachable",
					message: formatErrorMessage(error),
					hint: "Ensure Open Studio is running (sidebar tools bridge on OPEN_STUDIO_SIDEBAR_TOOL_URL)."
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

function injectCreateCall(src) {
  if (src.includes("const sidebarDebuggerTool = createSidebarDebuggerTool();")) {
    return src;
  }
  if (src.includes("const sidebarScreenshotTool = createSidebarScreenshotTool();")) {
    return src.replace(
      `const sidebarScreenshotTool = createSidebarScreenshotTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-preview-tools");`,
      `const sidebarScreenshotTool = createSidebarScreenshotTool();
	const sidebarDebuggerTool = createSidebarDebuggerTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-preview-tools");
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-debugger-tool");`,
    );
  }
  if (src.includes("const sidebarActionTool = createSidebarActionTool();")) {
    return src.replace(
      `const sidebarActionTool = createSidebarActionTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-action-tool");`,
      `const sidebarActionTool = createSidebarActionTool();
	const sidebarDebuggerTool = createSidebarDebuggerTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-action-tool");
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-debugger-tool");`,
    );
  }
  if (src.includes(`options?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");`)) {
    return src.replace(
      `\toptions?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`,
      `\toptions?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");
	const sidebarDebuggerTool = createSidebarDebuggerTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-debugger-tool");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`,
    );
  }
  return null;
}

function injectToolList(src) {
  if (src.includes("sidebarDebuggerTool")) {
    return src;
  }
  if (src.includes(`sidebarScreenshotTool
		])`)) {
    return src.replace(
      `sidebarScreenshotTool
		])`,
      `sidebarScreenshotTool,
			sidebarDebuggerTool
		])`,
    );
  }
  if (src.includes(`sidebarActionTool
		])`)) {
    return src.replace(
      `sidebarActionTool
		])`,
      `sidebarActionTool,
			sidebarDebuggerTool
		])`,
    );
  }
  if (src.includes(`pdfTool
		])`)) {
    return src.replace(
      `pdfTool
		])`,
      `pdfTool,
			sidebarDebuggerTool
		])`,
    );
  }
  return null;
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-debugger] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER)) {
    console.log("[patch-openclaw-sidebar-debugger] already applied");
    return;
  }
  if (!src.includes(FN_NEEDLE)) {
    console.warn(
      "[patch-openclaw-sidebar-debugger] skip — upstream openclaw-tools bundle changed; update patch for this openclaw version",
    );
    process.exitCode = 1;
    return;
  }

  src = src.replace(FN_NEEDLE, `${TOOL_FN}\n${FN_NEEDLE}`);

  const withCreate = injectCreateCall(src);
  if (!withCreate) {
    console.warn("[patch-openclaw-sidebar-debugger] skip — create call inject point not found");
    process.exitCode = 1;
    return;
  }
  src = withCreate;

  const withList = injectToolList(src);
  if (!withList) {
    console.warn("[patch-openclaw-sidebar-debugger] skip — tool list inject point not found");
    process.exitCode = 1;
    return;
  }
  src = withList;

  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-debugger] applied →", path.relative(root, target));
}

main();
