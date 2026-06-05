/**
 * Open Studio: skip heavy optional tool factories on every chat.send prep.
 *
 * `createPdfTool()` calls `resolvePdfModelConfigForTool()` synchronously and can
 * take 20–30s on Windows (provider/auth scans). Chat Lab rarely needs the pdf tool
 * on the first turn; disable unless OPEN_STUDIO_LEAN_CHAT_TOOLS=0.
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
  : path.join(openclawRoot, "dist", "openclaw-tools-BDF6gNXk.js");

const PATCH_TOKEN = "process.env.OPEN_STUDIO_LEAN_CHAT_TOOLS !== \"0\"";

const NEEDLE = `\t\tpdf: allowPdf && (explicitPdf || hasSnapshotCapabilityAvailability({
			snapshot,
			authStore: params.authStore,
			key: "mediaUnderstandingProviders",
			config: params.config
		}) || hasConfiguredVisionModelAuthSignal({
			config: params.config,
			snapshot,
			authStore: params.authStore
		}))`;

const REPLACEMENT = `\t\tpdf: ${PATCH_TOKEN} && allowPdf && (explicitPdf || hasSnapshotCapabilityAvailability({
			snapshot,
			authStore: params.authStore,
			key: "mediaUnderstandingProviders",
			config: params.config
		}) || hasConfiguredVisionModelAuthSignal({
			config: params.config,
			snapshot,
			authStore: params.authStore
		}))`;

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-studio-lean-chat] skip — bundle not found:", path.relative(root, target));
    return;
  }
  const src = fs.readFileSync(target, "utf8");
  if (src.includes(PATCH_TOKEN)) {
    console.log("[patch-openclaw-studio-lean-chat] already applied");
    return;
  }
  if (!src.includes(NEEDLE)) {
    console.warn(
      "[patch-openclaw-studio-lean-chat] skip — upstream openclaw-tools bundle changed; update patch for this openclaw version",
    );
    return;
  }
  fs.writeFileSync(target, src.replace(NEEDLE, REPLACEMENT), "utf8");
  console.log("[patch-openclaw-studio-lean-chat] applied (pdf tool prep gated by OPEN_STUDIO_LEAN_CHAT_TOOLS)");
}

main();
