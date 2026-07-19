/**
 * Scope sidebar debug tools to Web Explore sessions only.
 * Chat Lab sidebar preview keeps `sidebar_action`; debug tools register only when
 * agentSessionKey contains `#studio:wexplore:` (see newWebExploreConversationId).
 *
 * Runs after patch-openclaw-sidebar-debugger.mjs.
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

const MARKER = "OPEN_STUDIO_SIDEBAR_TOOLS_SCOPE";

const HELPER_FN = `
function isOpenStudioWebExploreSessionKey(agentSessionKey) {
	/* ${MARKER} */
	const key = String(agentSessionKey ?? "");
	return key.includes("#studio:wexplore:");
}
`;

const CREATE_OLD = `const sidebarDebugTool = createSidebarDebugTool();
	const sidebarScreenshotTool = createSidebarScreenshotTool();
	const sidebarDebuggerTool = createSidebarDebuggerTool();`;

const CREATE_NEW = `const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	const sidebarDebugTool = __studioWebExploreSession ? createSidebarDebugTool() : null;
	const sidebarScreenshotTool = __studioWebExploreSession ? createSidebarScreenshotTool() : null;
	const sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;`;

const CREATE_OLD_DEBUGGER_ONLY = `const sidebarDebuggerTool = createSidebarDebuggerTool();`;

const CREATE_NEW_DEBUGGER_ONLY = `const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	const sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;`;

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-tools-scope] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER) && src.includes(CREATE_NEW.split("\n")[1].trim())) {
    console.log("[patch-openclaw-sidebar-tools-scope] already applied");
    return;
  }
  if (!src.includes("function createOpenClawTools(options)")) {
    console.warn(
      "[patch-openclaw-sidebar-tools-scope] skip — upstream openclaw-tools bundle changed; update patch for this openclaw version",
    );
    process.exitCode = 1;
    return;
  }

  if (!src.includes(MARKER)) {
    src = src.replace(
      "function createOpenClawTools(options) {",
      `${HELPER_FN}\nfunction createOpenClawTools(options) {`,
    );
  }

  if (src.includes(CREATE_OLD)) {
    src = src.replace(CREATE_OLD, CREATE_NEW);
  } else if (src.includes(CREATE_OLD_DEBUGGER_ONLY) && !src.includes("sidebarDebugTool")) {
    src = src.replace(CREATE_OLD_DEBUGGER_ONLY, CREATE_NEW_DEBUGGER_ONLY);
  } else if (!src.includes("__studioWebExploreSession")) {
    console.warn("[patch-openclaw-sidebar-tools-scope] skip — create call inject point not found");
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-tools-scope] applied →", path.relative(root, target));
}

main();
