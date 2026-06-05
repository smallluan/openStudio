#!/usr/bin/env node
/**
 * Windows install surface benchmark: file counts under packaged resources.
 *
 * Usage:
 *   node scripts/benchmark-win-install.mjs [release-dir]
 *   node scripts/benchmark-win-install.mjs --json [release-dir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function findWinResourcesDir(startDir) {
  const direct = path.join(startDir, "win-unpacked", "resources");
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(startDir)) return null;
  for (const name of fs.readdirSync(startDir)) {
    if (!name.startsWith("_dist_")) continue;
    const candidate = path.join(startDir, name, "win-unpacked", "resources");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function walkFiles(dir) {
  let files = 0;
  let bytes = 0n;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        files += 1;
        try {
          bytes += BigInt(fs.statSync(full).size);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { files, bytes };
}

function summarizeResources(resourcesDir) {
  const entries = fs.readdirSync(resourcesDir, { withFileTypes: true });
  const rows = [];
  for (const e of entries) {
    const full = path.join(resourcesDir, e.name);
    if (e.isDirectory()) {
      const stats = walkFiles(full);
      rows.push({ name: `${e.name}/`, ...stats });
      continue;
    }
    if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        rows.push({ name: e.name, files: 1, bytes: BigInt(st.size) });
      } catch {
        /* ignore */
      }
    }
  }
  rows.sort((a, b) => (b.bytes > a.bytes ? 1 : b.bytes < a.bytes ? -1 : 0));
  let totalFiles = 0;
  let totalBytes = 0n;
  for (const r of rows) {
    totalFiles += r.files;
    totalBytes += r.bytes;
  }
  return { rows, totalFiles, totalBytes };
}

function detectOpenClawLayout(resourcesDir) {
  const loose = fs.existsSync(path.join(resourcesDir, "openclaw"));
  const asar = fs.existsSync(path.join(resourcesDir, "openclaw.asar"));
  const unpacked = fs.existsSync(path.join(resourcesDir, "openclaw.asar.unpacked"));
  if (loose) return "loose";
  if (asar) return unpacked ? "hybrid-asar" : "asar-only";
  return "missing";
}

function formatMib(bytes) {
  return (Number(bytes) / (1024 * 1024)).toFixed(2);
}

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const releaseDir = path.resolve(ROOT, args.find((a) => !a.startsWith("--")) || "release");
const resourcesDir = findWinResourcesDir(releaseDir);

if (!resourcesDir) {
  const msg = `[benchmark-win-install] no win-unpacked/resources under ${releaseDir}`;
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, reason: msg }, null, 2));
  } else {
    console.error(msg);
  }
  process.exit(1);
}

const summary = summarizeResources(resourcesDir);
const layout = detectOpenClawLayout(resourcesDir);
const memoryFsZip = fs.existsSync(path.join(resourcesDir, "node_modules.zip"));

const report = {
  ok: true,
  resourcesDir,
  layout,
  memoryFsZip,
  totalFiles: summary.totalFiles,
  totalBytes: summary.totalBytes.toString(),
  totalMib: formatMib(summary.totalBytes),
  entries: summary.rows.map((r) => ({
    name: r.name,
    files: r.files,
    mib: formatMib(r.bytes),
  })),
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("[benchmark-win-install] resources:", resourcesDir);
  console.log("[benchmark-win-install] openclaw layout:", layout);
  console.log("[benchmark-win-install] memory-fs zip:", memoryFsZip ? "yes" : "no");
  console.log(`[benchmark-win-install] total: ${summary.totalFiles} files, ${formatMib(summary.totalBytes)} MiB`);
  for (const row of summary.rows.slice(0, 12)) {
    console.log(`  ${row.name.padEnd(28)} ${String(row.files).padStart(7)} files  ${formatMib(row.bytes).padStart(8)} MiB`);
  }
}
