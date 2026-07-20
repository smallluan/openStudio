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
	const sidebarDebuggerTool = createSidebarDebuggerTool();
	const sidebarEvalTool = createSidebarEvalTool();`;

const CREATE_NEW = `const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	const sidebarDebugTool = __studioWebExploreSession ? createSidebarDebugTool() : null;
	const sidebarScreenshotTool = __studioWebExploreSession ? createSidebarScreenshotTool() : null;
	const sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;
	const sidebarEvalTool = __studioWebExploreSession ? createSidebarEvalTool() : null;`;

const CREATE_OLD_WITH_ACTION = `\tconst sidebarActionTool = createSidebarActionTool();
\tconst sidebarDebugTool = createSidebarDebugTool();
\tconst sidebarScreenshotTool = createSidebarScreenshotTool();
\tconst sidebarDebuggerTool = createSidebarDebuggerTool();
\tconst sidebarEvalTool = createSidebarEvalTool();`;

const CREATE_NEW_WITH_ACTION = `\tconst sidebarActionTool = createSidebarActionTool();
\tconst __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
\tconst sidebarDebugTool = __studioWebExploreSession ? createSidebarDebugTool() : null;
\tconst sidebarScreenshotTool = __studioWebExploreSession ? createSidebarScreenshotTool() : null;
\tconst sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;
\tconst sidebarEvalTool = __studioWebExploreSession ? createSidebarEvalTool() : null;`;

const CREATE_OLD_DEBUGGER_ONLY = `const sidebarDebuggerTool = createSidebarDebuggerTool();`;

const CREATE_NEW_DEBUGGER_ONLY = `const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	const sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;`;

/** Match/replace blocks regardless of CRLF vs LF in the bundle. */
function replaceBlock(src, old, next) {
  if (src.includes(old)) return src.replace(old, next);
  const oldCrlf = old.replace(/\n/g, "\r\n");
  const nextCrlf = next.replace(/\n/g, "\r\n");
  if (src.includes(oldCrlf)) return src.replace(oldCrlf, nextCrlf);
  return src;
}

function includesBlock(src, block) {
  return src.includes(block) || src.includes(block.replace(/\n/g, "\r\n"));
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-tools-scope] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(MARKER) && includesBlock(src, CREATE_NEW_WITH_ACTION.split("\n")[1]) && src.includes("sidebarEvalTool")) {
    console.log("[patch-openclaw-sidebar-tools-scope] already applied");
    return;
  }

  if (src.includes(MARKER) && src.includes("__studioWebExploreSession") && !src.includes("sidebarEvalTool")) {
    src = replaceBlock(
      src,
      `\tconst sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;`,
      `\tconst sidebarDebuggerTool = __studioWebExploreSession ? createSidebarDebuggerTool() : null;
\tconst sidebarEvalTool = __studioWebExploreSession ? createSidebarEvalTool() : null;`,
    );
    if (src.includes("...(sidebarDebuggerTool ? [sidebarDebuggerTool] : []),")) {
      src = src.replace(
        "...(sidebarDebuggerTool ? [sidebarDebuggerTool] : []),",
        "...(sidebarDebuggerTool ? [sidebarDebuggerTool] : []),\n\t\t...(sidebarEvalTool ? [sidebarEvalTool] : []),",
      );
    }
    fs.writeFileSync(target, src, "utf8");
    console.log("[patch-openclaw-sidebar-tools-scope] upgraded with sidebar_eval →", path.relative(root, target));
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

  if (includesBlock(src, CREATE_OLD_WITH_ACTION)) {
    src = replaceBlock(src, CREATE_OLD_WITH_ACTION, CREATE_NEW_WITH_ACTION);
  } else if (includesBlock(src, CREATE_OLD)) {
    src = replaceBlock(src, CREATE_OLD, CREATE_NEW);
  } else if (includesBlock(src, CREATE_OLD_DEBUGGER_ONLY) && !src.includes("sidebarDebugTool")) {
    src = replaceBlock(src, CREATE_OLD_DEBUGGER_ONLY, CREATE_NEW_DEBUGGER_ONLY);
  } else if (!src.includes("__studioWebExploreSession")) {
    console.warn("[patch-openclaw-sidebar-tools-scope] skip — create call inject point not found");
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-tools-scope] applied →", path.relative(root, target));
}

main();
