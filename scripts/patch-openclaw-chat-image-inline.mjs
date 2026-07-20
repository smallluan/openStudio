/**
 * OpenClaw gates `chat.send` image attachments on `resolveGatewayModelSupportsImages`
 * (gateway model catalog must list `input` containing "image"). Built-in registry entries
 * often omit that flag, so attachments are offloaded to workspace files and the agent tries
 * to read them via tools — unreliable and matches "can't see the image" behaviour in Studio.
 *
 * Force the vision/inline path whenever the RPC already includes image/* attachments.
 * Safe for text-only models: the provider returns a clear error instead of a missing file.
 *
 * Shipped via patches/openclaw@2026.6.1.patch (pnpm patchedDependencies).
 * This script is for regenerating that patch or applying to build/openclaw bundles.
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

function findChatBundle() {
  if (!fs.existsSync(distDir)) return null;
  for (const name of fs.readdirSync(distDir)) {
    if (!name.startsWith("chat-") || !name.endsWith(".js")) continue;
    const file = path.join(distDir, name);
    if (fs.readFileSync(file, "utf8").includes("resolveGatewayModelSupportsImages")) return file;
  }
  return null;
}

const target = findChatBundle() ?? path.join(openclawRoot, "dist", "chat-bmAEPJsF.js");

const PATCH_TOKEN = `|| normalizedAttachments.some((a)=>typeof a?.mimeType==="string"&&a.mimeType.startsWith("image/"))`;

const REPLACEMENTS = [
  {
    needle: `const supportsImages = supportsSessionModelImages || explicitOriginSupportsInlineImages;
				const routeImageOffloadsAsMediaPaths = !supportsImages;`,
    replacement: `const supportsImages = supportsSessionModelImages || explicitOriginSupportsInlineImages${PATCH_TOKEN};
				const routeImageOffloadsAsMediaPaths = !supportsImages;`,
  },
  {
    needle: `\t\t\tconst supportsImages = await resolveGatewayModelSupportsImages({
				loadGatewayModelCatalog: context.loadGatewayModelCatalog,
				provider: modelRef.provider,
				model: modelRef.model
			}) || explicitOriginTargetsAcpSession(explicitOriginResult.value) || explicitOriginTargetsPlugin;
\t\t\tconst routeImageOffloadsAsMediaPaths = !supportsImages;`,
    replacement: `\t\t\tconst supportsImages = (await resolveGatewayModelSupportsImages({
				loadGatewayModelCatalog: context.loadGatewayModelCatalog,
				provider: modelRef.provider,
				model: modelRef.model
			}) || explicitOriginTargetsAcpSession(explicitOriginResult.value) || explicitOriginTargetsPlugin)${PATCH_TOKEN};
\t\t\tconst routeImageOffloadsAsMediaPaths = !supportsImages;`,
  },
];

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-chat-image-inline] skip — openclaw bundle not found:", path.relative(root, target));
    return;
  }
  let src = fs.readFileSync(target, "utf8");
  if (src.includes(PATCH_TOKEN)) {
    console.log("[patch-openclaw-chat-image-inline] already applied");
    return;
  }
  for (const { needle, replacement } of REPLACEMENTS) {
    if (src.includes(needle)) {
      fs.writeFileSync(target, src.replace(needle, replacement), "utf8");
      console.log("[patch-openclaw-chat-image-inline] applied to", path.relative(root, target));
      console.log(
        "[patch-openclaw-chat-image-inline] restart the OpenClaw gateway (e.g. stop and re-run npm run dev) so the patched bundle loads.",
      );
      return;
    }
  }
  console.warn(
    "[patch-openclaw-chat-image-inline] skip — upstream chat bundle changed; update patch script or upgrade Open Studio patch for this openclaw version",
  );
}

main();
