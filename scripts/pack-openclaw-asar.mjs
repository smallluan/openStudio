/**
 * Optional: pack node_modules/openclaw into vendor/openclaw.asar (not used for gateway — OpenClaw's
 * boundary loader requires real disk paths). Production uses electron-builder asarUnpack on dist/**.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import * as asar from "@electron/asar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "openclaw");
const vendorDir = path.join(root, "vendor");
const dest = path.join(vendorDir, "openclaw.asar");
const stampPath = path.join(vendorDir, ".openclaw-asar-fingerprint");

/** @returns {string} */
function fingerprintSource() {
  const pkgPath = path.join(src, "package.json");
  if (!fs.existsSync(pkgPath)) return "missing";
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version = String(pkg.version ?? "0");

  const chatBundle = path.join(src, "dist", "chat-DNr22c3k.js");
  let patchSig = "no-chat-bundle";
  if (fs.existsSync(chatBundle)) {
    const buf = fs.readFileSync(chatBundle);
    patchSig = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  }

  return `${version}:${patchSig}`;
}

function removeVendorArtifacts() {
  try {
    fs.rmSync(dest, { force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(`${dest}.unpacked`, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function pack() {
  if (!fs.existsSync(src)) {
    console.warn("[pack-openclaw-asar] skip — node_modules/openclaw not installed");
    return;
  }

  const fp = fingerprintSource();
  if (fs.existsSync(stampPath)) {
    const prev = fs.readFileSync(stampPath, "utf8").trim();
    const unpackedCli = path.join(`${dest}.unpacked`, "openclaw.mjs");
    if (prev === fp && fs.existsSync(dest) && fs.existsSync(unpackedCli)) {
      console.log("[pack-openclaw-asar] up to date");
      return;
    }
  }

  fs.mkdirSync(vendorDir, { recursive: true });
  removeVendorArtifacts();

  console.log("[pack-openclaw-asar] packing", path.relative(root, src), "→", path.relative(root, dest));
  const started = Date.now();

  await asar.createPackageWithOptions(src, dest, {
    /** Root entry only — do not use `package.json` (matches every nested package.json). */
    unpack: "openclaw.mjs",
  });

  fs.writeFileSync(stampPath, fp, "utf8");
  const ms = Date.now() - started;
  console.log(`[pack-openclaw-asar] done in ${Math.round(ms / 1000)}s (fingerprint ${fp})`);
}

pack().catch((err) => {
  console.error("[pack-openclaw-asar] failed:", err?.message ?? err);
  process.exit(1);
});
