/**
 * Inject native `browser_open` tool into OpenClaw createOpenClawTools.
 * Opens URLs in the preview panel on demand (no auto-open from markdown links).
 * Runs after patch-openclaw-browser-action.mjs (shares HTTP bridge).
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

const MARKER = "OPEN_STUDIO_BROWSER_OPEN_TOOL";

const TOOL_FN = `
function createBrowserOpenTool() {
	/* ${MARKER} */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	return {
		label: "Browser Open",
		name: "browser_open",
		displaySummary: "Open URL in preview",
		description: "Open an HTTP(S) URL in the Open Studio preview panel (Chat Lab sidebar or Web Explore viewport). Use when the user asks to open, visit, or browse a webpage — markdown links in your reply are NOT auto-opened. After opening, use browser_action to interact or read the injected page snapshot. Params: url (required), title (optional).",
		parameters: Type.Object({
			url: Type.String({ description: "HTTP(S) URL to open in the preview panel" }),
			title: Type.Optional(Type.String({ description: "Optional tab/title label" }))
		}),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const url = String(params.url || "").trim();
			if (!url) throw new ToolInputError("url is required");
			const bridgeUrl = \`\${baseUrl}/v1/browser_open\`;
			const headers = {
				"content-type": "application/json",
				accept: "application/json"
			};
			if (token) headers.authorization = \`Bearer \${token}\`;
			let response;
			try {
				response = await fetch(bridgeUrl, {
					method: "POST",
					headers,
					body: JSON.stringify({ url, title: params.title }),
					signal: AbortSignal.timeout(3e4)
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
  // Prefer Chat Lab-only registration when Web Explore session scoping is present.
  if (src.includes("OPEN_STUDIO_BROWSER_OPEN_CHAT_LAB_ONLY")) return src;
  if (src.includes("const browserOpenTool = __studioWebExploreSession ? null : createBrowserOpenTool();")) {
    return src;
  }
  if (src.includes("const browserOpenTool = createBrowserOpenTool();")) {
    // Will be narrowed by patch-openclaw-sidebar-tools-scope.mjs when session helper exists.
    return src;
  }
  if (src.includes("const browserActionTool = createBrowserActionTool();")) {
    if (src.includes("const __studioWebExploreSession = isOpenStudioWebExploreSessionKey")) {
      return src.replace(
        `const browserActionTool = createBrowserActionTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");`,
        `const browserActionTool = createBrowserActionTool();
	const browserOpenTool = __studioWebExploreSession ? null : createBrowserOpenTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	options?.recordToolPrepStage?.("openclaw-tools:browser-open-tool");`,
      );
    }
    return src.replace(
      `const browserActionTool = createBrowserActionTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");`,
      `const browserActionTool = createBrowserActionTool();
	const browserOpenTool = createBrowserOpenTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	options?.recordToolPrepStage?.("openclaw-tools:browser-open-tool");`,
    );
  }
  if (src.includes("const sidebarActionTool = createSidebarActionTool();")) {
    return src.replace(
      `const sidebarActionTool = createSidebarActionTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-action-tool");`,
      `const sidebarActionTool = createSidebarActionTool();
	const browserOpenTool = createBrowserOpenTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-action-tool");
	options?.recordToolPrepStage?.("openclaw-tools:browser-open-tool");`,
    );
  }
  return null;
}

function injectToolList(src) {
  if (src.includes("browserOpenTool")) return src;
  if (src.includes(`browserActionTool
		])`)) {
    return src.replace(
      `browserActionTool
		])`,
      `browserActionTool,
			browserOpenTool
		])`,
    );
  }
  if (src.includes(`sidebarActionTool
		])`)) {
    return src.replace(
      `sidebarActionTool
		])`,
      `sidebarActionTool,
			browserOpenTool
		])`,
    );
  }
  return null;
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-browser-open] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER) && src.includes("browserOpenTool")) {
    console.log("[patch-openclaw-browser-open] already applied");
    return;
  }
  if (!src.includes(FN_NEEDLE)) {
    console.warn("[patch-openclaw-browser-open] skip — upstream openclaw-tools bundle changed");
    process.exitCode = 1;
    return;
  }
  if (!src.includes(MARKER)) {
    src = src.replace(FN_NEEDLE, `${TOOL_FN}\n${FN_NEEDLE}`);
  }
  const withCreate = injectCreateCall(src);
  if (!withCreate) {
    console.warn("[patch-openclaw-browser-open] skip — create call inject point not found");
    process.exitCode = 1;
    return;
  }
  src = withCreate;
  const withList = injectToolList(src);
  if (!withList) {
    console.warn("[patch-openclaw-browser-open] skip — tool list inject point not found");
    process.exitCode = 1;
    return;
  }
  src = withList;
  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-browser-open] applied →", path.relative(root, target));
}

main();
