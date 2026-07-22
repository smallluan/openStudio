/**
 * Inject native `sidebar_action` tool into OpenClaw createOpenClawTools.
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

const MARKER = "OPEN_STUDIO_SIDEBAR_ACTION_TOOL";

const TOOL_FN = `
function createSidebarActionTool() {
	/* ${MARKER} */
	const baseUrl = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_URL || "").trim().replace(/\\/$/, "");
	if (!baseUrl) return null;
	const token = String(process.env.OPEN_STUDIO_SIDEBAR_TOOL_TOKEN || "").trim();
	const stepSchema = Type.Object({
		action: Type.String({ description: "UI action: click, focus, type, press, wait, scroll, snapshot, navigate, reload, ..." }),
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
		label: "Sidebar Action",
		name: "sidebar_action",
		displaySummary: "Control Open Studio preview page",
		description: "Execute a short UI automation batch (max 5 steps) on the Web Explore main viewport or Chat Lab sidebar preview. The sidebar_ prefix does NOT mean sidebar-only — call this tool in Web Explore when the user asks to click/type/scroll. Prefer ref/selector from the injected page inventory or the previous tool observation. The result includes a fresh observation with elements[].ref — call sidebar_action again for the next batch, or answer the user in natural language when done. Do not invent natural-language targets.",
		parameters: Type.Object({
			steps: Type.Array(stepSchema, {
				minItems: 1,
				maxItems: 5,
				description: "Short observe→act batch (max 5 steps)"
			})
		}),
		execute: async (_toolCallId, args) => {
			const params = asToolParamsRecord(args);
			const steps = Array.isArray(params.steps) ? params.steps : [];
			if (!steps.length) throw new ToolInputError("steps is required");
			const url = \`\${baseUrl}/v1/sidebar_action\`;
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
					body: JSON.stringify({ steps }),
					signal: AbortSignal.timeout(12e4)
				});
			} catch (error) {
				return jsonResult({
					ok: false,
					error: "bridge_unreachable",
					message: formatErrorMessage(error),
					hint: "Ensure Open Studio is running (sidebar_action bridge on OPEN_STUDIO_SIDEBAR_TOOL_URL)."
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
	const sidebarActionTool = createSidebarActionTool();
	options?.recordToolPrepStage?.("openclaw-tools:sidebar-action-tool");
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
			sidebarActionTool
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
