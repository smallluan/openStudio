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
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceFileWithRetry(tmp, output) {
  let lastError;
  for (let i = 0; i < 8; i++) {
    try {
      fs.rmSync(output, { force: true });
      fs.renameSync(tmp, output);
      return;
    } catch (err) {
      lastError = err;
      await sleep(120 * (i + 1));
    }
  }
  throw lastError;
}

/**
 * @param {string} input
 * @param {string} output
 * @param {number} size
 */
async function writeSquarePng(input, output, size) {
  const tmp = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${Date.now()}.tmp.png`);
  await sharp(input)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(tmp);
  await replaceFileWithRetry(tmp, output);
}

await writeSquarePng(source, buildPng, 512);
await writeSquarePng(source, publicPng, 256);

/** @type {string[]} */
const icoPngPaths = [];
for (const size of ICO_SIZES) {
  const tmp = path.join(buildDir, `.app-icon-${size}.png`);
  await writeSquarePng(source, tmp, size);
  icoPngPaths.push(tmp);
}

const icoBuffer = await pngToIco(icoPngPaths);
fs.writeFileSync(buildIco, icoBuffer);
for (const tmp of icoPngPaths) {
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
}

console.log("[sync-app-icon] synced hero avatar → build/app-icon.{png,ico}, public/app-icon.png");
