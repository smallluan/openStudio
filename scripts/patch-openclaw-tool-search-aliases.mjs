/**
 * Enrich Studio-injected OpenClaw tool descriptions for Tool Search discoverability.
 *
 * When `tools.toolSearch` is enabled, the model only sees tool_search / tool_describe /
 * tool_call. Catalog scoring matches against name + description — so aliases like
 * "browser_open", "open url", "console logs" must appear in the description text.
 *
 * Idempotent: safe to re-run; uses OPEN_STUDIO_TOOL_SEARCH_ALIASES marker per tool.
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

const MARKER = "OPEN_STUDIO_TOOL_SEARCH_ALIASES";

/** @type {Array<{ name: string; aliases: string }>} */
const TOOL_ALIASES = [
  {
    name: "browser_open",
    aliases:
      "Aliases: browser_open | open url | visit webpage | browse site | open preview | open bilibili | open link in sidebar.",
  },
  {
    name: "browser_action",
    aliases:
      "Aliases: browser_action | click | type | scroll | press | focus | navigate page | fill form | sidebar automation | web explore automation.",
  },
  {
    name: "browser_debug",
    aliases:
      "Aliases: browser_debug | console logs | network requests | xhr | fetch logs | read console | network catalog | debug preview.",
  },
  {
    name: "browser_screenshot",
    aliases:
      "Aliases: browser_screenshot | capture screenshot | take screenshot | viewport image | visual layout.",
  },
  {
    name: "browser_debugger",
    aliases:
      "Aliases: browser_debugger | breakpoint | cdp debugger | pause js | step over | inspect call frame | debug bug.",
  },
  {
    name: "browser_eval",
    aliases:
      "Aliases: browser_eval | eval javascript | run js in page | page console | inspect globals.",
  },
];

/**
 * @param {string} src
 * @param {string} toolName
 * @param {string} aliasLine
 */
function enrichToolDescription(src, toolName, aliasLine) {
  const marker = `${MARKER}:${toolName}`;
  if (src.includes(marker)) return { src, changed: false };

  // Match: name: "browser_open", ... description: "...."
  // Allow displaySummary between name and description.
  const re = new RegExp(
    `(name:\\s*"${toolName}"[\\s\\S]{0,400}?description:\\s*")([^"]*)(")`,
    "m",
  );
  const m = re.exec(src);
  if (!m) {
    console.warn(`[patch-openclaw-tool-search-aliases] skip — ${toolName} description not found`);
    return { src, changed: false };
  }
  const prev = m[2];
  if (prev.includes(aliasLine.slice(0, 24))) {
    // Already enriched without marker (manual) — still stamp marker nearby.
    const stamped = src.replace(m[0], `${m[0]} /* ${marker} */`);
    return { src: stamped === src ? src : stamped, changed: stamped !== src };
  }
  const nextDesc = `${aliasLine} ${prev}`.replace(/"/g, '\\"');
  const replacement = `${m[1]}${nextDesc}${m[3]} /* ${marker} */`;
  return { src: src.replace(m[0], replacement), changed: true };
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-tool-search-aliases] skip — bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  let n = 0;
  for (const row of TOOL_ALIASES) {
    const r = enrichToolDescription(src, row.name, row.aliases);
    src = r.src;
    if (r.changed) n += 1;
  }
  if (n === 0) {
    console.log("[patch-openclaw-tool-search-aliases] already applied (or tools missing)");
    return;
  }
  fs.writeFileSync(target, src, "utf8");
  console.log(
    `[patch-openclaw-tool-search-aliases] enriched ${n} tool description(s) → ${path.relative(root, target)}`,
  );
}

main();
