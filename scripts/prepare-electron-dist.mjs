/**
 * Cache Electron dist locally to speed up repeated Windows builds.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const electronPkg = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
);
const src = path.join(root, "node_modules", "electron", "dist");
const dest = path.join(root, "build", "electron-dist", "win32-x64");
const cacheMetaPath = path.join(dest, ".openstudio-electron-cache.json");
const destExe = path.join(dest, process.platform === "win32" ? "electron.exe" : "electron");
const electronInstallScript = path.join(root, "node_modules", "electron", "install.js");

if (!fs.existsSync(src)) {
  if (fs.existsSync(electronInstallScript)) {
    console.log("[prep:electron-dist:win] electron dist missing, running electron/install.js...");
    const install = spawnSync(process.execPath, [electronInstallScript], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    if (install.status !== 0) {
      console.error("[prep:electron-dist:win] electron/install.js failed");
      process.exit(typeof install.status === "number" && install.status !== 0 ? install.status : 1);
    }
  }
  if (!fs.existsSync(src)) {
    console.error("[prep:electron-dist:win] electron dist not found after install");
    process.exit(1);
  }
}

function hasValidCache() {
  if (!fs.existsSync(dest) || !fs.existsSync(destExe) || !fs.existsSync(cacheMetaPath)) return false;
  try {
    const cacheMeta = JSON.parse(fs.readFileSync(cacheMetaPath, "utf8"));
    if (cacheMeta?.electronVersion !== electronPkg.version) return false;
    const sourceEntries = fs.readdirSync(src).sort();
    const cachedEntries = fs
      .readdirSync(dest)
      .filter((name) => name !== path.basename(cacheMetaPath))
      .sort();
    return (
      sourceEntries.length === cachedEntries.length &&
      sourceEntries.every((name, index) => name === cachedEntries[index])
    );
  } catch {
    return false;
  }
}

if (hasValidCache()) {
  console.log(
    `[prep:electron-dist:win] cache hit Electron ${electronPkg.version} → ${dest} (skip copy)`,
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
fs.writeFileSync(
  cacheMetaPath,
  JSON.stringify({ electronVersion: electronPkg.version, updatedAt: new Date().toISOString() }, null, 2),
  "utf8",
);
console.log(`[prep:electron-dist:win] cached Electron ${electronPkg.version} → ${dest}`);
