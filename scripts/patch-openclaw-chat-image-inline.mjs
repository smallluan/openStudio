/**
 * OpenClaw gates `chat.send` image attachments on `resolveGatewayModelSupportsImages`
 * (gateway model catalog must list `input` containing "image"). Built-in registry entries
 * often omit that flag, so attachments are offloaded to workspace files and the agent tries
 * to read them via tools — unreliable and matches "can't see the image" behaviour in Studio.
 *
 * Force the vision/inline path whenever the RPC already includes image/* attachments.
 * Safe for text-only models: the provider returns a clear error instead of a missing file.
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
const chatBundle =
  fs.existsSync(distDir) &&
  fs.readdirSync(distDir).find((name) => name.startsWith("chat-") && name.endsWith(".js"));
const target = chatBundle ? path.join(distDir, chatBundle) : path.join(openclawRoot, "dist", "chat-DNr22c3k.js");

const PATCH_TOKEN = `|| normalizedAttachments.some((a)=>typeof a?.mimeType==="string"&&a.mimeType.startsWith("image/"))`;

const NEEDLE = `\t\t\tconst supportsImages = await resolveGatewayModelSupportsImages({
				loadGatewayModelCatalog: context.loadGatewayModelCatalog,
				provider: modelRef.provider,
				model: modelRef.model
			}) || explicitOriginTargetsAcpSession(explicitOriginResult.value) || explicitOriginTargetsPlugin;
\t\t\tconst routeImageOffloadsAsMediaPaths = !supportsImages;`;

const REPLACEMENT = `\t\t\tconst supportsImages = (await resolveGatewayModelSupportsImages({
				loadGatewayModelCatalog: context.loadGatewayModelCatalog,
				provider: modelRef.provider,
				model: modelRef.model
			}) || explicitOriginTargetsAcpSession(explicitOriginResult.value) || explicitOriginTargetsPlugin)${PATCH_TOKEN};
\t\t\tconst routeImageOffloadsAsMediaPaths = !supportsImages;`;

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[patch-openclaw-chat-image-inline] skip — openclaw bundle not found:", path.relative(root, target));
    return;
  }
  const src = fs.readFileSync(target, "utf8");
  if (src.includes(PATCH_TOKEN)) {
    console.log("[patch-openclaw-chat-image-inline] already applied");
    return;
  }
  if (!src.includes(NEEDLE)) {
    console.warn(
      "[patch-openclaw-chat-image-inline] skip — upstream chat bundle changed; update patch script or upgrade Open Studio patch for this openclaw version",
    );
    return;
  }
  fs.writeFileSync(target, src.replace(NEEDLE, REPLACEMENT), "utf8");
  console.log("[patch-openclaw-chat-image-inline] applied to", path.relative(root, target));
  console.log("[patch-openclaw-chat-image-inline] restart the OpenClaw gateway (e.g. stop and re-run npm run dev) so the patched bundle loads.");
}

main();
