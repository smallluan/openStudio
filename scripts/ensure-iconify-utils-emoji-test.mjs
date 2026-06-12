import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { get } from "node:https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function resolveIconifyUtilsRoot() {
  try {
    const pkgJson = require.resolve("@iconify/utils/package.json");
    return path.dirname(pkgJson);
  } catch {
    return null;
  }
}

function emojiTestFilesPresent(utilsRoot) {
  const testDir = path.join(utilsRoot, "lib", "emoji", "test");
  return (
    fs.existsSync(path.join(testDir, "parse.js")) &&
    fs.existsSync(path.join(testDir, "variations.js")) &&
    fs.existsSync(path.join(testDir, "missing.js"))
  );
}

function downloadNpmTarball(version, destination) {
  const url = `https://registry.npmjs.org/@iconify/utils/-/utils-${version}.tgz`;
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        get(response.headers.location, (redirect) => {
          pipeline(redirect, createWriteStream(destination)).then(resolve).catch(reject);
        }).on("error", reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`npm registry returned ${response.statusCode} for ${url}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve).catch(reject);
    }).on("error", reject);
  });
}

async function restoreEmojiTestFromNpm(utilsRoot) {
  const version = JSON.parse(fs.readFileSync(path.join(utilsRoot, "package.json"), "utf8")).version;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iconify-utils-"));
  const tarballPath = path.join(tmpDir, `utils-${version}.tgz`);
  await downloadNpmTarball(version, tarballPath);

  const extractDir = path.join(tmpDir, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    cwd: root,
    shell: process.platform === "win32",
  });

  const packedRoot = fs.readdirSync(extractDir).find((name) => name.startsWith("package"));
  if (!packedRoot) {
    throw new Error("could not find package root in npm tarball");
  }

  const sourceTestDir = path.join(extractDir, packedRoot, "lib", "emoji", "test");
  const targetTestDir = path.join(utilsRoot, "lib", "emoji", "test");
  fs.mkdirSync(targetTestDir, { recursive: true });
  for (const name of fs.readdirSync(sourceTestDir)) {
    fs.copyFileSync(path.join(sourceTestDir, name), path.join(targetTestDir, name));
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const utilsRoot = resolveIconifyUtilsRoot();
if (!utilsRoot) {
  process.exit(0);
}

if (emojiTestFilesPresent(utilsRoot)) {
  process.exit(0);
}

console.warn(
  "[ensure-iconify-utils-emoji-test] missing lib/emoji/test in @iconify/utils " +
    "(often removed by Windows Defender). Restoring from npm…",
);

try {
  await restoreEmojiTestFromNpm(utilsRoot);
} catch (err) {
  console.error("[ensure-iconify-utils-emoji-test] restore failed:", err.message);
  console.error(
    "[ensure-iconify-utils-emoji-test] add a Windows Defender exclusion for this project, then run: pnpm install",
  );
  process.exit(1);
}

if (!emojiTestFilesPresent(utilsRoot)) {
  console.error("[ensure-iconify-utils-emoji-test] files still missing after restore.");
  process.exit(1);
}

console.log("[ensure-iconify-utils-emoji-test] restored @iconify/utils emoji/test files");
