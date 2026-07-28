/**
 * Open Studio P2: prefer compact tool descriptions when projecting to the model.
 *
 * Keeps every tool registered; only shortens the `description` field sent to the
 * provider (prefer `displaySummary`, else first paragraph). Especially helps fat
 * tools like `cron` (~3k tokens of schema docs in the description alone).
 *
 * Apply to node_modules/openclaw (dev) or OPENCLAW_PATCH_ROOT (packaged bundle).
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

const PATCH_TOKEN = "OPEN_STUDIO_COMPACT_TOOL_DESCRIPTION";

const HELPER = `
function openStudioCompactToolDescription(tool) {
\tconst summary = typeof tool?.displaySummary === "string" ? tool.displaySummary.trim() : "";
\tif (summary) return summary.length > 160 ? \`\${summary.slice(0, 157)}...\` : summary;
\tconst raw = typeof tool?.description === "string" ? tool.description : "";
\tif (!raw || raw.length <= 400) return raw;
\tconst paragraphs = raw.split(/\\n\\s*\\n/g).map((p) => p.trim()).filter(Boolean);
\tfor (const paragraph of paragraphs) {
\t\tconst first = paragraph.split("\\n").map((l) => l.trim()).find(Boolean) || "";
\t\tif (!first) continue;
\t\tconst upper = first.toUpperCase();
\t\tif (upper.endsWith(":") && upper === first.toUpperCase() && upper.length > 12) continue;
\t\tif (first.startsWith("{") || first.startsWith("[") || first.startsWith("- ")) continue;
\t\treturn first.length > 320 ? \`\${first.slice(0, 317)}...\` : first;
\t}
\treturn raw.slice(0, 317) + "...";
}
`;

/** @type {Array<{ label: string; filePrefix: string; needles: Array<{ from: string; to: string }> }>} */
const TARGETS = [
  {
    label: "openai-completions",
    filePrefix: "openai-completions-",
    needles: [
      {
        from: `function convertTools(tools, compat) {
\treturn tools.map((tool) => ({
\t\ttype: "function",
\t\tfunction: {
\t\t\tname: tool.name,
\t\t\tdescription: tool.description,
\t\t\tparameters: tool.parameters,
\t\t\t...compat.supportsStrictMode && { strict: false }
\t\t}
\t}));
}`,
        to: `function convertTools(tools, compat) {
\treturn tools.map((tool) => ({
\t\ttype: "function",
\t\tfunction: {
\t\t\tname: tool.name,
\t\t\tdescription: openStudioCompactToolDescription(tool),
\t\t\tparameters: tool.parameters,
\t\t\t...compat.supportsStrictMode && { strict: false }
\t\t}
\t}));
}`,
      },
    ],
  },
  {
    label: "anthropic",
    filePrefix: "anthropic-",
    needles: [
      {
        from: `\t\t\tdescription: tool.description,
\t\t\t...supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {},
\t\t\tinput_schema: {`,
        to: `\t\t\tdescription: openStudioCompactToolDescription(tool),
\t\t\t...supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {},
\t\t\tinput_schema: {`,
      },
    ],
  },
];

/**
 * @param {string} dir
 * @param {string} prefix
 */
function findDistFile(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(".js"));
  return hit ? path.join(dir, hit) : null;
}

/**
 * @param {string} target
 * @param {{ label: string; needles: Array<{ from: string; to: string }> }} spec
 */
function patchFile(target, spec) {
  if (!target || !fs.existsSync(target)) {
    console.warn(`[patch-openclaw-compact-tool-descriptions] skip — ${spec.label} bundle not found`);
    return false;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(PATCH_TOKEN)) {
    console.log(`[patch-openclaw-compact-tool-descriptions] ${spec.label} already applied`);
    return true;
  }
  let changed = false;
  for (const { from, to } of spec.needles) {
    if (!src.includes(from)) {
      console.warn(
        `[patch-openclaw-compact-tool-descriptions] skip — ${spec.label} upstream changed; missing needle`,
      );
      return false;
    }
    src = src.replace(from, to);
    changed = true;
  }
  if (!changed) return false;
  if (!src.includes("function openStudioCompactToolDescription")) {
    const marker = "//#endregion\nexport";
    if (src.includes(marker)) {
      src = src.replace(marker, `${HELPER}\n// ${PATCH_TOKEN}\n${marker}`);
    } else {
      src = `${HELPER}\n// ${PATCH_TOKEN}\n${src}`;
    }
  } else if (!src.includes(PATCH_TOKEN)) {
    src = `${src}\n// ${PATCH_TOKEN}\n`;
  }
  fs.writeFileSync(target, src, "utf8");
  console.log(
    `[patch-openclaw-compact-tool-descriptions] applied → ${path.relative(root, target)}`,
  );
  return true;
}

function main() {
  let ok = 0;
  for (const spec of TARGETS) {
    const target = findDistFile(distDir, spec.filePrefix);
    if (patchFile(target, spec)) ok += 1;
  }
  if (ok === 0) {
    console.warn("[patch-openclaw-compact-tool-descriptions] no targets patched");
  }
}

main();
