/**
 * Sync the ChatLab hero robot avatar into build/public icon assets for Electron + Vite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "src", "assets", "images", "hero-avatar-light.png");

if (!fs.existsSync(source)) {
  console.error("[sync-app-icon] missing source:", source);
  process.exit(1);
}

const buildDir = path.join(root, "build");
const publicDir = path.join(root, "public");
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const buildPng = path.join(buildDir, "app-icon.png");
const publicPng = path.join(publicDir, "app-icon.png");
const buildIco = path.join(buildDir, "app-icon.ico");

/**
 * @param {string} input
 * @param {string} output
 * @param {number} size
 */
async function writeSquarePng(input, output, size) {
  await sharp(input)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(output);
}

await writeSquarePng(source, buildPng, 512);
await writeSquarePng(source, publicPng, 256);

const icoBuffer = await pngToIco(buildPng);
fs.writeFileSync(buildIco, icoBuffer);

console.log("[sync-app-icon] synced hero avatar → build/app-icon.{png,ico}, public/app-icon.png");
