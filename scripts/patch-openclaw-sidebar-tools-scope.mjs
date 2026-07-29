/**
 * Scope Studio browser tools by session kind (`#studio:wexplore:` = Web Explore).
 *
 * - Web Explore: `browser_action` + debug/screenshot/debugger/eval — **no** `browser_open`
 *   (agent must use the visible tab; `browser_action` navigate updates the current tab).
 * - Chat Lab: `browser_action` + `browser_open` — no debug tools.
 *
 * Runs after patch-openclaw-sidebar-debugger.mjs / patch-openclaw-browser-open.mjs.
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

const MARKER = "OPEN_STUDIO_BROWSER_TOOLS_SCOPE";
const OPEN_SCOPE_MARKER = "OPEN_STUDIO_BROWSER_OPEN_CHAT_LAB_ONLY";

const HELPER_FN = `
function isOpenStudioWebExploreSessionKey(agentSessionKey) {
	/* ${MARKER} */
	const key = String(agentSessionKey ?? "");
	return key.includes("#studio:wexplore:");
}
`;

const CREATE_OLD = `const browserDebugTool = createBrowserDebugTool();
	const browserScreenshotTool = createBrowserScreenshotTool();
	const browserDebuggerTool = createBrowserDebuggerTool();
	const browserEvalTool = createBrowserEvalTool();`;

const CREATE_NEW = `const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	const browserDebugTool = __studioWebExploreSession ? createBrowserDebugTool() : null;
	const browserScreenshotTool = __studioWebExploreSession ? createBrowserScreenshotTool() : null;
	const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;
	const browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;`;

const CREATE_OLD_WITH_ACTION = `\tconst browserActionTool = createBrowserActionTool();
\tconst browserDebugTool = createBrowserDebugTool();
\tconst browserScreenshotTool = createBrowserScreenshotTool();
\tconst browserDebuggerTool = createBrowserDebuggerTool();
\tconst browserEvalTool = createBrowserEvalTool();`;

const CREATE_NEW_WITH_ACTION = `\tconst browserActionTool = createBrowserActionTool();
\tconst __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
\tconst browserDebugTool = __studioWebExploreSession ? createBrowserDebugTool() : null;
\tconst browserScreenshotTool = __studioWebExploreSession ? createBrowserScreenshotTool() : null;
\tconst browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;
\tconst browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;`;

const CREATE_OLD_DEBUGGER_ONLY = `const browserDebuggerTool = createBrowserDebuggerTool();`;

const CREATE_NEW_DEBUGGER_ONLY = `const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	const browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;`;

/** Unconditional browser_open → Chat Lab only (null in Web Explore). */
const BROWSER_OPEN_ALWAYS = `const browserActionTool = createBrowserActionTool();
	const browserOpenTool = createBrowserOpenTool();
	const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);`;

const BROWSER_OPEN_CHAT_LAB_ONLY = `const browserActionTool = createBrowserActionTool();
	const __studioWebExploreSession = isOpenStudioWebExploreSessionKey(options?.agentSessionKey);
	/* ${OPEN_SCOPE_MARKER} */
	const browserOpenTool = __studioWebExploreSession ? null : createBrowserOpenTool();`;

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

/**
 * @param {string} src
 */
function scopeBrowserOpenToChatLab(src) {
  if (src.includes(OPEN_SCOPE_MARKER)) return src;
  if (includesBlock(src, BROWSER_OPEN_ALWAYS)) {
    return replaceBlock(src, BROWSER_OPEN_ALWAYS, BROWSER_OPEN_CHAT_LAB_ONLY);
  }
  // Fallback: only rewrite the createBrowserOpenTool() line when session flag already exists.
  if (
    src.includes("const __studioWebExploreSession = isOpenStudioWebExploreSessionKey") &&
    src.includes("const browserOpenTool = createBrowserOpenTool();")
  ) {
    return src.replace(
      "const browserOpenTool = createBrowserOpenTool();",
      `/* ${OPEN_SCOPE_MARKER} */\n\tconst browserOpenTool = __studioWebExploreSession ? null : createBrowserOpenTool();`,
    );
  }
  return src;
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-sidebar-tools-scope] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  const alreadyScopedDebug =
    src.includes(MARKER) && includesBlock(src, CREATE_NEW_WITH_ACTION.split("\n")[1]) && src.includes("browserEvalTool");
  if (alreadyScopedDebug && src.includes(OPEN_SCOPE_MARKER)) {
    console.log("[patch-openclaw-sidebar-tools-scope] already applied");
    return;
  }

  if (src.includes(MARKER) && src.includes("__studioWebExploreSession") && !src.includes("browserEvalTool")) {
    src = replaceBlock(
      src,
      `\tconst browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;`,
      `\tconst browserDebuggerTool = __studioWebExploreSession ? createBrowserDebuggerTool() : null;
\tconst browserEvalTool = __studioWebExploreSession ? createBrowserEvalTool() : null;`,
    );
    if (src.includes("...(browserDebuggerTool ? [browserDebuggerTool] : []),")) {
      src = src.replace(
        "...(browserDebuggerTool ? [browserDebuggerTool] : []),",
        "...(browserDebuggerTool ? [browserDebuggerTool] : []),\n\t\t...(browserEvalTool ? [browserEvalTool] : []),",
      );
    }
  } else if (!alreadyScopedDebug) {
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
    } else if (includesBlock(src, CREATE_OLD_DEBUGGER_ONLY) && !src.includes("browserDebugTool")) {
      src = replaceBlock(src, CREATE_OLD_DEBUGGER_ONLY, CREATE_NEW_DEBUGGER_ONLY);
    } else if (!src.includes("__studioWebExploreSession")) {
      console.warn("[patch-openclaw-sidebar-tools-scope] skip — create call inject point not found");
      process.exitCode = 1;
      return;
    }
  }

  const beforeOpen = src;
  src = scopeBrowserOpenToChatLab(src);
  if (src === beforeOpen && !src.includes(OPEN_SCOPE_MARKER)) {
    console.warn(
      "[patch-openclaw-sidebar-tools-scope] warn — could not scope browser_open to Chat Lab; check bundle layout",
    );
  }

  fs.writeFileSync(target, src, "utf8");
  console.log("[patch-openclaw-sidebar-tools-scope] applied →", path.relative(root, target));
}

main();
