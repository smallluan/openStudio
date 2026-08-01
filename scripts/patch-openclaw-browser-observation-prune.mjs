/**
 * Inject browser_action DOM pruning into OpenClaw prompt assembly.
 *
 * Hooks `truncateOversizedToolResultsInMessages` so every LLM request drops
 * stale page inventories while keeping action trails. Extends the native
 * `browser_action` tool schema with `retainPriorPageDom` and layered `domRead`.
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

const PATCH_TOKEN = "OPEN_STUDIO_BROWSER_OBSERVATION_PRUNE";
const TOOL_PARAM_TOKEN = "OPEN_STUDIO_BROWSER_ACTION_RETAIN_PRIOR";

/**
 * @param {string} dir
 * @param {string} prefix
 */
function findDistFile(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(".js"));
  return hit ? path.join(dir, hit) : null;
}

function loadPruneHelperSource() {
  const file = path.join(root, "lib", "browser-observation-prune.cjs");
  const raw = fs.readFileSync(file, "utf8");
  const begin = raw.indexOf("// OPEN_STUDIO_BROWSER_OBSERVATION_PRUNE_BEGIN");
  const end = raw.indexOf("// OPEN_STUDIO_BROWSER_OBSERVATION_PRUNE_END");
  if (begin < 0 || end < 0 || end <= begin) {
    throw new Error("browser-observation-prune.cjs missing BEGIN/END markers");
  }
  return raw.slice(begin, end).replace(/^\/\/ OPEN_STUDIO_BROWSER_OBSERVATION_PRUNE_BEGIN\s*/m, "");
}

function patchTruncationBundle() {
  const target = findDistFile(distDir, "tool-result-truncation-");
  if (!target || !fs.existsSync(target)) {
    console.warn("[patch-openclaw-browser-observation-prune] skip — truncation bundle not found");
    return false;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(PATCH_TOKEN)) {
    console.log("[patch-openclaw-browser-observation-prune] truncation already applied");
    return true;
  }

  const needle =
    "function truncateOversizedToolResultsInMessages(messages, contextWindowTokens, maxCharsOverride, aggregateMaxCharsOverride) {\n\tconst maxChars = Math.max(1, maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens));";
  if (!src.includes(needle)) {
    console.warn(
      "[patch-openclaw-browser-observation-prune] skip — truncateOversizedToolResultsInMessages needle missing",
    );
    return false;
  }

  const helper = loadPruneHelperSource();
  const replacement =
    "function truncateOversizedToolResultsInMessages(messages, contextWindowTokens, maxCharsOverride, aggregateMaxCharsOverride) {\n" +
    "\tmessages = openStudioPruneStaleBrowserActionDom(messages);\n" +
    "\tconst maxChars = Math.max(1, maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens));";

  src = src.replace(needle, replacement);

  const marker = "//#endregion\nexport";
  if (src.includes(marker)) {
    src = src.replace(marker, `${helper}\n// ${PATCH_TOKEN}\n${marker}`);
  } else {
    src = `${helper}\n// ${PATCH_TOKEN}\n${src}`;
  }

  fs.writeFileSync(target, src, "utf8");
  console.log(
    "[patch-openclaw-browser-observation-prune] truncation applied →",
    path.relative(root, target),
  );
  return true;
}

function patchBrowserActionToolSchema() {
  const target = findDistFile(distDir, "openclaw-tools-");
  if (!target || !fs.existsSync(target)) {
    console.warn("[patch-openclaw-browser-observation-prune] skip — openclaw-tools bundle not found");
    return false;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(TOOL_PARAM_TOKEN) && src.includes("domRead: Type.Optional")) {
    console.log("[patch-openclaw-browser-observation-prune] browser_action retain param already applied");
    return true;
  }
  if (!src.includes("OPEN_STUDIO_BROWSER_ACTION_TOOL")) {
    console.warn(
      "[patch-openclaw-browser-observation-prune] skip — browser_action tool not present yet",
    );
    return false;
  }

  const realNeedleStart = `parameters: Type.Object({
			steps: Type.Array(stepSchema, {
				minItems: 1,
				maxItems: 5,
				description: "Short observe→act batch (max 5 steps)"
			})
		}),`;
  const domReadNeedleStart = `parameters: Type.Object({
			steps: Type.Array(stepSchema, {
				minItems: 1,
				maxItems: 5,
				description: "Short observe→act batch (max 5 steps)"
			}),
			domRead: Type.Optional(Type.String({
				description: "DOM read level: auto (default), none, metadata, target, inventory, or full. auto skips unrelated page DOM when steps use explicit selectors."
			}))
		}),`;
  const retainedNeedleStart = `parameters: Type.Object({
			steps: Type.Array(stepSchema, {
				minItems: 1,
				maxItems: 5,
				description: "Short observe→act batch (max 5 steps)"
			}),
			retainPriorPageDom: Type.Optional(Type.Boolean({
				description: "Keep the previous page's DOM inventory in context (rare; default strips prior page DOM after navigation)"
			}))
		}, { additionalProperties: true }),`;

  if (!src.includes(realNeedleStart) && !src.includes(domReadNeedleStart) && !src.includes(retainedNeedleStart)) {
    console.warn(
      "[patch-openclaw-browser-observation-prune] skip — browser_action parameters needle missing",
    );
    return false;
  }

  // There may be multiple tools with similar body - scope to browser_action by requiring nearby marker
  const toolIdx = src.indexOf("OPEN_STUDIO_BROWSER_ACTION_TOOL");
  const slice = src.slice(toolIdx, toolIdx + 3500);
  if (
    !slice.includes("body: JSON.stringify({ steps }),") &&
    !slice.includes("body: JSON.stringify({ steps, domRead:") &&
    !slice.includes("body: JSON.stringify({")
  ) {
    console.warn(
      "[patch-openclaw-browser-observation-prune] skip — browser_action fetch body needle missing",
    );
    return false;
  }

  const desiredSchema = `parameters: Type.Object({
			steps: Type.Array(stepSchema, {
				minItems: 1,
				maxItems: 5,
				description: "Short observe→act batch (max 5 steps)"
			}),
			retainPriorPageDom: Type.Optional(Type.Boolean({
				description: "Keep the previous page's DOM inventory in context (rare; default strips prior page DOM after navigation)"
			})),
			domRead: Type.Optional(Type.String({
				description: "DOM read level: auto (default), none, metadata, target, inventory, or full. auto skips unrelated page DOM when steps use explicit selectors."
			}))
		}, { additionalProperties: true }), /* ${TOOL_PARAM_TOKEN} */`;
  if (src.includes(realNeedleStart)) {
    src = src.replace(realNeedleStart, desiredSchema);
  } else if (src.includes(retainedNeedleStart)) {
    src = src.replace(
      retainedNeedleStart,
      desiredSchema,
    );
  } else {
    const withRetain = domReadNeedleStart.replace(
      `			domRead: Type.Optional(Type.String({
				description: "DOM read level: auto (default), none, metadata, target, inventory, or full. auto skips unrelated page DOM when steps use explicit selectors."
			}))`,
      `			retainPriorPageDom: Type.Optional(Type.Boolean({
				description: "Keep the previous page's DOM inventory in context (rare; default strips prior page DOM after navigation)"
			})),
			domRead: Type.Optional(Type.String({
				description: "DOM read level: auto (default), none, metadata, target, inventory, or full. auto skips unrelated page DOM when steps use explicit selectors."
			}))`,
    );
    src = src.replace(
      domReadNeedleStart,
      withRetain.replace(`		}),`, `		}, { additionalProperties: true }), /* ${TOOL_PARAM_TOKEN} */`),
    );
  }

  // Replace only the first { steps } body after the browser_action marker
  const before = src.slice(0, toolIdx);
  const after = src.slice(toolIdx);
  const afterPatched = after.replace(
    /body: JSON\.stringify\(\{[\s\S]*?\}\),/,
    `body: JSON.stringify({ steps, retainPriorPageDom: params.retainPriorPageDom === true, domRead: typeof params.domRead === "string" ? params.domRead : "auto" }),`,
  );
  if (afterPatched === after) {
    console.warn(
      "[patch-openclaw-browser-observation-prune] skip — failed to rewrite browser_action fetch body",
    );
    return false;
  }
  src = before + afterPatched;

  // Soften description note if not already present
  if (!src.includes("pageGeneration") && src.includes("OPEN_STUDIO_BROWSER_ACTION_TOOL")) {
    src = src.replace(
      "Do not invent natural-language targets.",
      "Do not invent natural-language targets. After navigate/reload, prior page element refs are invalid — use the latest observation only (older DOM is stripped from context unless retainPriorPageDom=true).",
    );
  }

  fs.writeFileSync(target, src, "utf8");
  console.log(
    "[patch-openclaw-browser-observation-prune] browser_action schema applied →",
    path.relative(root, target),
  );
  return true;
}

function main() {
  const a = patchTruncationBundle();
  const b = patchBrowserActionToolSchema();
  if (!a && !b) {
    console.warn("[patch-openclaw-browser-observation-prune] no targets patched");
    process.exitCode = 1;
  }
}

main();
