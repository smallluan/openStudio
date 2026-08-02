/**
 * Inject native `browser_action` tool into OpenClaw createOpenClawTools.
 * Used to apply the change locally and to refresh patches/openclaw+2026.6.1.patch.
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

const MARKER = "OPEN_STUDIO_BROWSER_ACTION_TOOL";

const TOOL_FN = `
function createBrowserActionTool() {
	/* ${MARKER} */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	const stepSchema = Type.Object({
		action: Type.String({ description: "UI action: click, focus, type, press, wait, scroll, query, inspect, snapshot, navigate, reload, ..." }),
		ref: Type.Optional(Type.String({ description: "Element ref from observation.elements, e.g. e3" })),
		selector: Type.Optional(Type.String()),
		text: Type.Optional(Type.String()),
		key: Type.Optional(Type.String()),
		url: Type.Optional(Type.String()),
		ms: Type.Optional(Type.Number()),
		label: Type.Optional(Type.String()),
		placeholder: Type.Optional(Type.String()),
		title: Type.Optional(Type.String()),
		mode: Type.Optional(Type.String()),
		amount: Type.Optional(Type.Number()),
		parentSelector: Type.Optional(Type.String())
	}, { additionalProperties: true });
	return {
		label: "Browser Action",
		name: "browser_action",
		displaySummary: "Control Open Studio preview page",
	description: "Execute a UI automation batch (up to the configured per-turn step limit, default 20) on the Web Explore main viewport or Chat Lab preview panel. Browser tools target the Open Studio preview panel — call this tool in Web Explore when the user asks to click/type/scroll. Prefer explicit selector for selector-only tasks. Use action=query/inspect for targeted DOM discovery; use domRead=inventory/full only when exploration is needed. The result includes an observation whose DOM level is reported as domRead. Do not invent natural-language targets. After navigate/reload, prior page element refs are invalid — use the latest observation only (older DOM is stripped from context unless retainPriorPageDom=true).",
		parameters: Type.Object({
			steps: Type.Array(stepSchema, {
				minItems: 1,
				maxItems: 100,
				description: "Observe→act batch; Open Studio applies the configured per-turn step limit (default 20)"
			}),
			retainPriorPageDom: Type.Optional(Type.Boolean({
				description: "Keep the previous page's DOM inventory in context (rare; default strips prior page DOM after navigation)"
			})),
			domRead: Type.Optional(Type.String({
				description: "DOM read level: auto (default), none, metadata, target, inventory, or full. auto skips unrelated page DOM when steps use explicit selectors."
			}))
		}, { additionalProperties: true }),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const steps = Array.isArray(params.steps) ? params.steps : [];
			if (!steps.length) throw new ToolInputError("steps is required");
			const url = \`\${baseUrl}/v1/browser_action\`;
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
					body: JSON.stringify({
						steps,
						retainPriorPageDom: params.retainPriorPageDom === true,
						domRead: typeof params.domRead === "string" ? params.domRead : "auto"
					}),
					signal: AbortSignal.timeout(12e4)
				});
			} catch (error) {
				return jsonResult({
					ok: false,
					error: "bridge_unreachable",
					message: formatErrorMessage(error),
					hint: "Ensure Open Studio is running (browser_action bridge on OPEN_STUDIO_SIDEBAR_TOOL_URL)."
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

const INJECT_CALL_NEEDLE = `\toptions?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`;

const INJECT_CALL_REPLACEMENT = `\toptions?.recordToolPrepStage?.("openclaw-tools:web-fetch-tool");
	const browserActionTool = createBrowserActionTool();
	options?.recordToolPrepStage?.("openclaw-tools:browser-action-tool");
	const messageTool = options?.disableMessageTool ? null : createMessageTool({`;

const INJECT_LIST_NEEDLE = `\t\t...collectPresentOpenClawTools([
			webSearchTool,
			webFetchTool,
			imageTool,
			pdfTool
		])`;

const INJECT_LIST_REPLACEMENT = `\t\t...collectPresentOpenClawTools([
			webSearchTool,
			webFetchTool,
			imageTool,
			pdfTool,
			browserActionTool
		])`;

const FN_NEEDLE = `function createGetGoalTool(options) {`;

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-action] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER)) {
    console.log("[patch-openclaw-sidebar-action] already applied");
    return;
  }
  if (!src.includes(FN_NEEDLE) || !src.includes(INJECT_CALL_NEEDLE) || !src.includes(INJECT_LIST_NEEDLE)) {
    console.warn(
      "[patch-openclaw-sidebar-action] skip — upstream openclaw-tools bundle changed; update patch for this openclaw version",
    );
    process.exitCode = 1;
    return;
  }
  src = src.replace(FN_NEEDLE, `${TOOL_FN}\n${FN_NEEDLE}`);
  src = src.replace(INJECT_CALL_NEEDLE, INJECT_CALL_REPLACEMENT);
  src = src.replace(INJECT_LIST_NEEDLE, INJECT_LIST_REPLACEMENT);
  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-action] applied →", path.relative(root, target));
}

main();
