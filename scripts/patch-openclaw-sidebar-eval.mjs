/**
 * Inject native `browser_eval` tool into OpenClaw createOpenClawTools.
 * Runs after patch-openclaw-sidebar-debugger.mjs (shares HTTP bridge).
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

const MARKER = "OPEN_STUDIO_BROWSER_EVAL_TOOL";

const TOOL_FN = `
function createBrowserEvalTool() {
	/* ${MARKER} */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	return {
		label: "Browser Eval",
		name: "browser_eval",
		displaySummary: "Run JS on preview page",
		description: "Execute arbitrary JavaScript in the active Open Studio preview / Web Explore page context (same as DevTools console). Use for debugging, inspecting globals, or driving page APIs that browser_action cannot reach. Params: expression (required). Returns serialized result value. If debugger is paused on a breakpoint, use browser_debugger op=evaluate in the paused frame or op=resume first. Pair with browser_debugger breakpoints for deep inspection.",
		parameters: Type.Object({
			expression: Type.Optional(Type.String({ description: "JavaScript expression or statements to run in page context" })),
			script: Type.Optional(Type.String({ description: "Alias for expression" })),
			code: Type.Optional(Type.String({ description: "Alias for expression" }))
		}, { additionalProperties: true }),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const expression = String(params.expression || params.script || params.code || "").trim();
			if (!expression) throw new ToolInputError("expression is required");
			const url = \`\${baseUrl}/v1/browser_eval\`;
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
					body: JSON.stringify({ ...params, expression }),
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

function injectCreateCall(src) {
  if (src.includes("const browserEvalTool = createBrowserEvalTool();")) {
    return src;
  }
  if (src.includes("const browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;")) {
    return src;
  }
  if (src.includes("const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;")) {
    return src.replace(
      "const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;",
      "const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;\r\n\tconst browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;",
    ).replace(
      "const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;\r\n\tconst browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;",
      "const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;\r\n\tconst browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;",
    );
  }
  if (src.includes("const browserDebuggerTool = createBrowserDebuggerTool();")) {
    return src.replace(
      `const browserDebuggerTool = createBrowserDebuggerTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-debugger-tool");`,
      `const browserDebuggerTool = createBrowserDebuggerTool();
	const browserEvalTool = createBrowserEvalTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-debugger-tool");
	options?.recordToolPrepStage?.("openclaw-tools:browser-eval-tool");`,
    );
  }
  if (src.includes("const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;") && !src.includes("browserEvalTool")) {
    return src.replace(
      "const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;",
      `const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;
	const browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;`,
    );
  }
  console.warn("[patch-openclaw-sidebar-eval] skip — create call inject point not found");
  return src;
}

function toolListHasSidebarEval(src) {
  return /browserDebuggerTool,\r?\n[\t ]+browserEvalTool\r?\n[\t ]+\]/.test(src);
}

function injectToolList(src) {
  if (toolListHasSidebarEval(src)) return src;
  const replaced = src.replace(
    /(browserDebuggerTool)(\r?\n[\t ]+\])/,
    "$1,\n\t\t\tbrowserEvalTool$2",
  );
  if (replaced === src) {
    console.warn("[patch-openclaw-sidebar-eval] skip — tool list inject point not found");
  }
  return replaced;
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-eval] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  const toolListReady = src.includes(MARKER) && toolListHasSidebarEval(src);
  if (toolListReady) {
    console.log("[patch-openclaw-sidebar-eval] already applied");
    return;
  }
  if (!src.includes("function createOpenClawTools(options)")) {
    console.warn("[patch-openclaw-sidebar-eval] skip — upstream bundle changed");
    process.exitCode = 1;
    return;
  }
  if (!src.includes(MARKER)) {
    src = src.replace(FN_NEEDLE, `${TOOL_FN}\n${FN_NEEDLE}`);
  }
  src = injectCreateCall(src);
  src = injectToolList(src);
  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-eval] applied →", path.relative(root, target));
}

main();
